import express from "express";
import type { Logger } from "../logger.js";
import { AdventureEditorError, AdventureEditorStore, EDITOR_MAX_AUDIO_BYTES } from "../admin/adventure-editor.js";
import { JoinRateLimiter } from "./join-rate-limit.js";

export const EDITOR_KEY_HEADER = "x-editor-key";

export interface EditorRouteOptions {
  store: AdventureEditorStore;
  isSameOrigin(request: express.Request): boolean;
  clientIp(request: express.Request): string;
  logger: Pick<Logger, "info" | "warn">;
}

/**
 * The adventure editor's API. Every route names its link by token; the
 * browser proves it is an approved one with its key header. Uploaded files are
 * capability URLs (random names) so pictures load in plain <img> tags.
 */
export function registerEditorRoutes(app: express.Express, options: EditorRouteOptions): void {
  const { store, isSameOrigin, logger } = options;
  const requestLimiter = new JoinRateLimiter();
  const uploadLimiter = new JoinRateLimiter();
  const json = express.json({ limit: "1200kb" });
  const key = (request: express.Request) => request.header(EDITOR_KEY_HEADER) ?? "";
  const token = (request: express.Request) => String(request.params.token ?? "");
  const id = (request: express.Request) => String(request.params.id ?? "");

  const handle = (run: (request: express.Request, response: express.Response) => Promise<unknown> | unknown, mutation = false) =>
    async (request: express.Request, response: express.Response) => {
      response.setHeader("Cache-Control", "no-store");
      if (mutation && !isSameOrigin(request)) { response.status(403).json({ ok: false, code: "ORIGIN_REJECTED" }); return; }
      try {
        const result = await run(request, response);
        if (!response.headersSent) response.json({ ok: true, ...(result as object) });
      } catch (error: unknown) {
        if (error instanceof AdventureEditorError) {
          if (!response.headersSent) response.status(error.status).json({ ok: false, code: error.code, message: error.message, ...(error.field ? { field: error.field } : {}) });
          return;
        }
        logger.warn({ err: error instanceof Error ? error.message : String(error) }, "Adventure editor request failed");
        if (!response.headersSent) response.status(500).json({ ok: false, code: "EDITOR_FAILED" });
      }
    };

  app.get("/api/editor/:token", handle(request => store.status(token(request), key(request))));

  app.post("/api/editor/:token/request", json, handle(request => {
    if (!requestLimiter.allow(options.clientIp(request))) throw new AdventureEditorError("RATE_LIMITED", "Too many requests.", 429);
    const body = (request.body ?? {}) as { name?: unknown };
    return store.request(token(request), key(request), typeof body.name === "string" ? body.name : "");
  }, true));

  app.get("/api/editor/:token/drafts", handle(request => ({ drafts: store.drafts(token(request), key(request)) })));

  app.post("/api/editor/:token/drafts", json, handle(async request => {
    const body = (request.body ?? {}) as { title?: unknown };
    return store.createDraft(token(request), key(request), typeof body.title === "string" ? body.title : "");
  }, true));

  app.get("/api/editor/:token/drafts/:id", handle(request => store.draft(token(request), key(request), id(request))));

  app.put("/api/editor/:token/drafts/:id", json, handle(async request => {
    const body = (request.body ?? {}) as { draft?: unknown };
    return { summary: await store.saveDraft(token(request), key(request), id(request), body.draft) };
  }, true));

  app.delete("/api/editor/:token/drafts/:id", handle(async request => {
    await store.removeDraft(token(request), key(request), id(request));
    return {};
  }, true));

  app.post("/api/editor/:token/drafts/:id/files",
    express.raw({ type: () => true, limit: EDITOR_MAX_AUDIO_BYTES }),
    handle(async request => {
      if (!uploadLimiter.allow(options.clientIp(request))) throw new AdventureEditorError("RATE_LIMITED", "Too many uploads.", 429);
      if (!Buffer.isBuffer(request.body) || !request.body.byteLength) throw new AdventureEditorError("EDITOR_FILE_EMPTY", "The file is empty.");
      return store.upload(token(request), key(request), id(request), request.body);
    }, true));

  app.post("/api/editor/:token/drafts/:id/publish", handle(async request => {
    const adventure = await store.publish(token(request), key(request), id(request));
    logger.info({ adventure: adventure.id, title: adventure.title }, "Adventure published from the editor");
    return { adventure: { id: adventure.id, title: adventure.title } };
  }, true));

  app.get("/api/editor-files/:name", (request, response) => {
    const found = store.filePath(String(request.params.name ?? ""));
    if (!found) { response.status(404).end(); return; }
    response.sendFile(found.path, {
      headers: {
        "Content-Type": found.mimeType, "X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
      dotfiles: "deny",
    }, error => { if (error && !response.headersSent) response.status(404).end(); });
  });
}
