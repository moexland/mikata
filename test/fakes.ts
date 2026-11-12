// Test doubles: a fake WebExtension API installed as `globalThis.chrome`, and a
// local HTTP endpoint standing in for both the server and Kamaitachi.
//
// Import this module before anything from src/, because src/shared.ts reads
// `chrome` when it is first loaded.

import vm from "node:vm";

type Listener = (...args: never[]) => void;

function event<T extends Listener>() {
  const listeners = new Set<T>();
  return {
    listeners,
    addListener: (fn: T) => void listeners.add(fn),
    removeListener: (fn: T) => void listeners.delete(fn),
    emit: (...args: Parameters<T>) => [...listeners].forEach((fn) => fn(...args)),
  };
}

type TabUpdate = (
  tabId: number,
  changeInfo: { url?: string; status?: string },
  tab: { id: number; url?: string },
) => void;
type TabRemoval = (tabId: number) => void;

/** Mutable state behind the fake API. Tests adjust it, then call `resetBrowser()` between cases. */
export const browser = {
  store: {} as Record<string, unknown>,
  statuses: [] as Array<{ phase: string } & Record<string, unknown>>,
  /** Tabs returned by tabs.query, i.e. open tabs of the server. */
  openTabs: [] as Array<{ id: number; url: string; discarded: boolean }>,
  /** Called when the code under test opens a tab; returns the new tab's id. */
  onTabCreated: (_url: string): number => 1,
  currentTabId: 5,
  removedTabs: [] as number[],
  activatedTabs: [] as number[],
  tabUpdated: event<TabUpdate>(),
  tabRemoved: event<TabRemoval>(),
};

export function resetBrowser(store: Record<string, unknown> = {}): void {
  browser.store = store;
  browser.statuses = [];
  browser.openTabs = [];
  browser.onTabCreated = () => 1;
  browser.removedTabs = [];
  browser.activatedTabs = [];
  browser.tabUpdated.listeners.clear();
  browser.tabRemoved.listeners.clear();
}

const fakeChrome = {
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((key) => key in browser.store).map((key) => [key, browser.store[key]]),
        ),
      set: async (items: Record<string, unknown>) => {
        if (items.status) {
          browser.statuses.push(items.status as (typeof browser.statuses)[number]);
        }
        Object.assign(browser.store, items);
      },
    },
  },
  tabs: {
    query: async () => browser.openTabs,
    create: async ({ url }: { url: string }) => ({ id: browser.onTabCreated(url) }),
    getCurrent: async () => ({ id: browser.currentTabId }),
    remove: async (tabId: number) => void browser.removedTabs.push(tabId),
    update: async (tabId: number) => void browser.activatedTabs.push(tabId),
    onUpdated: browser.tabUpdated,
    onRemoved: browser.tabRemoved,
  },
  scripting: {
    // Simulates running inside a page: the function is serialised to source and
    // evaluated in a fresh context that only has what a page would provide. This
    // catches injected functions that reference variables from their module.
    executeScript: async ({
      func,
      args,
    }: {
      func: (...a: unknown[]) => unknown;
      args: unknown[];
    }) => {
      const pageFetch = (url: string, init: RequestInit = {}) =>
        fetch(url, {
          ...init,
          headers: { ...(init.headers as Record<string, string>), "x-from-tab": "1" },
        });
      const context = vm.createContext({ fetch: pageFetch, FormData, Blob, String, Object, Error });
      const result = await vm.runInContext(
        `(${func.toString()})(${JSON.stringify(args[0])})`,
        context,
      );
      return [{ result: JSON.parse(JSON.stringify(result)) }];
    },
  },
};

(globalThis as { chrome?: unknown }).chrome = fakeChrome;

