// Settings page: manages the list of servers and their settings, and runs the
// OAuth2 authorization for Kamaitachi.

import { OAUTH_REDIRECT_URI, TRACKER_ORIGIN } from "./config.ts";
import { OAUTH_CLIENT } from "./oauth-client.ts";
import { byId, showMessage } from "./dom.ts";
import { requestTrackerToken } from "./oauth.ts";
import {
  api,
  errorMessage,
  hostPattern,
  parseServerAddress,
  type Server,
  serverLabel,
  type StoredState,
  type TrackerAuth,
  withoutServer,
} from "./shared.ts";
import { recommendedTimeOffset, suggestedNames } from "./server-hints.ts";
import { formatOffset, TIME_OFFSETS } from "./time-offset.ts";

const serverList = byId("server-list");
const serverEmpty = byId("server-empty");
const serverRow = byId<HTMLTemplateElement>("server-row");
const serverMessage = byId("server-message");
const addServerButton = byId<HTMLButtonElement>("add-server");

const dialog = byId<HTMLDialogElement>("server-dialog");
const dialogTitle = byId("server-dialog-title");
const dialogForm = byId<HTMLFormElement>("server-form");
const dialogMessage = byId("server-dialog-message");
const addressInput = byId<HTMLInputElement>("server-address");
const timesSelect = byId<HTMLSelectElement>("server-times");
const timesHelp = byId("server-times-help");
const timesAdvice = byId("server-times-advice");
const nameInput = byId<HTMLInputElement>("server-name");
const nameSuggestions = byId("server-name-suggestions");
const removeButton = byId<HTMLButtonElement>("server-remove");
const cancelButton = byId<HTMLButtonElement>("server-cancel");
const saveButton = byId<HTMLButtonElement>("server-save");

const authState = byId("auth-state");
const authorizeButton = byId<HTMLButtonElement>("authorize");
const revokeButton = byId<HTMLButtonElement>("revoke");
const clientMissing = byId("client-missing");
const authHelpBefore = byId("auth-help-before");
const authHelpAfter = byId("auth-help-after");

const trackerHost = new URL(TRACKER_ORIGIN).host;
const clientConfigured = Boolean(OAUTH_CLIENT.clientID && OAUTH_CLIENT.clientSecret);

let servers: Server[] = [];
/** Origin of the server the dialog is editing, or null while it is adding one. */
let editing: string | null = null;
/**
 * The time zone the address in the dialog calls for, and what the menu said
 * before that zone was put in its place. Null while the address calls for none.
 */
let recommendation: { offset: number; replaced: string } | null = null;

/**
 * One line per server: a label, the time zone when its play times are being
 * corrected, and the way into the dialog. The label is the server's name, or
 * its address when it has none, and is cut short when the line has no room for
 * all of it.
 */
function renderServers(): void {
  serverList.replaceChildren();

  for (const server of servers) {
    const item = serverRow.content.firstElementChild!.cloneNode(true) as HTMLElement;
    const label = item.querySelector<HTMLElement>(".server-label")!;
    const times = item.querySelector<HTMLElement>(".server-times")!;
    const edit = item.querySelector("button")!;

    label.textContent = server.name ?? server.origin;
    // The address stays within reach when a name stands in for it, or when it is cut short.
    label.title = server.origin;

    if (server.timeOffsetMinutes !== 0) {
      const zone = formatOffset(server.timeOffsetMinutes);

      times.hidden = false;
      times.title = `Play times are read as ${zone}`;
      times.textContent = zone;
    }

    edit.setAttribute("aria-label", `Edit ${serverLabel(server)}`);
    edit.addEventListener("click", () => openDialog(server));

    serverList.append(item);
  }

  serverEmpty.hidden = servers.length > 0;
}

function saveServers(next: Server[]): Promise<void> {
  servers = next;
  return api.storage.local.set({ servers });
}

/**
 * Lets go of a server that is no longer in the list under this address: what
 * the last sync recorded about it, and the access to its site.
 */
async function forgetServer(origin: string): Promise<void> {
  const { status } = await api.storage.local.get<StoredState>(["status"]);
  const kept = status ? withoutServer(status, origin) : null;

  if (status && kept === null) {
    await api.storage.local.remove("status");
  } else if (kept && kept !== status) {
    await api.storage.local.set({ status: kept });
  }

  await releaseAccess(origin);
}

/** Gives back access to a site, unless a server or Kamaitachi still needs it. */
async function releaseAccess(origin: string): Promise<void> {
  const pattern = hostPattern(origin);
  const stillNeeded = [
    ...servers.map((server) => server.origin),
    TRACKER_ORIGIN,
    OAUTH_REDIRECT_URI,
  ].some((site) => hostPattern(site) === pattern);

  if (!stillNeeded) {
    await api.permissions.remove({ origins: [pattern] }).catch(() => false);
  }
}

