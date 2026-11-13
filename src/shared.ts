// Types and helpers shared by the background script, the popup and the settings page.

/** The WebExtension API namespace: `browser` where it exists, otherwise `chrome`. */
export const api: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;

/** Saved by the settings page once OAuth2 authorization succeeds. */
export interface TrackerAuth {
  origin: string;
  token: string;
  /**
   * Set by a sync when Kamaitachi turns the token down. Nothing checks the token
   * in between: a sync is where it gets used, so that is where its fate is known.
   */
  expired?: boolean;
}

/** A server to sync from, and what is known about its export. */
export interface Server {
  origin: string;
  /**
   * Offset from UTC, in minutes, of the time zone the server writes play times
   * in. 0 when its times are already UTC and need no correction.
   */
  timeOffsetMinutes: number;
  /** A name the user gave the server, shown in place of its address. */
  name?: string;
}

/** What to call a server in a sentence or a tight space: its name, or failing that its host. */
export function serverLabel(server: Server): string {
  return server.name ?? new URL(server.origin).host;
}

/** What the sync is doing for the server it is currently on. */
export type SyncStep = "fetching" | "uploading" | "processing";

/**
 * The one thing that would put a failure right, where there is one: signing in
 * to the server again, or letting Mikata reach the server's site again.
 */
export type Need = "login" | "access";

/** How the sync went for one server. */
export type ServerResult =
  | {
      server: string;
      outcome: "imported";
      submitted: number;
      imported: number;
      /**
       * Scores Kamaitachi has stored but cannot place on a chart yet. It retries
       * them by itself once it knows the chart, so they need nothing from the user.
       */
      waiting: number;
      /** Scores Kamaitachi turned down. */
      rejected: number;
      /** Its reasons for the first few of them. */
      rejections: string[];
    }
  | { server: string; outcome: "empty" }
  | {
      server: string;
      outcome: "failed";
      /** A short name for what went wrong, shown as is. */
      message: string;
      /** Technical specifics, shown only when the user asks for them. */
      detail?: string;
      needs?: Need;
    };

export type SyncProgress =
  | {
      phase: "running";
      step: SyncStep;
      server: string;
      /** Position of `server` in the list, starting at 0. */
      index: number;
      total: number;
      submitted?: number;
      /** Results of the servers already finished. */
      results: ServerResult[];
    }
  | { phase: "done"; results: ServerResult[] }
  // A problem that stopped the whole sync rather than a single server.
  | { phase: "error"; message: string; detail?: string };

/** Progress of the latest sync, written by the background script and rendered by the popup. */
export type SyncStatus = SyncProgress & { time: number };

/**
 * The latest sync's progress with one server left out, for when that server is
 * taken off the list: what was kept about it goes with it.
 *
 * Returns the status unchanged when the server has no part in it, and null when
 * leaving the server out leaves nothing worth showing.
 */
export function withoutServer(status: SyncStatus, origin: string): SyncStatus | null {
  // A problem that stopped the whole sync is about no server in particular.
  if (status.phase === "error") {
    return status;
  }

  // Progress left behind by a sync that was interrupted while on this server
  // cannot be told without naming it.
  if (status.phase === "running" && status.server === origin) {
    return null;
  }

  const results = status.results.filter((result) => result.server !== origin);

  if (results.length === status.results.length) {
    return status;
  }
  if (status.phase === "done" && results.length === 0) {
    return null;
  }
  return { ...status, results };
}

/** Everything the extension keeps in storage.local. */
export interface StoredState {
  /** The servers to sync from, in order. */
  servers?: Server[];
  tracker?: TrackerAuth;
  status?: SyncStatus;
}

/** Messages the popup sends to the background script. */
export type Message = { type: "sync" } | { type: "isRunning" };

export interface IsRunningReply {
  running: boolean;
}

/**
 * Match pattern covering every page of a site.
 * Firefox does not allow ports in match patterns, so only the scheme and host are used.
 */
export function hostPattern(site: string | URL): string {
  const url = new URL(site);
  return `${url.protocol}//${url.hostname}/*`;
}

/**
 * Reads a server address the way a person types one. A bare domain is taken to
 * mean https. Returns null for anything that is not an http(s) address.
 */
export function parseServerAddress(input: string): URL | null {
  const text = input.trim();

  if (!text) {
    return null;
  }

  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//iu.test(text);

  try {
    const url = new URL(hasScheme ? text : `https://${text}`);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    return null;
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
