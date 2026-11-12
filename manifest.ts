// The extension's manifest. It is written here rather than kept as a JSON file
// because each browser gets one of its own, and because part of it follows
// from src/config.ts. The build writes it out; see vite.config.ts.

import pkg from "./package.json" with { type: "json" };
import { OAUTH_REDIRECT_URI, TRACKER_ORIGIN } from "./src/config.ts";

/** The browsers the extension is built for. Each gets a folder of its own under dist/. */
export const TARGETS = ["chrome", "firefox", "safari"] as const;
export type Target = (typeof TARGETS)[number];

/** Sizes of the icon on its pink tile, for the browser's extension pages and the stores. */
export const TILE_SIZES = [16, 32, 48, 96, 128];
/**
 * Sizes of the toolbar icon, which is the sheets without the tile: 16 and 19
 * at normal density, 32 and 38 at double.
 */
export const TOOLBAR_SIZES = [16, 19, 32, 38];

/**
 * The size the Chrome Web Store shows. It asks that a square icon keep clear of
 * the edges there: 96 pixels of artwork in the middle of the 128. No other
 * store asks for a margin, at this size or any other.
 */
export const CHROME_STORE_SIZE = 128;

// The icons are kept in the repository under these paths, and go into the
// built folders under the same ones. `bun run icons` draws them.
export const tilePath = (size: number): string => `icons/icon-${size}.png`;
export const toolbarPath = (size: number): string => `icons/toolbar-${size}.png`;
/** The tile with the margin Chrome's store asks for. */
export const CHROME_STORE_ICON = `icons/store-${CHROME_STORE_SIZE}.png`;

const bySize = (sizes: number[], path: (size: number) => string): Record<string, string> =>
  Object.fromEntries(sizes.map((size) => [size, path(size)]));

/** The icon for the browser's extension pages and for the stores, by size. */
function extensionIcons(target: Target): Record<string, string> {
  return {
    ...bySize(TILE_SIZES, tilePath),
    ...(target === "chrome" ? { [CHROME_STORE_SIZE]: CHROME_STORE_ICON } : {}),
  };
}

const TOOLBAR_ICONS = bySize(TOOLBAR_SIZES, toolbarPath);

/** The icon files a browser's manifest refers to, which are the ones its folder needs. */
export function iconFiles(target: Target): string[] {
  return [...Object.values(extensionIcons(target)), ...Object.values(TOOLBAR_ICONS)];
}

/** Match pattern covering every page of a site. */
const everyPageOf = (site: string): string => `${new URL(site).origin}/*`;

const BACKGROUND_SCRIPT = "background.js";

/**
 * How the background script is declared. Chrome and Safari run it as a service
 * worker. Firefox has none for extensions and runs the same file as an event
 * page, under a key that Chrome warns about when it finds it.
 */
function background(target: Target): Record<string, unknown> {
  return {
    ...(target === "firefox"
      ? { scripts: [BACKGROUND_SCRIPT] }
      : { service_worker: BACKGROUND_SCRIPT }),
    // The build emits ES modules, and the background script imports from one.
    type: "module",
  };
}

/**
 * The keys only one browser reads. Each set includes the oldest version of
 * that browser Mikata is offered to.
 */
const BROWSER_SPECIFIC: Record<Target, Record<string, unknown>> = {
  chrome: {
    // Released on the same day as Firefox 140, and the last Chrome for macOS 11
    // and for Android 8 and 9.
    minimum_chrome_version: "138",
  },

  firefox: {
    browser_specific_settings: {
      gecko: {
        id: "mikata@moex.land",
        // The first version that asks the user about the data named below, at
        // installation. On an earlier one Mikata would have to ask for itself.
        strict_min_version: "140.0",
        // What leaves the browser: the score exports, which are responses from
        // the servers, on their way to Kamaitachi.
        data_collection_permissions: {
          required: ["websiteContent"],
        },
      },
      // Firefox for Android is left out for now: Mikata has not been tried on
      // it, and without this key it is offered for the desktop only. It came
      // to asking about data two versions after the desktop did, hence 142.
      //
      // gecko_android: {
      //   strict_min_version: "142.0",
      // },
    },
  },

  safari: {
    browser_specific_settings: {
      safari: {
        strict_min_version: "18.4",
      },
    },
  },
};

export function manifest(target: Target): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: "Mikata",
    version: pkg.version,
    description: "Sync the score exports from your servers to Kamaitachi in one click.",
    permissions: ["storage", "scripting"],
    // Kamaitachi, and the page it redirects to once the user has approved.
    host_permissions: [everyPageOf(TRACKER_ORIGIN), everyPageOf(OAUTH_REDIRECT_URI)],
    // The servers, which are only known once the user adds them.
    optional_host_permissions: ["*://*/*"],
    background: background(target),
    icons: extensionIcons(target),
    action: {
      default_title: "Mikata",
      default_popup: "popup.html",
      default_icon: TOOLBAR_ICONS,
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    ...BROWSER_SPECIFIC[target],
  };
}
