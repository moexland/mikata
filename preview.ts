// Renders every state of the extension's pages into one static file,
// preview/index.html, for checking the UI without loading the extension.
//
// Each state is an iframe holding the real page, with a fake extension API
// injected in front of it. Run `bun run preview` after changing the UI.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { build } from "vite";

import { OAUTH_REDIRECT_URI, TRACKER_ORIGIN } from "./src/config.ts";
import type { Server, ServerResult, StoredState, SyncProgress } from "./src/shared.ts";

type Page = "popup" | "options";

interface Frame {
  page: Page;
  title: string;
  /** What storage.local contains when the page opens. */
  store: StoredState;
  /** Popup: the background script reports a sync in progress. */
  running?: boolean;
  /** Settings: the user's answer to the browser's permission prompt. Defaults to granting it. */
  permission?: boolean;
  /** Settings: what happens in the authorization tab. */
  auth?: "pending" | "closed" | "approve";
  /** Settings: render as a build with no OAuth client configured. */
  noClient?: boolean;
  /** Script run in the page once it has loaded, to reach states that follow an interaction. */
  act?: string;
}

// ─── Sample data ──────────────────────────────────────────────────────────────

const [maimai, chunithm, ongeki, wacca] = [
  "https://maimai.example.net",
  "https://chunithm.example.net",
  "https://ongeki.example.net",
  "https://wacca.example.net",
] as const;

const server = (origin: string, timeOffsetMinutes = 0, name?: string): Server => ({
  origin,
  timeOffsetMinutes,
  ...(name ? { name } : {}),
});
const servers = [server(maimai), server(chunithm), server(ongeki)];
const tracker = { origin: TRACKER_ORIGIN, token: "preview" };
const time = Date.UTC(2026, 10, 11, 12, 30);

const imported: ServerResult = {
  server: maimai,
  outcome: "imported",
  submitted: 128,
  imported: 5,
  waiting: 0,
  rejected: 0,
  rejections: [],
};
const importedWithNotes: ServerResult = {
  ...imported,
  waiting: 2,
  rejected: 1,
  rejections: ["InvalidDatapoint: percent out of range"],
};
const needsLogin: ServerResult = {
  server: chunithm,
  outcome: "failed",
  needs: "login",
  message: "Signed out",
  detail:
    "The server did not return score data, which usually means the login has expired. Sign in, keep that tab open, and sync again.",
};
const noAccess: ServerResult = {
  server: chunithm,
  outcome: "failed",
  needs: "access",
  message: "Access not granted",
  detail:
    "The browser is not letting Mikata read this server's site, so its scores can't be fetched. Allow access and sync again.",
};
const empty: ServerResult = { server: ongeki, outcome: "empty" };
const unreachable: ServerResult = {
  server: wacca,
  outcome: "failed",
  message: "Can't reach the server",
  detail: "Failed to fetch",
};

// A list as it looks once set up: two servers with names, one of them giving its
// times in Japan time, and one still known by its address.
const named = [
  server(maimai, 0, "maimai DX"),
  server(chunithm),
  server(ongeki, 540, "O.N.G.E.K.I."),
];
const ready: StoredState = { servers: named, tracker };
const withStatus = (status: SyncProgress, list: Server[] = named): StoredState => ({
  servers: list,
  tracker,
  status: { ...status, time },
});

const mixedResults = withStatus(
  { phase: "done", results: [importedWithNotes, needsLogin, empty, unreachable] },
  [...named, server(wacca)],
);

const click = (selector: string): string =>
  `document.querySelector(${JSON.stringify(selector)}).click();`;
/** Sets a field of the server dialog the way typing or choosing would. */
const setField = (id: string, value: string, event = "input"): string =>
  `{
    const field = document.getElementById(${JSON.stringify(id)});
    field.value = ${JSON.stringify(value)};
    field.dispatchEvent(new Event(${JSON.stringify(event)}));
  }`;