/** Mutable behaviour of the mock server. */
export const remote = {
  exportBody: "",
  /** The background request only gets the login page; only a request from a tab gets the export. */
  exportNeedsTab: false,
  /** Origins of the servers whose login has expired. */
  loggedOutOrigins: [] as string[],
  /** What a server sends in place of the export when it wants the user to sign in. */
  signedOutBody: "",
  /** Origin of every export request received, in order. */
  exportRequests: [] as string[],
  tokenPermissions: { submit_score: true } as Record<string, boolean>,
  /** What a finished import reports as its errors. */
  importErrors: [] as Array<{ type: string; message: string }>,
  uploads: [] as Array<{ headers: Headers; body: string; fromTab: boolean }>,
  tokenRequests: [] as Array<{ input: Record<string, string>; headers: Headers }>,
  polls: 0,
};

export const sampleExport = JSON.stringify({
  meta: { game: "maimaidx", playtype: "Single", service: "test" },
  scores: [{ identifier: "1" }, { identifier: "2" }, { identifier: "3" }],
});

export function resetRemote(overrides: Partial<typeof remote> = {}): void {
  Object.assign(remote, {
    exportBody: sampleExport,
    exportNeedsTab: false,
    loggedOutOrigins: [],
    signedOutBody: "<html>login</html>",
    exportRequests: [],
    tokenPermissions: { submit_score: true },
    importErrors: [
      { type: "SongOrChartNotFound", message: "no chart for 2" },
      { type: "InvalidDatapoint", message: "percent out of range" },
    ],
    uploads: [],
    tokenRequests: [],
    polls: 0,
    ...overrides,
  });
}

function json(status: number, value: unknown): Response {
  return Response.json(value, { status });
}

const listener = {
  port: 0,
  hostname: "127.0.0.1",
  async fetch(req: Request): Promise<Response> {
    const { pathname, origin: requestOrigin } = new URL(req.url);
    const fromTab = req.headers.get("x-from-tab") === "1";

    if (pathname === "/rest/playlog/export") {
      remote.exportRequests.push(requestOrigin);

      if (remote.loggedOutOrigins.includes(requestOrigin) || (remote.exportNeedsTab && !fromTab)) {
        // Either way the status says all is well, as servers tend to have it.
        const type = remote.signedOutBody.startsWith("<") ? "text/html" : "application/json";

        return new Response(remote.signedOutBody, { headers: { "content-type": type } });
      }
      return new Response(remote.exportBody, { headers: { "content-type": "application/json" } });
    }

    if (pathname === "/api/v1/import/file" && req.method === "POST") {
      if (req.headers.get("authorization") !== "Bearer good-token") {
        return json(401, {
          success: false,
          description: "The provided API token does not correspond with any key in the database.",
        });
      }
      remote.uploads.push({ headers: req.headers, body: await req.text(), fromTab });
      return json(202, {
        success: true,
        description: "queued",
        body: { importID: "abc123", url: "x" },
      });
    }

    if (pathname === "/api/v1/imports/abc123/poll-status") {
      remote.polls++;
      if (remote.polls === 1) {
        return json(404, { success: false, description: "There is no ongoing import here." });
      }
      if (remote.polls === 2) {
        return json(200, {
          success: true,
          description: "ongoing",
          body: { importStatus: "ongoing" },
        });
      }
      return json(200, {
        success: true,
        description: "done",
        body: {
          importStatus: "completed",
          import: { scoreIDs: ["a"], errors: remote.importErrors },
        },
      });
    }

    if (pathname === "/api/v1/oauth/token" && req.method === "POST") {
      const input = (await req.json()) as Record<string, string>;
      remote.tokenRequests.push({ input, headers: req.headers });

      if (input.client_secret !== "s3cret") {
        return json(403, { success: false, description: "Invalid secret." });
      }
      if (input.code !== "the-code") {
        return json(404, { success: false, description: "This code does not exist." });
      }
      return json(200, {
        success: true,
        description: "ok",
        body: { userID: 1, token: "good-token", permissions: remote.tokenPermissions },
      });
    }

    return json(404, { success: false, description: "not found" });
  },
};

/** Origin of the mock, which plays both a server and the tracker. */
export const origin = `http://127.0.0.1:${Bun.serve(listener).port}`;

/** A second origin backed by the same mock, for syncing from more than one server. */
export const secondOrigin = `http://127.0.0.1:${Bun.serve(listener).port}`;
