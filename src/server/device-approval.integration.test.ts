import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AdminService } from "../admin/admin-service.js";
import type { Logger } from "../logger.js";
import { WebSpeakDatabase } from "../persistence/database.js";
import { DEVICE_COOKIE_NAME, MAX_PENDING_DEVICE_REQUESTS } from "../security/device-access.js";
import { JoinTicketStore } from "./join-ticket.js";
import { createWebServer } from "./server.js";

const noop = () => {};
const logger: Logger = { debug: noop, info: noop, warn: noop, error: noop, child: () => logger };

test("new browsers wait for administrator approval and approved browsers rejoin without asking", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-device-approval-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const service = new AdminService(database, Buffer.alloc(32, 3), logger, path.join(directory, "missing-config.json"));
  await service.initialize();
  service.updateSettings({ target: "8.8.8.8:9987", accessMode: "fixed", siteName: "WebSpeak", welcomeText: "", webRtcEnabled: false });
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const joinTickets = new JoinTicketStore();
  const server = createWebServer({ port, adminService: service, voiceBridgeOptions: { joinTickets }, logger });
  context.after(async () => {
    await server.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  await server.start();

  const join = async (cookie = "", extra: Record<string, unknown> = {}) => {
    const response = await fetch(`${origin}/api/join-ticket`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", "user-agent": "TestBrowser/1.0", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify({ nickname: "Visitor", ...extra }),
    });
    const body = await response.json() as { code?: string; ticket?: string };
    return { status: response.status, code: body.code, cookie: deviceCookie(response) };
  };
  const status = async (cookie: string) => (await (await fetch(`${origin}/api/access-status`, { headers: { cookie } })).json() as { required: boolean; status: string });

  // Disabled by default: nothing changes for existing installations.
  assert.equal(service.deviceAccess.isRequired(), false);
  const open = await join();
  assert.equal(open.status, 201);
  assert.equal(open.cookie, "", "no device cookie is issued while approval is off");

  service.deviceAccess.setRequired(true);
  assert.equal((await (await fetch(`${origin}/api/public-config`)).json() as { deviceApprovalRequired: boolean }).deviceApprovalRequired, true);

  // A first visit creates exactly one pending request and hands out a cookie.
  const first = await join();
  assert.equal(first.status, 403);
  assert.equal(first.code, "APPROVAL_PENDING");
  assert.match(first.cookie, new RegExp(`^${DEVICE_COOKIE_NAME}=`));
  const retry = await join(first.cookie, { nickname: "Renamed" });
  assert.equal(retry.code, "APPROVAL_PENDING");
  let listing = service.deviceAccess.list();
  assert.equal(listing.devices.length, 1);
  assert.equal(listing.pendingCount, 1);
  assert.equal(listing.devices[0]!.nickname, "Renamed");
  assert.equal(listing.devices[0]!.userAgent, "TestBrowser/1.0");
  assert.equal(listing.devices[0]!.clientIp, "127.0.0.1");
  assert.equal("tokenHash" in listing.devices[0]!, false, "the admin view never exposes the device token hash");
  assert.deepEqual(await status(first.cookie), { required: true, status: "pending" });

  // Approval is remembered for that browser.
  assert.equal(service.deviceAccess.decide(listing.devices[0]!.id, "approve"), true);
  assert.deepEqual(await status(first.cookie), { required: true, status: "approved" });
  assert.equal((await join(first.cookie)).status, 201);
  assert.equal((await join(first.cookie)).status, 201);

  // A different browser is still a stranger; denial is also remembered.
  const second = await join();
  assert.equal(second.code, "APPROVAL_PENDING");
  const secondId = service.deviceAccess.list().devices.find((device) => device.status === "pending")!.id;
  service.deviceAccess.decide(secondId, "deny");
  assert.equal((await join(second.cookie)).code, "APPROVAL_DENIED");
  assert.deepEqual(await status(second.cookie), { required: true, status: "denied" });

  // Forgetting a device lets it ask again; revoking an approved one blocks it.
  service.deviceAccess.forget(secondId);
  assert.equal((await join(second.cookie)).code, "APPROVAL_PENDING");
  const approvedId = service.deviceAccess.list().devices.find((device) => device.status === "approved")!.id;
  service.deviceAccess.decide(approvedId, "deny");
  assert.equal((await join(first.cookie)).code, "APPROVAL_DENIED");

  // Administrator-issued invitations remain a way in for a browser without approval.
  const invite = service.createManagedInvite({ channel: "", expiresInHours: 1, maxUses: 1 });
  assert.equal((await join("", { invite: invite.token })).status, 201);

  // Forged or malformed cookies are treated as new browsers, not as approved ones.
  const forged = await join(`${DEVICE_COOKIE_NAME}=not-a-real-token`);
  assert.equal(forged.code, "APPROVAL_PENDING");
  assert.notEqual(forged.cookie, "", "an invalid cookie is replaced with a fresh one");

  // Turning approval off restores open access immediately.
  service.deviceAccess.setRequired(false);
  assert.equal((await join(second.cookie)).status, 201);
  assert.deepEqual(await status(second.cookie), { required: false, status: "not-required" });
});