/** "Added maimai DX." A name that ends in a full stop of its own, as O.N.G.E.K.I. does, is not given a second. */
function report(action: string, server: Server): void {
  const label = serverLabel(server);

  showMessage(serverMessage, `${action} ${label}${label.endsWith(".") ? "" : "."}`);
}

async function removeServer(server: Server): Promise<void> {
  await saveServers(servers.filter((other) => other.origin !== server.origin));
  renderServers();
  report("Removed", server);
  await forgetServer(server.origin);
}

/** A small button that puts a suggested value in place when pressed. */
function suggestion(text: string, apply: () => void): HTMLButtonElement {
  const button = document.createElement("button");

  button.type = "button";
  button.className = "suggestion";
  button.textContent = text;
  button.addEventListener("click", apply);
  return button;
}

/** The host of the address in the dialog, or nothing while it is not an address yet. */
function typedHostname(): string {
  return parseServerAddress(addressInput.value)?.hostname ?? "";
}

/**
 * Sets the time zone to the one the address calls for, at the moment it starts
 * calling for it. A wrong zone is costly and easy to miss, so this one is put in
 * place rather than offered. It happens once per recommendation: the user can
 * choose otherwise afterwards and typing on will not undo that.
 *
 * When the address stops calling for a zone, the menu goes back to what it said
 * before, unless the user has changed it in the meantime.
 */
function followRecommendation(recommended: number | null): void {
  if (recommended === (recommendation?.offset ?? null)) {
    return;
  }

  if (recommendation && timesSelect.value === String(recommendation.offset)) {
    timesSelect.value = recommendation.replaced;
  }

  recommendation = null;

  if (recommended !== null) {
    recommendation = { offset: recommended, replaced: timesSelect.value };
    timesSelect.value = String(recommended);
  }
}

/**
 * Looks the address up among the servers whose time zone is known, and acts on
 * the answer. `apply` is false when the dialog has just opened on a saved
 * server: what it was saved with stands, whatever its address calls for, and
 * only a change to the address from then on moves the menu.
 */
async function lookUpAddress(apply: boolean): Promise<void> {
  const hostname = typedHostname();
  const recommended = await recommendedTimeOffset(hostname);

  // The address was typed on while the lookup ran. The lookup for what it says
  // now is on its way and will settle things.
  if (hostname !== typedHostname()) {
    return;
  }

  if (apply) {
    followRecommendation(recommended);
  } else {
    recommendation =
      recommended === null ? null : { offset: recommended, replaced: timesSelect.value };
  }
  renderHints();
}

/**
 * Brings the lines under the time zone and the name in line with the address
 * as it stands.
 */
function renderHints(): void {
  // The usual explanation gives way to the recommendation while there is one,
  // whether or not the menu still follows it: it says why the menu moved, and
  // goes on saying what is advised if the user has chosen otherwise.
  timesHelp.hidden = recommendation !== null;
  timesAdvice.hidden = recommendation === null;

  if (recommendation) {
    timesAdvice.textContent = `It's strongly recommended to use ${formatOffset(recommendation.offset)} for this server, to avoid mixed-up play times.`;
  }

  // A name is only offered, since an address can hint at more than one.
  const typed = nameInput.value.trim();
  const names = suggestedNames(typedHostname()).filter((name) => name !== typed);

  nameSuggestions.hidden = names.length === 0;
  nameSuggestions.replaceChildren(
    "Suggested: ",
    ...names.map((name) =>
      suggestion(name, () => {
        nameInput.value = name;
        renderHints();
        // The button just pressed is gone, so the focus goes to what it filled in.
        nameInput.focus();
      }),
    ),
  );
}

/** Opens the dialog on a server from the list, or empty to add a new one. */
function openDialog(server: Server | null): void {
  editing = server?.origin ?? null;

  dialogTitle.textContent = server ? "Edit server" : "Add a server";
  saveButton.textContent = server ? "Save" : "Add";
  removeButton.hidden = !server;

  addressInput.value = server?.origin ?? "";
  timesSelect.value = String(server?.timeOffsetMinutes ?? 0);
  nameInput.value = server?.name ?? "";

  recommendation = null;

  showMessage(dialogMessage, "");
  renderHints();
  dialog.showModal();
  void lookUpAddress(false);
}

/** What the Kamaitachi section is showing. */
type AuthView =
  | { state: "none" | "authorized" | "expired" | "pending" }
  | { state: "failed"; reason: string };

function authViewFor(tracker: TrackerAuth | undefined): AuthView {
  if (tracker?.origin !== TRACKER_ORIGIN || !tracker.token) {
    return { state: "none" };
  }
  return { state: tracker.expired ? "expired" : "authorized" };
}

/**
 * One line says where things stand, and one button offers the step that makes
 * sense from there: authorize when there is no working authorization, remove
 * when there is one. The explanation under the button goes with that step.
 */
