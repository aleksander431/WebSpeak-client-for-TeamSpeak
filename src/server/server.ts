import express from "express";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { VoiceBridge, type VoiceBridgeOptions } from "./voice-bridge.js";
import type { Logger } from "../logger.js";
import type { TeamSpeakTarget } from "../domain/teamspeak-target.js";
import { formatTeamSpeakConnectionTarget, parseTeamSpeakConnectionTarget } from "../domain/teamspeak-connection-target.js";
import { resolveTeamSpeakTarget, TeamSpeakAliasLookupError } from "./teamspeak-alias.js";
import { createAdminRouter } from "../admin/admin-router.js";
import type { AdminService } from "../admin/admin-service.js";
import { AdminSessionStore } from "../admin/admin-session.js";
import { isSafeOpenTargetForPrefill, resolveSafeOpenTarget, TeamSpeakTargetResolutionError } from "../security/open-target-policy.js";
import { parseIdentity } from "@honeybbq/teamspeak/client";
import { JoinRateLimiter } from "./join-rate-limit.js";
import type { ConfiguredAccelerationRelay } from "./acceleration-relay.js";
import { createVoiceGatewayAuthHeaders, type DelegatedVoiceSession } from "./voice-gateway-auth.js";
import type { SkinRegistry } from "../admin/skin-registry.js";
import { resolveVisitorTotal } from "./visitor-count.js";
import { createTrustedProxies, resolveClientIp } from "./voice-bridge.js";
import { createDeviceToken, DEVICE_COOKIE_MAX_AGE_MS, DEVICE_COOKIE_NAME, isDeviceToken } from "../security/device-access.js";
import { isSecureRequest } from "../admin/admin-session.js";

export interface WebServerOptions {
  port: number;
  version?: string;
  logFile?: string;
  staticDir?: string;
  certDir?: string; // path to cert.pem + key.pem for HTTPS
  voiceBridgeOptions: VoiceBridgeOptions;
  adminService: AdminService;
  skinRegistry?: SkinRegistry;
  logger: Logger;
  nextVisitorNumber?: () => number;
  visitorCount?: () => number;
}

export interface WebServer {
  start(): Promise<void>;
  stop(): Promise<void>;
}

const VISITOR_NUMBER_COOKIE = "webspeak_visitor_number";