test("an approved owner protects a nickname with a password and uses it on another browser", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-device-account-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  const service = new AdminService(database, Buffer.alloc(32, 5), logger, path.join(directory, "missing-config.json"));
  await service.initialize();
  service.updateSettings({ target: "8.8.8.8:9987", accessMode: "fixed", siteName: "WebSpeak", welcomeText: "", webRtcEnabled: false });
  service.deviceAccess.setRequired(true);
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const server = createWebServer({ port, adminService: service, voiceBridgeOptions: { joinTickets: new JoinTicketStore() }, logger });
  context.after(async () => {
    await server.stop();
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  await server.start();
  const post = async (route: string, body: Record<string, unknown>, cookie = "") => {
    const response = await fetch(`${origin}${route}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    });
    const result = await response.json() as { code?: string };
    return { status: response.status, code: result.code, cookie: deviceCookie(response) };
  };
  const state = async (cookie: string, nickname: string) => (await (await fetch(`${origin}/api/access-status?nickname=${encodeURIComponent(nickname)}`, { headers: { cookie } })).json() as { status: string; account?: string; canCreate?: boolean });

  // Laptop asks, the administrator approves.
  const laptop = (await post("/api/join-ticket", { nickname: "Petya" })).cookie;
  service.deviceAccess.decide(service.deviceAccess.list().devices[0]!.id, "approve");
  assert.deepEqual(await state(laptop, "Petya"), { required: true, status: "approved", account: "none", canCreate: true } as never);

  // A pending browser cannot claim a nickname; the approved one can, once.
  const stranger = (await post("/api/join-ticket", { nickname: "Stranger" })).cookie;
  assert.equal((await post("/api/account/setup", { nickname: "Stranger", password: "secret-1" }, stranger)).code, "APPROVAL_REQUIRED");
  assert.equal((await post("/api/account/setup", { nickname: "Petya", password: "123" }, laptop)).code, "ACCOUNT_PASSWORD_TOO_SHORT");
  assert.equal((await post("/api/account/setup", { nickname: "Petya", password: "petya-pass" }, laptop)).status, 200);
  assert.equal((await post("/api/account/setup", { nickname: "Other", password: "petya-pass" }, laptop)).code, "DEVICE_HAS_ACCOUNT");
  assert.equal((await state(laptop, "petya")).account, "linked", "nicknames are matched case-insensitively");
  assert.equal((await post("/api/join-ticket", { nickname: "Petya" }, laptop)).status, 201);

  // A new phone using the protected nickname is asked for the password, not queued.
  const before = service.deviceAccess.list().devices.length;
  const phoneTry = await post("/api/join-ticket", { nickname: " PETYA " });
  assert.equal(phoneTry.code, "ACCOUNT_PASSWORD_REQUIRED");
  assert.equal(service.deviceAccess.list().devices.length, before, "no admin request is created for a protected nickname");
  const phone = phoneTry.cookie;
  assert.equal((await state(phone, "Petya")).account, "other");
  assert.equal((await post("/api/account/sign-in", { nickname: "Petya", password: "wrong-pass" }, phone)).code, "ACCOUNT_PASSWORD_INVALID");
  assert.equal((await post("/api/account/sign-in", { nickname: "Petya", password: "petya-pass" }, phone)).status, 200);
  assert.equal((await post("/api/join-ticket", { nickname: "Petya" }, phone)).status, 201);
  assert.equal((await state(phone, "Petya")).status, "approved");
  // Another approved browser that is not linked to the account cannot use the nickname either.
  service.deviceAccess.decide(service.deviceAccess.list().devices.find((device) => device.nickname === "Stranger")!.id, "approve");
  assert.equal((await post("/api/join-ticket", { nickname: "Petya" }, stranger)).code, "ACCOUNT_PASSWORD_REQUIRED");
  assert.equal((await post("/api/join-ticket", { nickname: "Stranger" }, stranger)).status, 201);

  const listing = service.deviceAccess.list();
  assert.equal(listing.accounts.length, 1);
  assert.equal(listing.accounts[0]!.deviceCount, 2);
  assert.equal(listing.devices.filter((device) => device.accountNickname === "Petya").length, 2);
  assert.equal(JSON.stringify(listing).includes("credential"), false, "password material never reaches the admin view");

  // Five wrong passwords lock the nickname even for the right password.
  const tablet = (await post("/api/join-ticket", { nickname: "Petya" })).cookie;
  for (let attempt = 1; attempt < 5; attempt += 1) {
    assert.equal((await post("/api/account/sign-in", { nickname: "Petya", password: `bad-${attempt}-x` }, tablet)).code, "ACCOUNT_PASSWORD_INVALID");
  }
  assert.equal((await post("/api/account/sign-in", { nickname: "Petya", password: "bad-5-x" }, tablet)).code, "ACCOUNT_LOCKED");
  assert.equal((await post("/api/account/sign-in", { nickname: "Petya", password: "petya-pass" }, tablet)).code, "ACCOUNT_LOCKED");
  assert.equal(service.deviceAccess.list().accounts[0]!.locked, true);
  // The lock expires.
  assert.equal((await service.deviceAccess.signIn(tablet.split("=")[1]!, "Petya", "petya-pass", { clientIp: "x", userAgent: "y" }, Date.now() + 16 * 60 * 1000)).ok, true);

  // An administrator's denial wins over the password.
  const deniedId = service.deviceAccess.list().devices.find((device) => device.nickname === "Stranger")!.id;
  service.deviceAccess.decide(deniedId, "deny");
  assert.equal((await post("/api/account/sign-in", { nickname: "Petya", password: "petya-pass" }, stranger)).code, "APPROVAL_DENIED");

  // Resetting removes the protection; linked browsers stay approved.
  assert.equal(service.deviceAccess.deleteAccount(listing.accounts[0]!.id), true);
  assert.equal((await post("/api/join-ticket", { nickname: "Petya" }, phone)).status, 201);
  assert.equal((await state(phone, "Petya")).canCreate, true);
});

test("pending requests are capped so anonymous visitors cannot grow the queue without limit", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "webspeak-device-cap-"));
  const database = new WebSpeakDatabase(path.join(directory, "webspeak.db"));
  context.after(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  const service = new AdminService(database, Buffer.alloc(32, 4), logger, path.join(directory, "missing-config.json"));
  await service.initialize();
  service.deviceAccess.setRequired(true);
  const visit = { nickname: "Flood", clientIp: "203.0.113.5", userAgent: "x" };
  for (let index = 0; index < MAX_PENDING_DEVICE_REQUESTS; index += 1) {
    assert.equal(service.deviceAccess.admit(`${"a".repeat(40)}${index}`, visit).status, "pending");
  }
  assert.equal(service.deviceAccess.admit("b".repeat(43), visit).status, "queue-full");
  assert.equal(service.deviceAccess.pendingCount(), MAX_PENDING_DEVICE_REQUESTS);
});

function deviceCookie(response: Response): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${DEVICE_COOKIE_NAME}=`));
  return header ? header.split(";")[0]! : "";
}

async function availablePort(): Promise<number> {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => { socket.once("error", reject); socket.listen(0, "127.0.0.1", resolve); });
  const address = socket.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return address.port;
}
