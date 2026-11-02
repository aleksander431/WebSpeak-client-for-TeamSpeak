import type express from "express";
import type { Logger } from "../logger.js";
import { ChatStorage, ChatStorageError } from "./chat-storage.js";
import { JoinRateLimiter } from "./join-rate-limit.js";
import type { ChatSessionScope } from "./voice-bridge.js";
import { CHAT_TOKEN_HEADER, isChatImageMime, type ChatHistoryMessage } from "../shared/chat-storage.js";

export interface ChatRouteOptions {
  storage: ChatStorage;
  resolveSession(token: string | undefined): ChatSessionScope | null;
  /** Adds reaction references to history as the reading session sees them. */
  decorateHistory?(scope: ChatSessionScope, messages: ChatHistoryMessage[]): ChatHistoryMessage[];
  isSameOrigin(request: express.Request): boolean;
  logger: Pick<Logger, "info" | "warn">;
}

/** Chat uploads, attachment downloads and server-side history. */
export function registerChatRoutes(app: express.Express, options: ChatRouteOptions): void {
  const { storage: chatStorage, isSameOrigin, logger } = options;
  const chatUploadLimiter = new JoinRateLimiter();
  const chatSession = (request: express.Request) => options.resolveSession(request.header(CHAT_TOKEN_HEADER) ?? undefined);

  app.post("/api/chat/files", async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (!isSameOrigin(request)) { response.status(403).json({ ok: false, code: "ORIGIN_REJECTED" }); return; }
    const scope = chatSession(request);
    if (!scope) { response.status(401).json({ ok: false, code: "CHAT_SESSION_REQUIRED" }); return; }
    if (!chatUploadLimiter.allow(scope.entryId)) { response.status(429).json({ ok: false, code: "RATE_LIMITED" }); return; }
    const limit = chatStorage.uploadLimit();
    if (limit <= 0) { response.status(403).json({ ok: false, code: "CHAT_UPLOADS_DISABLED" }); return; }
    const declared = Number(request.header("content-length"));
    if (Number.isFinite(declared) && declared > limit) {
      // Refuse before reading a body that cannot be accepted.
      response.setHeader("Connection", "close");
      response.status(413).json({ ok: false, code: "FILE_TOO_LARGE", maxFileBytes: limit });
      request.resume();
      return;
    }
    let name = "file";
    try { name = decodeURIComponent(request.header("x-webspeak-file-name") ?? "file"); } catch { /* keep the fallback */ }
    try {
      const file = await chatStorage.storeUpload(request, name, scope.targetKey);
      logger.info({ entryId: scope.entryId, size: file.size, mime: file.mime }, "Chat file uploaded");
      response.status(201).json({ ok: true, file });
    } catch (error: unknown) {
      const code = error instanceof ChatStorageError ? error.code : "UPLOAD_FAILED";
      const status = code === "FILE_TOO_LARGE" ? 413 : code === "CHAT_UPLOADS_DISABLED" ? 403 : code === "FILE_EMPTY" ? 400 : 500;
      if (status === 500) logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Chat file upload failed");
      if (status === 413) response.setHeader("Connection", "close");
      if (!response.headersSent) response.status(status).json({ ok: false, code, ...(status === 413 ? { maxFileBytes: limit } : {}) });
      request.resume();
    }
  });

  // Attachment links are capability URLs (128-bit random IDs) so native
  // TeamSpeak users can open them too. Only raster images render inline; any
  // other type is a download, and nothing served here may run script.
  app.get(["/api/chat/files/:id", "/api/chat/files/:id/:name"], (request, response) => {
    const id = typeof request.params.id === "string" ? request.params.id : "";
    const file = chatStorage.file(id);
    if (!file) { response.status(404).type("text/plain").send("This file is no longer available."); return; }
    const inline = isChatImageMime(file.info.mime);
    const asciiName = file.info.name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
    response.setHeader("Content-Type", file.info.mime);
    response.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.info.name)}`);
    response.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    response.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    response.sendFile(file.path, { dotfiles: "deny", cacheControl: false, lastModified: false }, (error) => {
      if (error && !response.headersSent) response.status(404).end();
    });
  });

  app.get("/api/chat/history", (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const scope = chatSession(request);
    if (!scope) { response.status(401).json({ ok: false, code: "CHAT_SESSION_REQUIRED" }); return; }
    const kind = request.query.scope === "server" ? "server" : "channel";
    const before = typeof request.query.before === "string" && /^\d+$/.test(request.query.before) ? Number(request.query.before) : undefined;
    // A session reads only its own server and the channel it is in now.
    const channelId = kind === "channel" ? scope.channelId : "";
    const query = typeof request.query.q === "string" ? request.query.q : "";
    const messages = query.trim()
      ? chatStorage.search(scope.targetKey, kind, channelId, query).reverse()
      : chatStorage.history(scope.targetKey, kind, channelId, before);
    response.json({ messages: options.decorateHistory ? options.decorateHistory(scope, messages) : messages });
  });
}