export function createWebServer(options: WebServerOptions): WebServer {
  const app = express();
  const logger = options.logger.child({ component: "web" });

  let server: ReturnType<typeof createHttpsServer> | ReturnType<typeof createHttpServer>;

  if (options.certDir) {
    const cert = readFileSync(path.join(options.certDir, "cert.pem"));
    const key = readFileSync(path.join(options.certDir, "key.pem"));
    server = createHttpsServer({ cert, key }, app);
    logger.info("HTTPS enabled");
  } else {
    server = createHttpServer(app);
  }

  app.use(express.json({ limit: "100kb" }));

  const voiceBridge = new VoiceBridge(options.voiceBridgeOptions, logger);
  const adminSessions = new AdminSessionStore();
  const joinRateLimiter = new JoinRateLimiter();
  const trustedProxies = createTrustedProxies(options.voiceBridgeOptions.trustedProxies);
  const startedAt = Date.now();

  /** Return this browser's device token, issuing a long-lived cookie on first use. */
  function ensureDeviceToken(request: express.Request, response: express.Response): string {
    const existing = readCookie(request.header("cookie"), DEVICE_COOKIE_NAME);
    if (isDeviceToken(existing)) return existing;
    const token = createDeviceToken();
    response.cookie(DEVICE_COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: isSecureRequest(request),
      path: "/",
      maxAge: DEVICE_COOKIE_MAX_AGE_MS,
    });
    return token;
  }

  const healthHandler: express.RequestHandler = (_request, response) => {
    response.json({ status: "ok", version: options.version ?? "0.1.0" });
  };
  app.get("/health", healthHandler);
  app.get("/api/health", healthHandler);

  app.get("/api/public-config", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const acceleration = resolveAccelerationOptions(options.voiceBridgeOptions.acceleration);
    let visitorNumber = readVisitorNumberCookie(request.header("cookie"));
    if (visitorNumber === null && options.nextVisitorNumber) {
      try {
        visitorNumber = options.nextVisitorNumber();
        response.setHeader(
          "Set-Cookie",
          `${VISITOR_NUMBER_COOKIE}=${visitorNumber}; Max-Age=31536000; Path=/; SameSite=Lax${options.certDir ? "; Secure" : ""}`,
        );
      } catch (error: unknown) {
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Visitor number could not be assigned");
      }
    }
    let visitorTotal = resolveVisitorTotal(visitorNumber, null);
    if (options.visitorCount) {
      try {
        visitorTotal = resolveVisitorTotal(visitorNumber, options.visitorCount());
      } catch (error: unknown) {
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Visitor total could not be read");
      }
    } else if (visitorNumber !== null) {
      visitorTotal = visitorNumber;
    }
    const publicConfig = options.adminService.getPublicConfig();
    let target = typeof publicConfig.target === "string" ? publicConfig.target : "";
    let targetPrefillBlocked = false;
    if (publicConfig.accessMode === "open" && target.trim()) {
      try {
        targetPrefillBlocked = !await isSafeOpenTargetForPrefill(await resolveTeamSpeakTarget(target));
      } catch {
        targetPrefillBlocked = true;
      }
      if (targetPrefillBlocked) target = "";
    }
    response.json({
      ...publicConfig,
      target,
      targetPrefillBlocked,
      ...(visitorNumber === null ? {} : { visitorNumber }),
      ...(visitorTotal === null ? {} : { visitorTotal }),
      accelerationAvailable: acceleration.length > 0,
      accelerationRelays: acceleration.map((relay) => ({ id: relay.id, name: relay.name })),
    });
  });

  // Lets a waiting browser find out whether the administrator has answered.
  app.get("/api/access-status", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const deviceAccess = options.adminService.deviceAccess;
    if (!deviceAccess.isRequired()) {
      response.json({ required: false, status: "not-required" });
      return;
    }
    const token = ensureDeviceToken(request, response);
    const status = deviceAccess.status(token);
    const nickname = typeof request.query.nickname === "string" ? request.query.nickname.slice(0, 30) : "";
    response.json({
      required: true,
      status: status === "unknown" ? "none" : status,
      ...(nickname ? deviceAccess.nicknameState(token, nickname) : {}),
    });
  });

  // Password-protected nicknames: the owner sets a password from an approved
  // browser, then uses it to approve their other browsers without a request.
  for (const action of ["setup", "sign-in"] as const) {
    app.post(`/api/account/${action}`, async (request, response) => {
      response.setHeader("Cache-Control", "no-store");
      if (!request.is("application/json") || !isSameOrigin(request)) {
        response.status(403).json({ ok: false, code: "ORIGIN_REJECTED" });
        return;
      }
      if (!joinRateLimiter.allow(request.socket.remoteAddress ?? "unknown")) {
        response.status(429).json({ ok: false, code: "RATE_LIMITED" });
        return;
      }
      const body = isRecord(request.body) ? request.body : {};
      const nickname = typeof body.nickname === "string" ? body.nickname.slice(0, 30) : "";
      const password = typeof body.password === "string" ? body.password.slice(0, 1024) : "";
      const deviceAccess = options.adminService.deviceAccess;
      const token = ensureDeviceToken(request, response);
      const result = action === "setup"
        ? await deviceAccess.createAccount(token, nickname, password)
        : await deviceAccess.signIn(token, nickname, password, {
          clientIp: resolveClientIp(request, trustedProxies),
          userAgent: request.header("user-agent") ?? "",
        });
      if (result.ok) {
        response.json({ ok: true });
        return;
      }
      const status = result.code === "ACCOUNT_LOCKED" ? 429
        : result.code === "ACCOUNT_PASSWORD_INVALID" ? 401
          : result.code === "APPROVAL_DENIED" || result.code === "APPROVAL_REQUIRED" ? 403
            : result.code === "ACCOUNT_EXISTS" || result.code === "DEVICE_HAS_ACCOUNT" ? 409
              : result.code === "ACCOUNT_NOT_FOUND" ? 404 : 400;
      response.status(status).json({ ok: false, code: result.code });
    });
  }

  app.get("/api/skins", async (_request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    response.json({
      skins: await options.skinRegistry?.list() ?? [],
      defaultSkinId: await options.skinRegistry?.getDefaultSkinId() ?? "builtin.light",
    });
  });

  app.get("/api/skins/:id/package", async (request, response) => {
    const id = typeof request.params.id === "string" ? request.params.id : "";
    const archive = await options.skinRegistry?.readArchive(id);
    if (!archive) {
      response.status(404).json({ ok: false, code: "SKIN_NOT_FOUND" });
      return;
    }
    response.setHeader("Cache-Control", "no-cache");
    response.setHeader("Content-Type", "application/octet-stream");
    response.setHeader("Content-Disposition", `attachment; filename="${id}.wskin"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(archive);
  });

  app.get("/api/skins/:id/preview", async (request, response) => {
    const id = typeof request.params.id === "string" ? request.params.id : "";
    const preview = await options.skinRegistry?.readPreview(id);
    if (!preview) {
      response.status(404).end();
      return;
    }
    response.setHeader("Cache-Control", "public, max-age=300");
    response.setHeader("Content-Type", preview.mimeType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.send(preview.bytes);
  });

  app.post("/api/join-ticket", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!request.is("application/json") || !isSameOrigin(request)) {
      response.status(403).json({ ok: false, code: "ORIGIN_REJECTED" });
      return;
    }
    if (!options.adminService.isInitialized()) {
      response.status(503).json({ ok: false, code: "NOT_INITIALIZED" });
      return;
    }
    if (!joinRateLimiter.allow(request.socket.remoteAddress ?? "unknown")) {
      response.status(429).json({ ok: false, code: "RATE_LIMITED" });
      return;
    }
    const body = isRecord(request.body) ? request.body : {};
    const nickname = typeof body.nickname === "string" ? body.nickname.trim().slice(0, 30) : "";
    const requestedChannel = typeof body.channel === "string" ? body.channel.trim().slice(0, 100) : "";
    const inviteToken = typeof body.invite === "string" ? body.invite.trim().slice(0, 128) : "";
    const requestedIdentity = typeof body.identity === "string" && body.identity.length <= 8192 ? body.identity : "";
    let identity: string | undefined;
    if (requestedIdentity) {
      try {
        parseIdentity(requestedIdentity);
        identity = requestedIdentity;
      } catch {
        // A stale/corrupt local identity must not block a normal ephemeral join.
      }
    }
    if (!nickname) {
      response.status(400).json({ ok: false, code: "INVALID_NICKNAME" });
      return;
    }

    // Invitation links are already issued by the administrator, so they skip
    // per-device approval; every other join needs an approved browser.
    if (!inviteToken && options.adminService.deviceAccess.isRequired()) {
      const deviceToken = ensureDeviceToken(request, response);
      // A password-protected nickname needs its password on a browser that is
      // not linked to it, instead of creating a request for the administrator.
      const nicknameRefusal = options.adminService.deviceAccess.checkNickname(deviceToken, nickname);
      if (nicknameRefusal) {
        response.status(403).json({ ok: false, code: nicknameRefusal });
        return;
      }
      const admission = options.adminService.deviceAccess.admit(deviceToken, {
        nickname,
        clientIp: resolveClientIp(request, trustedProxies),
        userAgent: request.header("user-agent") ?? "",
      });
      if (!admission.allowed) {
        if (admission.status === "queue-full") {
          response.status(429).json({ ok: false, code: "APPROVAL_QUEUE_FULL" });
        } else {
          if (admission.status === "pending" && admission.created) logger.info({ nickname }, "New device is waiting for administrator approval");
          response.status(403).json({ ok: false, code: admission.status === "pending" ? "APPROVAL_PENDING" : "APPROVAL_DENIED" });
        }
        return;
      }
    }

    const policy = options.adminService.getConnectionPolicy();
    const managedInvite = inviteToken ? options.adminService.getManagedInvite(inviteToken) : null;
    if (inviteToken && !managedInvite) {
      response.status(400).json({ ok: false, code: "INVITE_INVALID" });
      return;
    }
    let targetText = managedInvite?.target ?? policy.defaultTarget;
    let target: TeamSpeakTarget;
    let serverPassword = policy.serverPassword;
    const channel = requestedChannel || managedInvite?.channel || "";
    const requestedRelayId = typeof body.accelerationRelayId === "string" ? body.accelerationRelayId.trim().slice(0, 110) : "";
    const accelerationRequested = body.accelerated === true || Boolean(requestedRelayId);
    const acceleration = resolveAccelerationOptions(options.voiceBridgeOptions.acceleration);
    if (accelerationRequested && acceleration.length === 0) {
      response.status(400).json({ ok: false, code: "ACCELERATION_UNAVAILABLE" });
      return;
    }
    if (requestedRelayId && !acceleration.some((relay) => relay.id === requestedRelayId)) {
      response.status(400).json({ ok: false, code: "ACCELERATION_UNAVAILABLE" });
      return;
    }
    try {
      if (!managedInvite) {
        if (policy.accessMode === "open" && typeof body.target === "string" && body.target.trim()) {
          targetText = formatTeamSpeakConnectionTarget(parseTeamSpeakConnectionTarget(body.target));
          const isDefault = targetText === policy.defaultTarget;
          if (!isDefault) serverPassword = typeof body.serverPassword === "string" ? body.serverPassword.slice(0, 512) : "";
          else if (typeof body.serverPassword === "string" && body.serverPassword.trim()) serverPassword = body.serverPassword.slice(0, 512);
        } else if (policy.accessMode === "fixed" && typeof body.serverPassword === "string" && body.serverPassword.trim()) {
          // The fixed target remains administrator-controlled, but a user may
          // retry its server password after the gateway reports that one is
          // required. The target itself is never taken from this request.
          serverPassword = body.serverPassword.slice(0, 512);
        }
      }
      target = await resolveTeamSpeakTarget(targetText);
      // Open-mode defaults are user targets too; validate the resolved address
      // and pass that exact IP to the voice connection to prevent DNS rebinding.
      if (!managedInvite && policy.accessMode === "open") target = await resolveSafeOpenTarget(target);
    } catch (error) {
      response.status(400).json({ ok: false, code: error instanceof TeamSpeakAliasLookupError || error instanceof TeamSpeakTargetResolutionError ? "HOST_NOT_FOUND" : "TARGET_NOT_ALLOWED" });
      return;
    }

    if (inviteToken) {
      const consumedInvite = options.adminService.consumeManagedInvite(inviteToken);
      if (!consumedInvite) {
        response.status(400).json({ ok: false, code: "INVITE_INVALID" });
        return;
      }
      serverPassword = consumedInvite.serverPassword;
    }

    const sessionPayload: DelegatedVoiceSession = {
      target,
      serverPassword,
      nickname,
      ...(channel ? { channel } : {}),
      ...(identity ? { identity, rememberIdentity: true } : body.rememberIdentity === true ? { rememberIdentity: true } : {}),
    };
    const selectedRelay = accelerationRequested
      ? requestedRelayId ? acceleration.find((relay) => relay.id === requestedRelayId) : acceleration[0]
      : undefined;
    if (selectedRelay?.voiceEndpoint) {
      try {
        const ticket = await createRemoteVoiceTicket(selectedRelay, sessionPayload);
        response.status(201).json({ ok: true, ticket, voiceEndpoint: selectedRelay.voiceEndpoint });
        return;
      } catch (error: unknown) {
        logger.warn({ relayId: selectedRelay.id, err: error instanceof Error ? error.message : String(error) }, "Relay voice gateway ticket request failed; using legacy UDP acceleration");
      }
    }

    const ticket = options.voiceBridgeOptions.joinTickets.create({
      ...sessionPayload,
      ...(accelerationRequested && selectedRelay ? { accelerated: true, accelerationRelayId: selectedRelay.id } : {}),
    });
    response.status(201).json({ ok: true, ticket });
  });

  app.use("/api/admin", createAdminRouter({
    service: options.adminService,
    sessions: adminSessions,
    logger,
    getActiveSessions: () => voiceBridge.getActiveCount(),
    getPeakSessions: () => voiceBridge.getPeakCount(),
    getCreatedSessions: () => voiceBridge.getCreatedCount(),
    getSessionSummaries: () => voiceBridge.getSessionSummaries(),
    terminateSession: (id) => voiceBridge.terminateSession(id),
    skinRegistry: options.skinRegistry,
    version: options.version,
    logFile: options.logFile,
    startedAt,
  }));

  // Serve static frontend
  if (options.staticDir) {
    app.use(express.static(options.staticDir));
    app.get(/^(?!\/api|\/ws)/, (_req, res) => {
      res.sendFile(path.join(options.staticDir!, "index.html"));
    });
  }

  voiceBridge.attach(server);

  return {
    start(): Promise<void> {
      return new Promise((resolve) => {
        server.listen(options.port, () => {
          logger.info({ port: options.port }, "Web server started");
          resolve();
        });
      });
    },
    async stop(): Promise<void> {
      await voiceBridge.shutdown();
      adminSessions.clear();
      return new Promise((resolve) => {
        server.close(() => resolve());
      });
    },
  };
}

function resolveAccelerationOptions(
  configured: ConfiguredAccelerationRelay[] | (() => ConfiguredAccelerationRelay[]) | undefined,
): ConfiguredAccelerationRelay[] {
  const value = typeof configured === "function" ? configured() : configured;
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

async function createRemoteVoiceTicket(relay: ConfiguredAccelerationRelay, payload: DelegatedVoiceSession): Promise<string> {
  const endpoint = new URL("/api/relay/voice-ticket", relay.voiceEndpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...createVoiceGatewayAuthHeaders(relay.token, payload),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Relay voice gateway returned HTTP ${response.status}`);
  const result: unknown = await response.json().catch(() => null);
  if (!isRecord(result) || result.ok !== true || typeof result.ticket !== "string" || result.ticket.length < 16) {
    throw new Error("Relay voice gateway returned an invalid ticket");
  }
  return result.ticket;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function readVisitorNumberCookie(header: string | undefined): number | null {
  if (!header) return null;
  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;
    const name = entry.slice(0, separator).trim();
    if (name !== VISITOR_NUMBER_COOKIE) continue;
    const rawValue = entry.slice(separator + 1).trim();
    const number = Number.parseInt(rawValue, 10);
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  }
  return null;
}

function isSameOrigin(request: express.Request): boolean {
  const origin = request.header("origin");
  const host = request.header("host");
  try {
    return Boolean(origin && host && new URL(origin).host === host);
  } catch {
    return false;
  }
}