const submitDialog = 'document.getElementById("server-form").requestSubmit();';
/** Runs a step a moment later, as a person would: after the page has looked the address up. */
const later = (step: string): string => `setTimeout(() => { ${step} }, 40);`;
const typeAddress = (address: string): string =>
  click("#add-server") + setField("server-address", address);
const submitServer = (address: string): string => typeAddress(address) + submitDialog;
/** Opens the dialog on the server at the given place in the list. */
const editServer = (index: number): string =>
  `document.querySelectorAll("#server-list button")[${index}].click();`;

// ─── Every state ──────────────────────────────────────────────────────────────

const frames: Frame[] = [
  { page: "popup", title: "No servers yet", store: {} },
  { page: "popup", title: "Not authorized", store: { servers } },
  { page: "popup", title: "Ready", store: ready },
  { page: "popup", title: "Starting", store: ready, running: true },
  {
    page: "popup",
    title: "Fetching, single server",
    running: true,
    store: withStatus(
      { phase: "running", step: "fetching", server: maimai, index: 0, total: 1, results: [] },
      [server(maimai)],
    ),
  },
  {
    page: "popup",
    title: "Uploading, second of three",
    running: true,
    store: withStatus({
      phase: "running",
      step: "uploading",
      server: chunithm,
      index: 1,
      total: 3,
      submitted: 64,
      results: [imported],
    }),
  },
  {
    page: "popup",
    title: "Processing, third of three",
    running: true,
    store: withStatus({
      phase: "running",
      step: "processing",
      server: ongeki,
      index: 2,
      total: 3,
      submitted: 1,
      results: [imported, needsLogin],
    }),
  },
  {
    page: "popup",
    title: "Interrupted",
    store: withStatus({
      phase: "running",
      step: "uploading",
      server: chunithm,
      index: 1,
      total: 3,
      submitted: 64,
      results: [imported],
    }),
  },
  {
    page: "popup",
    title: "Done, everything synced",
    store: withStatus({ phase: "done", results: [imported] }, [server(maimai)]),
  },
  {
    page: "popup",
    title: "Done, mixed results",
    store: mixedResults,
  },
  {
    page: "popup",
    title: "Done, mixed results, details opened",
    store: mixedResults,
    act: 'document.querySelectorAll("details").forEach((details) => (details.open = true));',
  },
  {
    page: "popup",
    title: "Done, access to a server withdrawn",
    store: withStatus({ phase: "done", results: [imported, noAccess, empty] }),
  },
  {
    page: "popup",
    title: "Done, scores waiting on Kamaitachi",
    store: withStatus({ phase: "done", results: [{ ...imported, waiting: 12 }] }, [server(maimai)]),
  },
  {
    page: "popup",
    title: "Done, many rejected scores",
    store: withStatus(
      {
        phase: "done",
        results: [
          {
            ...imported,
            rejected: 37,
            rejections: Array.from(
              { length: 20 },
              (_, i) => `InvalidDatapoint: percent out of range (record ${i + 1})`,
            ),
          },
        ],
      },
      [server(maimai)],
    ),
  },
  {
    page: "popup",
    title: "Authorization expired",
    // As a sync leaves things when Kamaitachi turns the token down.
    store: {
      ...withStatus({
        phase: "error",
        message: "Authorization expired",
        detail: "Kamaitachi no longer accepts the stored token. Authorize again in settings.",
      }),
      tracker: { ...tracker, expired: true },
    },
  },
  {
    page: "popup",
    title: "Stopped, unexpected error",
    store: withStatus({
      phase: "error",
      message: "Something went wrong",
      detail: "storage is unavailable",
    }),
  },

  { page: "options", title: "First run", store: {} },
  { page: "options", title: "Servers added, not authorized", store: { servers } },
  { page: "options", title: "Authorized", store: ready },
  {
    page: "options",
    title: "Authorization expired",
    store: { servers, tracker: { ...tracker, expired: true } },
  },
  {
    page: "options",
    title: "After adding a server",
    store: { servers: [server(maimai), server(chunithm)] },
    act: submitServer("ongeki.example.net/login"),
  },
  {
    page: "options",
    title: "Address is not a web address",
    store: { servers },
    act: submitServer("ftp://example.net"),
  },
  {
    page: "options",
    title: "Address already in the list",
    store: { servers },
    act: submitServer(maimai),
  },
  {
    page: "options",
    title: "Permission declined",
    store: { servers: [server(maimai)] },
    permission: false,
    act: submitServer(chunithm),
  },
  {
    page: "options",
    title: "A name too long for its line",
    store: {
      servers: [
        server("https://a-rather-long-subdomain.of-a-rather-long-domain.example.net", 540),
        server(maimai, 0, "The server I play maimai DX on when I am at home"),
      ],
    },
  },
  { page: "options", title: "Adding a server", store: { servers }, act: click("#add-server") },
  {
    page: "options",
    title: "Adding, address suggests a game",
    store: { servers },
    act: typeAddress("mai.example.net"),
  },
  {
    page: "options",
    title: "Adding, address calls for Japan time",
    store: { servers },
    act: typeAddress("geki.example.net"),
  },
  {
    page: "options",
    title: "Adding, Japan time turned down",
    store: { servers },
    act: typeAddress("geki.example.net") + later(setField("server-times", "0", "change")),
  },
  {
    page: "options",
    title: "Adding, address no longer calls for Japan time",
    store: { servers },
    act: typeAddress("geki.example.net") + later(setField("server-address", "chu.example.net")),
  },
  { page: "options", title: "Editing a server", store: ready, act: editServer(2) },
  {
    page: "options",
    title: "After editing a server",
    store: { servers },
    act:
      editServer(2) +
      setField("server-times", "540", "change") +
      setField("server-name", "O.N.G.E.K.I.") +
      submitDialog,
  },
  {
    page: "options",
    title: "After removing a server",
    store: ready,
    act: editServer(0) + click("#server-remove"),
  },
  {
    page: "options",
    title: "Authorizing",
    store: { servers },
    auth: "pending",
    act: click("#authorize"),
  },
  {
    page: "options",
    title: "Authorization succeeded",
    store: { servers },
    auth: "approve",
    act: click("#authorize"),
  },
  {
    page: "options",
    title: "Authorization abandoned",
    store: { servers },
    auth: "closed",
    act: click("#authorize"),
  },
  {
    page: "options",
    title: "After removing the authorization",
    store: ready,
    act: click("#revoke"),
  },
  { page: "options", title: "No OAuth client configured", store: { servers }, noClient: true },
];

