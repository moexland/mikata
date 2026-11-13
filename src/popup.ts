// Popup: starts a sync and shows the progress the background script writes to storage.
//
// Every state uses the same layout: a status line with the time of the sync it
// speaks of, optional specifics folded away under it, one row per server, then
// the two buttons, which never trade places or prominence and are always the
// last thing in the popup. When something has to be set up first, the status
// line says so. A problem is shown as a short name with the one action that
// addresses it; longer explanations and technical output stay folded until the
// user opens them.

import { byId } from "./dom.ts";
import {
  api,
  hostPattern,
  type IsRunningReply,
  type Message,
  type ServerResult,
  serverLabel,
  type StoredState,
  type SyncStatus,
} from "./shared.ts";

const statusEl = byId("status");
const detailEl = byId("detail");
const resultsEl = byId("results");
const syncButton = byId<HTMLButtonElement>("sync");
const settingsButton = byId<HTMLButtonElement>("settings");
const timeEl = byId("time");

let state: StoredState = {};
// Whether the background script is syncing right now. Distinguishes a sync in
// progress from progress left behind by an interrupted one.
let backgroundRunning = false;

function send(message: Message): Promise<unknown> {
  return api.runtime.sendMessage(message);
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * What to call the server at an address: the name it has in the list, or its
 * host when it is no longer there.
 */
function nameOf(origin: string): string {
  const server = state.servers?.find((known) => known.origin === origin);

  if (server) {
    return serverLabel(server);
  }

  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
}

/** A collapsed block for specifics the user only sometimes wants. */
function disclosure(summary: string, lines: string[]): HTMLDetailsElement {
  const details = document.createElement("details");
  const label = document.createElement("summary");

  label.textContent = summary;
  details.append(label);

  if (lines.length === 1) {
    const text = document.createElement("p");
    text.textContent = lines[0]!;
    details.append(text);
  } else {
    const list = document.createElement("ul");
    for (const line of lines) {
      const item = document.createElement("li");
      item.textContent = line;
      list.append(item);
    }
    details.append(list);
  }

  return details;
}

function progressText(status: Extract<SyncStatus, { phase: "running" }>): string {
  const name = nameOf(status.server);
  const where = status.total > 1 ? `${name} (${status.index + 1} of ${status.total})` : name;
  const records = count(status.submitted ?? 0, "record");

  switch (status.step) {
    case "fetching":
      return `${where}: fetching scores…`;
    case "uploading":
      return `${where}: uploading ${records} to Kamaitachi…`;
    case "processing":
      return `${where}: waiting for Kamaitachi to process ${records}…`;
  }
}

function resultText(result: ServerResult): string {
  switch (result.outcome) {
    case "imported":
      return `${count(result.imported, "new score")} from ${count(result.submitted, "record")}.`;
    case "empty":
      return "Nothing to sync.";
    case "failed":
      return result.message;
  }
}

/** The folded specifics for a row, if it has any. */
function resultDetails(result: ServerResult): HTMLDetailsElement[] {
  if (result.outcome === "failed") {
    return result.detail ? [disclosure("Details", [result.detail])] : [];
  }

  if (result.outcome !== "imported") {
    return [];
  }

  const details: HTMLDetailsElement[] = [];

  if (result.waiting > 0) {
    details.push(
      disclosure(`${count(result.waiting, "score")} waiting on Kamaitachi`, [
        "Kamaitachi has stored these but does not know their charts yet. It retries them every day, so there is nothing you need to do.",
      ]),
    );
  }

  if (result.rejected > 0) {
    const hidden = result.rejected - result.rejections.length;
    const lines = hidden > 0 ? [...result.rejections, `…and ${hidden} more.`] : result.rejections;

    details.push(disclosure(`${count(result.rejected, "score")} rejected`, lines));
  }

  return details;
}

/**
 * The button for the one thing that would put a failure right, if there is
 * such a thing. `onAllowed` is called once the access a row asks for is there.
 */
function remedy(
  result: Extract<ServerResult, { outcome: "failed" }>,
  onAllowed: () => void,
): HTMLButtonElement | null {
  if (!result.needs) {
    return null;
  }

  const button = document.createElement("button");
  button.type = "button";

  if (result.needs === "login") {
    button.textContent = "Sign in";
    button.addEventListener("click", () => void api.tabs.create({ url: result.server }));
  } else {
    const site = { origins: [hostPattern(result.server)] };
    const settle = (allowed: boolean): void => {
      if (allowed) {
        button.disabled = true;
        button.textContent = "Allowed";
        onAllowed();
      }
    };

    button.textContent = "Allow access";
    // Allowing does not start a sync. Access tends to lapse for every server
    // at once, and each sync sends each server's whole play log again: the
    // user allows them one by one and then syncs once.
    //
    // The browser asks only if the request is made right here in the click
    // handler, and some browsers close the popup while they ask. So the row
    // also finds out for itself, each time it is drawn, whether it still
    // stands.
    button.addEventListener("click", () => {
      void api.permissions
        .request(site)
        .then(settle)
        .catch(() => {});
    });
    void api.permissions
      .contains(site)
      .then(settle)
      .catch(() => {});
  }

  return button;
}

/** One row per server: its host, what happened, and the action or specifics that go with it. */
function renderResults(results: ServerResult[]): void {
  resultsEl.replaceChildren();

  for (const result of results) {
    const item = document.createElement("li");
    item.classList.toggle("failed", result.outcome === "failed");

    const head = document.createElement("div");
    head.className = "result-head";

    const name = document.createElement("strong");
    name.textContent = nameOf(result.server);
    head.append(name);

    const text = document.createElement("p");
    text.textContent = resultText(result);

    const details = resultDetails(result);

    const action =
      result.outcome === "failed"
        ? remedy(result, () => {
            // What the row said was true of the last sync and is so no longer.
            item.classList.remove("failed");
            text.textContent = "Ready to sync again.";
            for (const block of details) {
              block.remove();
            }
          })
        : null;

    if (action) {
      head.append(action);
    }

    item.append(head, text, ...details);
    resultsEl.append(item);
  }

  resultsEl.hidden = results.length === 0;
}

function render(): void {
  const { servers = [], tracker, status } = state;

  statusEl.classList.remove("error");
  detailEl.replaceChildren();
  timeEl.textContent = "";
  renderResults([]);

  if (servers.length === 0) {
    statusEl.textContent = "Add a server in settings first.";
    syncButton.disabled = true;
    return;
  }

  if (tracker?.expired) {
    statusEl.classList.add("error");
    statusEl.textContent = "Kamaitachi authorization expired. Authorize again in settings.";
    syncButton.disabled = true;
    return;
  }

  if (!tracker?.token) {
    statusEl.textContent = "Authorize access to Kamaitachi in settings first.";
    syncButton.disabled = true;
    return;
  }

  const busy = backgroundRunning && (!status || status.phase === "running");
  syncButton.disabled = busy;

  if (busy) {
    statusEl.textContent = status?.phase === "running" ? progressText(status) : "Starting…";
    renderResults(status?.phase === "running" ? status.results : []);
    return;
  }

  if (!status) {
    statusEl.textContent = "Sync your scores to Kamaitachi.";
    return;
  }

  timeEl.textContent = new Date(status.time).toLocaleString();

  switch (status.phase) {
    case "running":
      statusEl.textContent = "The last sync was interrupted. You can run it again.";
      renderResults(status.results);
      return;

    case "error":
      statusEl.classList.add("error");
      statusEl.textContent = status.message;
      if (status.detail) {
        detailEl.append(disclosure("Details", [status.detail]));
      }
      return;

    case "done": {
      const total = status.results.length;
      const synced = status.results.filter((result) => result.outcome !== "failed").length;

      statusEl.textContent =
        synced === total ? "Sync complete." : `${synced} of ${count(total, "server")} synced.`;
      renderResults(status.results);
    }
  }
}

syncButton.addEventListener("click", () => {
  backgroundRunning = true;
  state = { ...state, status: undefined };
  render();

  // The background script replies only when the sync has finished; progress
  // arrives through the storage listener below.
  void send({ type: "sync" })
    .catch(() => {})
    .finally(() => {
      backgroundRunning = false;
      render();
    });
});

settingsButton.addEventListener("click", () => void api.runtime.openOptionsPage());

api.storage.onChanged.addListener((changes, area) => {
  if (area !== "local") {
    return;
  }

  const next: Record<string, unknown> = { ...state };
  for (const key of ["servers", "tracker", "status"] satisfies Array<keyof StoredState>) {
    if (changes[key]) {
      next[key] = changes[key].newValue;
    }
  }
  state = next as StoredState;
  render();
});

async function init(): Promise<void> {
  state = await api.storage.local.get<StoredState>(["servers", "tracker", "status"]);

  try {
    const reply = (await send({ type: "isRunning" })) as IsRunningReply | undefined;
    backgroundRunning = Boolean(reply?.running);
  } catch {
    backgroundRunning = false;
  }

  render();
}

void init();
