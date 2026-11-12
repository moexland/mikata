// Builds the extension. `vite build` writes dist/, the folder to load in Chrome
// and Firefox; `vite build --mode safari` writes dist-safari/, the one to load in
// Safari. The two differ only in the toolbar icon.
//
// The pages (popup.html, options.html) are ordinary Vite entry points. The
// background script has no page of its own, so it is listed as an entry beside
// them. Everything comes out as ES modules, which share their common code
// through imports.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Resvg } from "@resvg/resvg-js";
import { defineConfig, type Plugin } from "vite";

import {
  manifest,
  type Target,
  TILE_SIZES,
  tilePath,
  TOOLBAR_SIZES,
  toolbarPath,
} from "./manifest.ts";

const root = import.meta.dirname;
const iconSource = resolve(root, "src/icon.svg");

function render(svg: string, size: number): Uint8Array {
  const image = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    // The drawing has no text, and looking up the system's fonts takes about a second each time.
    font: { loadSystemFonts: false },
  });

  return image.render().asPng();
}

/**
 * The drawing without its tile, with the frame pulled in so the sheets fill it.
 *
 * Safari shows a toolbar icon in grey on pages the extension has no access to,
 * and in the icon's own colours on pages it does. The pink tile turns into a grey
 * block in the first case, which is nearly always. So Safari gets the sheets
 * alone, in pink: grey sheets on most pages, pink ones on the servers and on
 * Kamaitachi.
 *
 * Safari takes an image drawn in a single colour for a template, whatever that
 * colour is, and tints it with the system accent colour instead of showing it
 * as drawn. Black sheets and sheets in one pink were both tinted. Hence the two
 * pinks: the sheet behind is a lighter one.
 */
function withoutTile(source: string): string {
  const changes: Array<[string, string]> = [
    // The sheets span 32.2 units from top to bottom, centred on the canvas.
    [`viewBox="0 0 48 48"`, `viewBox="7.5 7.5 33 33"`],
    [`<rect id="tile" width="48" height="48" rx="10.5" fill="#e91e63" />`, ""],
    [`<g id="sheets" fill="#fff">`, `<g id="sheets" fill="#e91e63">`],
    [`<rect id="back" `, `<rect id="back" fill="#f06292" `],
  ];

  return changes.reduce((svg, [from, to]) => {
    if (!svg.includes(from)) {
      throw new Error(`src/icon.svg no longer contains ${from}`);
    }
    return svg.replace(from, to);
  }, source);
}

/**
 * Adds the files of an extension that no page or script refers to: the manifest,
 * and the icons it lists. The icon is drawn once, in src/icon.svg, and rendered
 * here at every size; no size is drawn by hand.
 */
function extensionFiles(target: Target): Plugin {
  return {
    name: "mikata:extension-files",

    async generateBundle() {
      const emit = (fileName: string, source: string | Uint8Array): void =>
        void this.emitFile({ type: "asset", fileName, source });

      this.addWatchFile(iconSource);
      const tile = await readFile(iconSource, "utf8");

      for (const size of TILE_SIZES) {
        emit(tilePath(size), render(tile, size));
      }

      if (target === "safari") {
        const sheets = withoutTile(tile);

        for (const size of TOOLBAR_SIZES) {
          emit(toolbarPath(size), render(sheets, size));
        }
      }

      emit("manifest.json", `${JSON.stringify(manifest(target), null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const target: Target = mode === "safari" ? "safari" : "default";

  return {
    plugins: [extensionFiles(target)],
    build: {
      outDir: target === "safari" ? "dist-safari" : "dist",
      // Left readable: the size does not matter for files loaded from disk, and
      // the stores' reviewers read what is submitted.
      minify: false,
      // Every browser the extension runs in preloads modules by itself.
      modulePreload: { polyfill: false },
      rolldownOptions: {
        input: {
          popup: resolve(root, "popup.html"),
          options: resolve(root, "options.html"),
          background: resolve(root, "src/background.ts"),
        },
        output: {
          // The manifest refers to the background script by name, so it keeps a
          // plain one. Everything else is found through the pages and through
          // imports, and gets Vite's usual hashed name under assets/.
          entryFileNames: (chunk) =>
            chunk.name === "background" ? "background.js" : "assets/[name]-[hash].js",
        },
      },
    },
  };
});
