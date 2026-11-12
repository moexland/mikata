// The sync itself: for each configured server, fetch its score export, make the
// changes that server's settings call for, upload it to Kamaitachi, and write
// progress to storage for the popup to display.
//
// The server side reuses the login already present in the browser. The
// Kamaitachi side uses the token obtained through OAuth2 on the settings page.

import {
  api,
  errorMessage,
  hostPattern,
  type Server,
  type ServerResult,
  type StoredState,
  type SyncProgress,
  type SyncStep,
  type TrackerAuth,
} from "./shared.ts";
import { correctTimes } from "./time-offset.ts";

/** The endpoint behind a server's "download scores" button. */
const EXPORT_PATH = "/rest/playlog/export";
/** The import type Kamaitachi's own "Batch Manual" upload page uses. */
const IMPORT_TYPE = "file/batch-manual";
/** Kamaitachi's limit on uploaded files. */
const MAX_FILE_BYTES = 16 * 1024 * 1024;

/** Polling parameters. Exported so tests can shorten them. */
export const timing = {
  pollIntervalMs: 2000,
  pollTimeoutMs: 3 * 60 * 1000,
  // Imports are queued asynchronously, so polling right after the upload can briefly return 404.
  notFoundGraceMs: 15 * 1000,
};

let running = false;

export function isRunning(): boolean {
  return running;
}

interface SyncErrorOptions {
  /** Technical specifics. The popup keeps them out of sight until asked. */
  detail?: string;
  /** The server wants the user to sign in again. */
  needsLogin?: boolean;
  /** Kamaitachi turned the token down. The sync stops and the authorization is marked expired. */
  authorizationRejected?: boolean;
}

/**
 * A problem the user can be told about. The message is a short name for what
 * went wrong, shown as is; anything longer or more technical goes in `detail`.
 */
class SyncError extends Error {
  readonly detail: string | undefined;
  readonly needsLogin: boolean;
  readonly authorizationRejected: boolean;

  constructor(message: string, options: SyncErrorOptions = {}) {
    super(message);
    this.detail = options.detail;
    this.needsLogin = options.needsLogin ?? false;
    this.authorizationRejected = options.authorizationRejected ?? false;
  }
}

interface PageRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** Plain form fields, sent as multipart together with `file`. */
  fields?: Record<string, string>;
  file?: { field: string; name: string; text: string };
}

interface RawResponse {
  ok: boolean;
  /** 0 when the request never got a response. */
  status: number;
  text: string;
}

type JsonObject = Record<string, unknown>;

function setStatus(progress: SyncProgress): Promise<void> {
  return api.storage.local.set({ status: { ...progress, time: Date.now() } });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null;
}

function parseJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Sends a request, including login cookies by default.
 *
 * This function is called directly in the background script and is also injected
 * into a tab as is, so it must not reference anything outside its own body.
 */
