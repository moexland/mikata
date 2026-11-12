// The extension's manifest. It is written here rather than kept as a JSON file
// because it differs between the folders the build produces, and because part of
// it follows from src/config.ts. The build writes it out; see vite.config.ts.

import pkg from "./package.json" with { type: "json" };
import { OAUTH_REDIRECT_URI, TRACKER_ORIGIN } from "./src/config.ts";

/** Which folder is being built: "safari" is dist-safari/, "default" is dist/ for Chrome and Firefox. */
export type Target = "default" | "safari";

/**
 * Sizes of the icon on its pink tile: 16 to 38 for the toolbar at its normal and
 * doubled densities, 48 to 128 for the browser's extension pages.
 */
export const TILE_SIZES = [16, 19, 32, 38, 48, 96, 128];
/** Sizes of Safari's toolbar icon, which has no tile. */
export const TOOLBAR_SIZES = [16, 19, 32, 38];

export const tilePath = (size: number): string => `icons/icon-${size}.png`;
export const toolbarPath = (size: number): string => `icons/toolbar-${size}.png`;

const bySize = (sizes: number[], path: (size: number) => string): Record<string, string> =>
  Object.fromEntries(sizes.map((size) => [size, path(size)]));

/** Match pattern covering every page of a site. */
const everyPageOf = (site: string): string => `${new URL(site).origin}/*`;

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
    background: {
      // Chrome and Safari read service_worker, Firefox reads scripts.
      service_worker: "background.js",
      scripts: ["background.js"],
      // The build emits ES modules, and the background script imports from one.
      type: "module",
    },
    icons: bySize([16, 32, 48, 96, 128], tilePath),
    action: {
      default_title: "Mikata",
      default_popup: "popup.html",
      default_icon:
        target === "safari"
          ? bySize(TOOLBAR_SIZES, toolbarPath)
          : bySize([16, 19, 32, 38], tilePath),
    },
    options_ui: {
      page: "options.html",
      open_in_tab: true,
    },
    browser_specific_settings: {
      gecko: {
        id: "mikata@moex.land",
        strict_min_version: "128.0",
      },
    },
  };
}
