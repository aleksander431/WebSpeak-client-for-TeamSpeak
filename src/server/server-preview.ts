import type { ServerPreview, ServerPreviewChannel } from "../shared/server-preview.js";

export interface ServerPreviewSources {
  /** Whether the gateway has one fixed TeamSpeak target. */
  fixed(): boolean;
  /** The list a connected WebSpeak session sees right now, if any. */
  live(): Promise<ServerPreviewChannel[] | null>;
  /** A ServerQuery read, or null when query access is not set up. */
  query(): Promise<ServerPreviewChannel[] | null>;
  now?(): number;
}

/** A query result is reused this long, so page views never hammer ServerQuery. */
export const SERVER_PREVIEW_QUERY_TTL_MS = 10_000;
/** After a failed or unconfigured query, wait this long before asking again. */
export const SERVER_PREVIEW_QUERY_RETRY_MS = 30_000;

/**
 * Builds the join page's server overview: a connected session's live list
 * first (free and current), then a cached ServerQuery read.
 */
export class ServerPreviewService {
  private cached: { at: number; ttl: number; channels: ServerPreviewChannel[] | null } | null = null;
  private pending: Promise<ServerPreviewChannel[] | null> | null = null;

  constructor(private readonly sources: ServerPreviewSources) {}

  async read(): Promise<ServerPreview> {
    if (!this.sources.fixed()) return { available: false, reason: "open-mode" };
    const now = () => this.sources.now?.() ?? Date.now();
    const live = await this.sources.live().catch(() => null);
    if (live) return { available: true, source: "live", channels: live, observedAt: new Date(now()).toISOString() };
    const channels = await this.query(now);
    if (!channels) return { available: false, reason: "no-source" };
    return { available: true, source: "query", channels, observedAt: new Date(this.cached?.at ?? now()).toISOString() };
  }

  private async query(now: () => number): Promise<ServerPreviewChannel[] | null> {
    if (this.cached && now() - this.cached.at < this.cached.ttl) return this.cached.channels;
    if (!this.pending) {
      this.pending = this.sources.query().catch(() => null).then(channels => {
        this.cached = { at: now(), ttl: channels ? SERVER_PREVIEW_QUERY_TTL_MS : SERVER_PREVIEW_QUERY_RETRY_MS, channels };
        return channels;
      }).finally(() => { this.pending = null; });
    }
    return this.pending;
  }
}