// ─── Code that runs in the browser ────────────────────────────────────────────

interface StubSpec extends Frame {
  id: number;
  redirect: string;
}

/**
 * Runs inside each iframe before the page's own script. Installs a fake
 * extension API fed by `spec`, and reports the document's height to the gallery.
 * Serialised into the page, so it must not reference anything outside its body.
 */
function frameStub(spec: StubSpec): void {
  const store = spec.store as Record<string, unknown>;
  const updated = new Set<(...args: unknown[]) => void>();
  const removed = new Set<(...args: unknown[]) => void>();
  const event = (listeners: Set<(...args: unknown[]) => void>) => ({
    addListener: (fn: (...args: unknown[]) => void) => void listeners.add(fn),
    removeListener: (fn: (...args: unknown[]) => void) => void listeners.delete(fn),
  });
  const authTab = 2;

  const fakeApi = {
    storage: {
      local: {
        get: async (keys: string[]) =>
          Object.fromEntries(keys.filter((key) => key in store).map((key) => [key, store[key]])),
        set: async (items: Record<string, unknown>) => void Object.assign(store, items),
        remove: async (key: string) => void delete store[key],
      },
      onChanged: { addListener() {} },
    },
    runtime: {
      // A sync never finishes here; only the "is one running" question gets an answer.
      sendMessage: (message: { type: string }) =>
        message.type === "isRunning"
          ? Promise.resolve({ running: Boolean(spec.running) })
          : new Promise(() => {}),
      openOptionsPage: async () => {},
    },
    permissions: {
      request: async () => spec.permission !== false,
      contains: async () => false,
      remove: async () => true,
    },
    tabs: {
      getCurrent: async () => ({ id: 1 }),
      update: async () => {},
      remove: async () => {},
      create: async ({ url }: { url: string }) => {
        // Play the user's part in the authorization tab.
        setTimeout(() => {
          if (spec.auth === "closed") {
            removed.forEach((fn) => fn(authTab));
          } else if (spec.auth === "approve") {
            const callback = new URL(spec.redirect);
            callback.searchParams.set("code", "preview");
            callback.searchParams.set("context", new URL(url).searchParams.get("context") ?? "");
            updated.forEach((fn) => fn(authTab, { url: callback.href }, { id: authTab }));
          }
        }, 0);
        return { id: authTab };
      },
      onUpdated: event(updated),
      onRemoved: event(removed),
    },
  };

  // The extension uses `browser` when it exists and `chrome` otherwise. Safari
  // gives ordinary web pages a partial `browser` object of its own, so both names
  // have to point at the fake.
  Object.assign(window, { browser: fakeApi, chrome: fakeApi });

  // The only request a page makes itself is the token exchange.
  window.fetch = (async () =>
    Response.json({
      success: true,
      description: "ok",
      body: { token: "preview", permissions: { submit_score: true } },
    })) as unknown as typeof fetch;

  // The gallery sizes each iframe to its content, so the page itself never needs to
  // scroll. Leaving scrolling on lets a scrollbar appear before the first resize,
  // which narrows the page and can keep itself alive.
  document.documentElement.style.overflow = "hidden";

  const reportHeight = (): void => {
    // An open dialog lies over the page rather than in it, so the page does not
    // grow to hold it. The frame is made tall enough for the dialog as well.
    const dialog = document.querySelector("dialog[open]");
    const height = Math.max(
      document.documentElement.scrollHeight,
      dialog ? dialog.scrollHeight + 64 : 0,
    );

    parent.postMessage({ frame: spec.id, height }, "*");
  };

  addEventListener("load", () => {
    reportHeight();
    new ResizeObserver(reportHeight).observe(document.documentElement);

    if (spec.act) {
      // Wait for the page's own start-up, which reads storage first.
      setTimeout(() => {
        (new Function(spec.act!) as () => void)();
        // Twice, because a dialog first fits itself to the frame it opens in.
        setTimeout(reportHeight, 50);
        setTimeout(reportHeight, 200);
      }, 60);
    }
  });
}

