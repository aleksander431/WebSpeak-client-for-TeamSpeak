import type { AdventureDraft } from "../../../src/shared/adventure-draft.js";

/** The adventure editor's HTTP API, bound to one link token and this browser's key. */

const KEY_STORAGE = "webspeak:editor-key";

export interface EditorDraftSummary {
  id: string;
  title: string;
  updatedAt: string;
  publishedId?: string;
  publishedAt?: string;
}

export class EditorApiError extends Error {
  constructor(readonly code: string, message: string, readonly field = "", readonly status = 0) {
    super(message || code);
    this.name = "EditorApiError";
  }
}

/** This browser's random key: kept in localStorage, so the approval belongs to this browser. */
export function browserKey(): string {
  try {
    const stored = localStorage.getItem(KEY_STORAGE);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
  } catch { /* storage off: a key per visit */ }
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  try { localStorage.setItem(KEY_STORAGE, key); } catch { /* ignore */ }
  return key;
}

export function createEditorApi(token: string) {
  const key = browserKey();
  const base = `/api/editor/${encodeURIComponent(token)}`;

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "x-editor-key": key, ...(init.body && !(init.body instanceof Blob) ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    });
    let body: Record<string, unknown> = {};
    try { body = await response.json() as Record<string, unknown>; } catch { /* empty */ }
    if (!response.ok || body.ok !== true) {
      throw new EditorApiError(String(body.code ?? `HTTP_${response.status}`), String(body.message ?? ""), String(body.field ?? ""), response.status);
    }
    return body as T;
  }

  return {
    status: () => call<{ label: string; status: "none" | "pending" | "approved" | "denied"; name?: string }>(""),
    request: (name: string) => call<{ status: "pending" | "approved" | "denied" }>("/request", { method: "POST", body: JSON.stringify({ name }) }),
    drafts: () => call<{ drafts: EditorDraftSummary[] }>("/drafts"),
    createDraft: (title: string) => call<{ id: string; draft: AdventureDraft }>("/drafts", { method: "POST", body: JSON.stringify({ title }) }),
    draft: (id: string) => call<{ draft: AdventureDraft; summary: EditorDraftSummary; files: string[] }>(`/drafts/${id}`),
    save: (id: string, draft: AdventureDraft) => call<{ summary: EditorDraftSummary }>(`/drafts/${id}`, { method: "PUT", body: JSON.stringify({ draft }) }),
    remove: (id: string) => call<object>(`/drafts/${id}`, { method: "DELETE" }),
    upload: (id: string, file: Blob) => call<{ file: string; kind: "image" | "audio" }>(`/drafts/${id}/files`, {
      method: "POST", body: file, headers: { "content-type": "application/octet-stream" },
    }),
    publish: (id: string) => call<{ adventure: { id: string; title: string } }>(`/drafts/${id}/publish`, { method: "POST" }),
  };
}

export type EditorApi = ReturnType<typeof createEditorApi>;