async function performRequest(request: PageRequest): Promise<RawResponse> {
  try {
    const init: RequestInit = {
      method: request.method ?? "GET",
      headers: request.headers ?? {},
      credentials: request.credentials ?? "include",
      cache: "no-store",
    };

    if (request.file) {
      const form = new FormData();
      for (const [name, value] of Object.entries(request.fields ?? {})) {
        form.append(name, value);
      }
      form.append(
        request.file.field,
        new Blob([request.file.text], { type: "application/json" }),
        request.file.name,
      );
      init.body = form;
    }

    const res = await fetch(request.url, init);
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (err) {
    return { ok: false, status: 0, text: String(err instanceof Error ? err.message : err) };
  }
}

/**
 * Fallback: sends the same request from inside an already open tab of the site.
 *
 * Used when the browser did not attach the server's login cookies to the
 * background request (SameSite=Strict cookies, Firefox containers, and so on).
 */
async function performRequestViaTab(
  origin: string,
  request: PageRequest,
): Promise<RawResponse | null> {
  try {
    const tabs = await api.tabs.query({ url: hostPattern(origin) });
    const tab = tabs.find((t) => !t.discarded && t.url?.startsWith(origin));

    if (tab?.id === undefined) {
      return null;
    }

    const [injection] = await api.scripting.executeScript({
      target: { tabId: tab.id },
      func: performRequest,
      args: [request],
    });

    return injection?.result ?? null;
  } catch {
    return null;
  }
}

interface BatchManual extends JsonObject {
  scores: unknown[];
}

/** The data as a BATCH-MANUAL document, or null if it is not one. */
function asBatchManual(data: unknown): BatchManual | null {
  if (!isObject(data) || !isObject(data.meta)) {
    return null;
  }

  return typeof data.meta.game === "string" && Array.isArray(data.scores)
    ? (data as BatchManual)
    : null;
}

interface ScoreExport {
  batch: BatchManual;
  /** The export as the server sent it. */
  text: string;
}

/**
 * What a response holds: an export; "other" for something that set out to be
 * an export and is not one Mikata can read; or null for no export at all.
 *
 * A server that wants the user to sign in rarely says so with an error status.
 * It sends its login page, or a few words of JSON, with a status that says all
 * is well. Neither has anything of an export about it, and both count as none.
 */
function readExport(raw: RawResponse | null): ScoreExport | "other" | null {
  if (!raw?.ok) {
    return null;
  }

  const data = parseJSON(raw.text);
  const batch = asBatchManual(data);

  if (batch) {
    return { batch, text: raw.text };
  }
  return isObject(data) && ("meta" in data || "scores" in data) ? "other" : null;
}

async function fetchExport(server: string): Promise<ScoreExport> {
  const request: PageRequest = { url: server + EXPORT_PATH };

  let last = await performRequest(request);
  let found = readExport(last);

  // No export usually means the browser left the login out of a request made
  // from the background, so the same request is tried from a tab of the site.
  if (found === null) {
    const viaTab = await performRequestViaTab(server, request);

    if (viaTab) {
      last = viaTab;
      found = readExport(viaTab);
    }
  }

  if (found === "other") {
    throw new SyncError("Unsupported export format", {
      detail: "The export is not a BATCH-MANUAL document: meta.game or scores is missing.",
    });
  }
  if (found) {
    return found;
  }

  if (last.status === 0) {
    throw new SyncError("Can't reach the server", { detail: last.text });
  }

  if (last.ok || last.status === 401 || last.status === 403) {
    throw new SyncError("Signed out", {
      needsLogin: true,
      detail:
        "The server did not return score data, which usually means the login has expired. Sign in, keep that tab open, and sync again.",
    });
  }

  throw new SyncError(`Server error (${last.status})`);
}

/**
 * The text to upload. It is the export exactly as the server sent it, unless
 * the server's settings call for a change.
 */
function prepareUpload(batch: BatchManual, text: string, server: Server): string {
  const offset = server.timeOffsetMinutes;

  return offset === 0
    ? text
    : JSON.stringify({ ...batch, scores: correctTimes(batch.scores, offset) });
}

interface Envelope {
  success: boolean;
  reason: string | null;
  body: JsonObject;
}

/** Reads Tachi's `{ success, description, body }` response envelope. */
function parseEnvelope(text: string): Envelope {
  const json = parseJSON(text);

  if (!isObject(json)) {
    return { success: false, reason: null, body: {} };
  }

  const reason =
    typeof json.description === "string"
      ? json.description
      : typeof json.error === "string"
        ? json.error
        : null;

  return {
    success: json.success === true,
    reason,
    body: isObject(json.body) ? json.body : {},
  };
}

/** Uploads the export and returns the ID of the queued import. */
async function uploadScores(tracker: TrackerAuth, text: string): Promise<string> {
  const size = new Blob([text]).size;

  if (size > MAX_FILE_BYTES) {
    const sizeMB = (size / 1024 / 1024).toFixed(1);
    throw new SyncError("Export too large", {
      detail: `The export is ${sizeMB} MB. Kamaitachi accepts files up to 16 MB.`,
    });
  }

  const res = await performRequest({
    url: `${tracker.origin}/api/v1/import/file`,
    method: "POST",
    headers: {
      Authorization: `Bearer ${tracker.token}`,
      // The user clicked a button to start this import, which is what Kamaitachi calls user intent.
      "X-User-Intent": "true",
    },
    // Authenticate with the OAuth2 token only. Kamaitachi prefers a session cookie
    // when one is present, so cookies are explicitly left out.
    credentials: "omit",
    fields: { importType: IMPORT_TYPE },
    file: { field: "scoreData", name: "scores.json", text },
  });

  if (res.status === 0) {
    throw new SyncError("Can't reach Kamaitachi", { detail: res.text });
  }
  if (res.status === 401) {
    throw new SyncError("Authorization expired", {
      authorizationRejected: true,
      detail: "Kamaitachi no longer accepts the stored token. Authorize again in settings.",
    });
  }
  if (res.status === 403) {
    throw new SyncError("Authorization can't submit scores", {
      authorizationRejected: true,
      detail: "The stored token lacks the submit_score permission. Authorize again in settings.",
    });
  }
  if (res.status === 429) {
    throw new SyncError("Too many imports", {
      detail: "Kamaitachi allows at most 5 imports per minute. Try again shortly.",
    });
  }

  const envelope = parseEnvelope(res.text);
  const importID = envelope.body.importID;

  if (!res.ok || !envelope.success || typeof importID !== "string") {
    throw new SyncError("Upload rejected", { detail: envelope.reason ?? `HTTP ${res.status}` });
  }

  return importID;
}

/** Polls until the import finishes and returns the import document. The endpoint is public. */
async function waitForImport(tracker: TrackerAuth, importID: string): Promise<JsonObject> {
  const url = `${tracker.origin}/api/v1/imports/${encodeURIComponent(importID)}/poll-status`;
  const started = Date.now();

  while (Date.now() - started < timing.pollTimeoutMs) {
    await sleep(timing.pollIntervalMs);

    let res: Response;
    let envelope: Envelope;
    try {
      res = await fetch(url, { credentials: "omit", cache: "no-store" });
      envelope = parseEnvelope(await res.text());
    } catch {
      // An occasional network error is not a failure; try again next round.
      continue;
    }

    if (res.status === 404 && Date.now() - started < timing.notFoundGraceMs) {
      continue;
    }

    if (!res.ok || !envelope.success) {
      throw new SyncError("Import failed", { detail: envelope.reason ?? `HTTP ${res.status}` });
    }

    if (envelope.body.importStatus === "completed") {
      return isObject(envelope.body.import) ? envelope.body.import : {};
    }
  }

  throw new SyncError("Still processing", {
    detail:
      "The scores were uploaded, but Kamaitachi had not finished importing them after 3 minutes. Check your imports on the site later.",
  });
}

/**
 * Import error types that mean "stored, waiting for chart data" rather than
 * "refused". Kamaitachi keeps such scores as orphans and retries them daily.
 * "OrphanExists" is the same score met again on a later import, which happens
 * on every sync because the whole play log is sent each time.
 *
 * Anything not listed here counts as rejected, so that a new error type is shown
 * to the user instead of being quietly treated as harmless.
 */
const WAITING_ERROR_TYPES = new Set(["SongOrChartNotFound", "OrphanExists"]);

function isWaiting(error: unknown): boolean {
  return isObject(error) && WAITING_ERROR_TYPES.has(String(error.type));
}

function describeImportError(error: unknown): string {
  return isObject(error) ? `${String(error.type)}: ${String(error.message)}` : String(error);
}

/** The short name and the specifics to report for something that was thrown. */
function describeFailure(err: unknown): { message: string; detail: string | undefined } {
  return err instanceof SyncError
    ? { message: err.message, detail: err.detail }
    : { message: "Something went wrong", detail: errorMessage(err) };
}

/** Syncs one server, reporting each step through `report`. */
async function syncServer(
  server: Server,
  tracker: TrackerAuth,
  report: (step: SyncStep, submitted?: number) => Promise<void>,
): Promise<ServerResult> {
  const { origin } = server;

  await report("fetching");
  const { batch, text } = await fetchExport(origin);
  const submitted = batch.scores.length;

  if (submitted === 0) {
    return { server: origin, outcome: "empty" };
  }

  await report("uploading", submitted);
  const importID = await uploadScores(tracker, prepareUpload(batch, text, server));

  // Waiting for each import to finish before starting the next one keeps the
  // imports from competing with each other on Kamaitachi.
  await report("processing", submitted);
  const importDoc = await waitForImport(tracker, importID);
  const errors: unknown[] = Array.isArray(importDoc.errors) ? importDoc.errors : [];
  const rejections = errors.filter((error) => !isWaiting(error));

  return {
    server: origin,
    outcome: "imported",
    submitted,
    imported: Array.isArray(importDoc.scoreIDs) ? importDoc.scoreIDs.length : 0,
    waiting: errors.length - rejections.length,
    rejected: rejections.length,
    // Keep only the first 20 so storage does not fill up.
    rejections: rejections.slice(0, 20).map(describeImportError),
  };
}

/**
 * Syncs every configured server, one after another. A server that fails does not
 * stop the others. Does nothing if a sync is already running.
 */
export async function runSync(): Promise<void> {
  if (running) {
    return;
  }
  running = true;

  try {
    const { servers = [], tracker } = await api.storage.local.get<StoredState>([
      "servers",
      "tracker",
    ]);

    if (servers.length === 0) {
      throw new SyncError("No servers added");
    }
    if (!tracker?.origin || !tracker.token || tracker.expired) {
      throw new SyncError("Not authorized");
    }

    const results: ServerResult[] = [];

    for (const [index, server] of servers.entries()) {
      const report = (step: SyncStep, submitted?: number): Promise<void> =>
        setStatus({
          phase: "running",
          step,
          server: server.origin,
          index,
          total: servers.length,
          submitted,
          results: [...results],
        });

      try {
        results.push(await syncServer(server, tracker, report));
      } catch (err) {
        // A rejected token would fail every remaining server the same way. Record
        // that it is no longer good, so the popup and the settings page can say so
        // without having to ask Kamaitachi.
        if (err instanceof SyncError && err.authorizationRejected) {
          await api.storage.local.set({ tracker: { ...tracker, expired: true } });
          throw err;
        }

        const { message, detail } = describeFailure(err);

        results.push({
          server: server.origin,
          outcome: "failed",
          message,
          ...(detail === undefined ? {} : { detail }),
          needsLogin: err instanceof SyncError && err.needsLogin,
        });
      }
    }

    await setStatus({ phase: "done", results });
  } catch (err) {
    const { message, detail } = describeFailure(err);

    await setStatus({ phase: "error", message, ...(detail === undefined ? {} : { detail }) });
  } finally {
    running = false;
  }
}