interface GalleryData {
  frames: Frame[];
  pages: Record<Page, string>;
  scripts: Record<Page, string>;
  css: string;
  /** The tags in a page's source that the gallery puts the above in place of. */
  stylesheetTag: string;
  scriptTags: Record<Page, string>;
  stub: string;
  clientID: string;
  redirect: string;
}

/** Runs in the gallery page: builds one iframe per state and handles the theme switch. */
function gallery(data: GalleryData): void {
  // The popup is 21.5rem wide plus 1rem of padding each side, at its 14px root.
  const widths: Record<Page, number> = { popup: 329, options: 600 };
  const sections: Array<[Page, string]> = [
    ["popup", "Popup"],
    ["options", "Settings page"],
  ];

  // The pages choose their colours with a media query, which an iframe cannot be
  // told to answer differently, so the query itself is rewritten.
  const forceTheme = (css: string, theme: string): string =>
    css
      .replaceAll(
        "@media (prefers-color-scheme: dark)",
        theme === "dark" ? "@media all" : "@media not all",
      )
      .replaceAll("color-scheme: light dark", `color-scheme: ${theme}`);

  const inline = (code: string): string => `<script>${code}</script>`;

  const frameDocument = (frame: Frame, id: number, theme: string): string => {
    const spec = JSON.stringify({ ...frame, id, redirect: data.redirect }).replaceAll(
      "<",
      "\\u003c",
    );
    const script = frame.noClient
      ? data.scripts[frame.page].replaceAll(JSON.stringify(data.clientID), '""')
      : data.scripts[frame.page];

    return data.pages[frame.page]
      .replace(data.stylesheetTag, () => `<style>${forceTheme(data.css, theme)}</style>`)
      .replace(
        data.scriptTags[frame.page],
        () => inline(`(${data.stub})(${spec})`) + inline(script),
      );
  };

  const main = document.querySelector("main")!;
  const iframes: HTMLIFrameElement[] = [];

  const addCard = (parent: Element, title: string, width: number): HTMLIFrameElement => {
    const card = document.createElement("figure");
    const caption = document.createElement("figcaption");
    const iframe = document.createElement("iframe");

    caption.textContent = title;
    iframe.title = title;
    iframe.style.width = `${width}px`;
    card.append(caption, iframe);
    parent.append(card);
    return iframe;
  };

  const addSection = (heading: string): Element => {
    const section = document.createElement("section");
    const h2 = document.createElement("h2");
    const grid = document.createElement("div");

    h2.textContent = heading;
    grid.className = "grid";
    section.append(h2, grid);
    main.append(section);
    return grid;
  };

  for (const [page, heading] of sections) {
    const grid = addSection(heading);

    data.frames.forEach((frame, id) => {
      if (frame.page === page) {
        iframes[id] = addCard(grid, frame.title, widths[page]);
      }
    });
  }

  const render = (theme: string): void => {
    document.documentElement.dataset.theme = theme;
    document.querySelectorAll<HTMLButtonElement>("header button").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
    });

    data.frames.forEach((frame, id) => {
      iframes[id]!.srcdoc = frameDocument(frame, id, theme);
    });
  };

  addEventListener("message", (message: MessageEvent<{ frame?: number; height?: number }>) => {
    const { frame, height } = message.data ?? {};

    if (typeof frame === "number" && typeof height === "number" && iframes[frame]) {
      iframes[frame].style.height = `${height}px`;
    }
  });

  document.querySelectorAll<HTMLButtonElement>("header button").forEach((button) => {
    button.addEventListener("click", () => render(button.dataset.theme!));
  });

  render(matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

// ─── Assembling the file ──────────────────────────────────────────────────────

const root = import.meta.dir;
const source = (path: string): Promise<string> => Bun.file(join(root, path)).text();

/** The OAuth client the gallery's pages are built with. It exists nowhere else. */
const PREVIEW_CLIENT = { clientID: "preview-client", clientSecret: "preview-secret" };

/**
 * A page's script as one self-contained classic script. The extension itself is
 * built as ES modules that import from each other, which cannot be written
 * inline into a frame, so the gallery bundles the scripts its own way.
 */
async function bundle(page: Page): Promise<string> {
  const result = await build({
    configFile: false,
    root,
    logLevel: "warn",
    // The gallery is built with a client of its own: the real one has no place
    // in a file that is made to be passed around. Turning off .env files is not
    // enough for that, since Bun has already read .env.local into the
    // environment this script runs in, and Vite looks there too. The values
    // defined here are what take its place.
    envDir: false,
    define: {
      "import.meta.env.VITE_OAUTH_CLIENT_ID": JSON.stringify(PREVIEW_CLIENT.clientID),
      "import.meta.env.VITE_OAUTH_CLIENT_SECRET": JSON.stringify(PREVIEW_CLIENT.clientSecret),
    },
    build: {
      write: false,
      minify: false,
      lib: { entry: join(root, "src", `${page}.ts`), formats: ["iife"], name: "mikata" },
    },
  });

  const files = (Array.isArray(result) ? result : [result]).flatMap((built) =>
    "output" in built ? built.output : [],
  );
  const script = files.find((file) => file.type === "chunk");

  if (script?.type !== "chunk") {
    throw new Error(`Bundling src/${page}.ts produced no script.`);
  }
  return script.code;
}

const stylesheetTag = '<link rel="stylesheet" href="/src/ui.css" />';
const scriptTag = (page: Page): string => `<script type="module" src="/src/${page}.ts"></script>`;

/** A page's source, which has to contain the two tags the gallery replaces. */
async function page(name: Page): Promise<string> {
  const html = await source(`${name}.html`);

  for (const tag of [stylesheetTag, scriptTag(name)]) {
    if (!html.includes(tag)) {
      throw new Error(`${name}.html no longer contains ${tag}`);
    }
  }
  return html;
}

const data: GalleryData = {
  frames,
  pages: { popup: await page("popup"), options: await page("options") },
  scripts: { popup: await bundle("popup"), options: await bundle("options") },
  css: await source("src/ui.css"),
  stylesheetTag,
  scriptTags: { popup: scriptTag("popup"), options: scriptTag("options") },
  stub: frameStub.toString(),
  clientID: PREVIEW_CLIENT.clientID,
  redirect: OAUTH_REDIRECT_URI,
};

// The "no OAuth client" state is made by blanking the client ID in the script, which
// only works while the ID is written there as a plain string.
if (!data.scripts.options.includes(JSON.stringify(PREVIEW_CLIENT.clientID))) {
  throw new Error("The settings script does not contain the client ID as a string.");
}

for (const script of Object.values(data.scripts)) {
  if (script.includes("</script")) {
    throw new Error("A built script contains a closing script tag and cannot be inlined.");
  }
}

// Everything below is placed inside an inline <script>, where a closing script tag
// in the text would end the element early. "<\/script" means the same to JavaScript
// and "<" the same to JSON, and neither is seen as a tag by the HTML parser.
const galleryCode = gallery.toString().replaceAll("</script", "<\\/script");
const galleryData = JSON.stringify(data).replaceAll("<", "\\u003c");

const html = `<!doctype html>
<html lang="en">
	<head>
		<meta charset="utf-8" />
		<meta name="viewport" content="width=device-width, initial-scale=1" />
		<title>Mikata UI preview</title>
		<style>
			:root { --page: #f1f1f4; --ink: #1c1c1e; --soft: #6b6b70; --edge: #d2d2d8; }
			:root[data-theme="dark"] { --page: #111113; --ink: #f2f2f4; --soft: #a0a0a8; --edge: #3a3a40; }
			body { margin: 0; padding: 24px; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, sans-serif; }
			header { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
			h1 { margin: 0 auto 0 0; font-size: 18px; }
			h2 { margin: 32px 0 12px; font-size: 15px; }
			header button { padding: 4px 12px; border: 1px solid var(--edge); border-radius: 6px; background: none; color: inherit; font: inherit; cursor: pointer; }
			header button[aria-pressed="true"] { border-color: var(--ink); font-weight: 600; }
			.grid { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 24px; }
			figure { margin: 0; }
			figcaption { margin-bottom: 6px; color: var(--soft); font-size: 12px; }
			iframe { display: block; max-width: 100%; height: 120px; border: 1px solid var(--edge); border-radius: 8px; }
		</style>
	</head>
	<body>
		<header>
			<h1>Mikata UI preview</h1>
			<button type="button" data-theme="light">Light</button>
			<button type="button" data-theme="dark">Dark</button>
		</header>
		<main></main>
		<script>(${galleryCode})(${galleryData})</script>
	</body>
</html>
`;

// The real client is within reach of this script (see bundle), so the file is
// checked for it before it is written.
for (const real of [process.env.VITE_OAUTH_CLIENT_ID, process.env.VITE_OAUTH_CLIENT_SECRET]) {
  if (real && html.includes(real)) {
    throw new Error("The preview would contain the real OAuth client; refusing to write it.");
  }
}

const outdir = join(root, "preview");
await mkdir(outdir, { recursive: true });
await Bun.write(join(outdir, "index.html"), html);

console.log(`Rendered ${frames.length} states into ${join(outdir, "index.html")}`);