function renderAuth(view: AuthView): void {
  switch (view.state) {
    case "none":
      showMessage(authState, "Not authorized yet.");
      break;
    case "authorized":
      showMessage(authState, `Authorized for ${trackerHost}.`);
      break;
    case "expired":
      showMessage(authState, "Authorization expired.", true);
      break;
    case "pending":
      showMessage(authState, "Waiting for your approval on Kamaitachi…");
      break;
    case "failed":
      showMessage(authState, `Authorization did not complete: ${view.reason}`, true);
      break;
  }

  const authorized = view.state === "authorized";

  authorizeButton.hidden = authorized;
  authorizeButton.disabled = !clientConfigured || view.state === "pending";
  revokeButton.hidden = !authorized;
  // Before authorizing, what it will mean; after, how to take it back.
  authHelpBefore.hidden = authorized;
  authHelpAfter.hidden = !authorized;
  clientMissing.hidden = clientConfigured;
}

addServerButton.addEventListener("click", () => openDialog(null));
cancelButton.addEventListener("click", () => dialog.close());

addressInput.addEventListener("input", () => {
  renderHints();
  void lookUpAddress(true);
});
nameInput.addEventListener("input", renderHints);
timesSelect.addEventListener("change", renderHints);

removeButton.addEventListener("click", () => {
  const server = servers.find((known) => known.origin === editing);

  dialog.close();
  if (server) {
    void removeServer(server);
  }
});

dialogForm.addEventListener("submit", (event) => {
  // The dialog closes itself only once the server has been saved.
  event.preventDefault();

  const address = parseServerAddress(addressInput.value);

  if (!address) {
    showMessage(dialogMessage, "Enter a server address, such as wumeng.example.net.", true);
    return;
  }

  const previous = editing;
  const { origin } = address;

  if (origin !== previous && servers.some((known) => known.origin === origin)) {
    showMessage(dialogMessage, "That server is already in the list.", true);
    return;
  }

  const name = nameInput.value.trim();
  const server: Server = {
    origin,
    timeOffsetMinutes: Number(timesSelect.value),
    ...(name ? { name } : {}),
  };

  // An address new to the list needs the user's permission. permissions.request
  // must be called directly in this handler, with no await before it.
  const granted =
    origin === previous
      ? Promise.resolve(true)
      : api.permissions.request({ origins: [hostPattern(address)] });

  granted
    .then(async (allowed) => {
      if (!allowed) {
        showMessage(
          dialogMessage,
          "Permission to access this site was not granted, so it was not saved.",
          true,
        );
        return;
      }

      await saveServers(
        previous === null
          ? [...servers, server]
          : servers.map((known) => (known.origin === previous ? server : known)),
      );
      renderServers();
      dialog.close();
      report(previous === null ? "Added" : "Saved", server);

      // A server given a new address is, to everything kept by address, a
      // server removed and another added.
      if (previous !== null && previous !== origin) {
        await forgetServer(previous);
      }
    })
    .catch((err: unknown) =>
      showMessage(dialogMessage, `Could not save: ${errorMessage(err)}`, true),
    );
});

authorizeButton.addEventListener("click", () => {
  renderAuth({ state: "pending" });

  // Permissions also have to be requested directly in the click handler. Both sites
  // are declared in the manifest, but some browsers let the user withhold them.
  // Access to the redirect page is what lets the extension read the tab's address
  // once authorization completes.
  api.permissions
    .request({ origins: [hostPattern(TRACKER_ORIGIN), hostPattern(OAUTH_REDIRECT_URI)] })
    .then(async (granted) => {
      if (!granted) {
        throw new Error("permission to access Kamaitachi and the redirect page was not granted.");
      }

      const token = await requestTrackerToken({
        trackerOrigin: TRACKER_ORIGIN,
        client: OAUTH_CLIENT,
        redirectUri: OAUTH_REDIRECT_URI,
      });

      await api.storage.local.set({ tracker: { origin: TRACKER_ORIGIN, token } });
      renderAuth({ state: "authorized" });
    })
    .catch((err: unknown) => renderAuth({ state: "failed", reason: errorMessage(err) }));
});

revokeButton.addEventListener("click", () => {
  void api.storage.local.remove("tracker").then(() => renderAuth({ state: "none" }));
});

// A sync marks the authorization as expired when Kamaitachi turns the token down.
// Pick that up if this page happens to be open at the time.
api.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.tracker) {
    renderAuth(authViewFor(changes.tracker.newValue as TrackerAuth | undefined));
  }
});

async function init(): Promise<void> {
  byId("redirect-uri").textContent = OAUTH_REDIRECT_URI;

  const stored = await api.storage.local.get<StoredState>(["servers", "tracker"]);

  for (const minutes of TIME_OFFSETS) {
    timesSelect.append(new Option(formatOffset(minutes), String(minutes)));
  }

  servers = stored.servers ?? [];
  renderServers();
  renderAuth(authViewFor(stored.tracker));
}

void init();
