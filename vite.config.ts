// Builds the extension for one browser: `vite build --mode firefox` writes
// dist/firefox/, the folder to load in Firefox, and likewise for chrome and
// safari. `bun run build` does all three. The folders hold the same code and
// differ in the manifest, and Chrome's in the icon its store shows.
//
// The pages (popup.html, options.html) are ordinary Vite entry points. The
// background script has no page of its own, so it is listed as an entry beside
// them. Everything comes out as ES modules, which share their common code
// through imports.

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { defineConfig, type Plugin } from "vite";

import { iconFiles, manifest, type Target, TARGETS } from "./manifest.ts";

const root = import.meta.dirname;

/**
 * Adds the files of an extension that no page or script refers to: the manifest,
 * and the icons it lists. The icons are copied as they are in the repository;
 * drawing them is `bun run icons`, and no part of the build.
 */
function extensionFiles(target: Target): Plugin {
  return {
    name: "mikata:extension-files",

    async generateBundle() {
      const emit = (fileName: string, source: string | Uint8Array): void =>
        void this.emitFile({ type: "asset", fileName, source });

      for (const path of iconFiles(target)) {
        const file = resolve(root, path);

        this.addWatchFile(file);
        emit(path, await readFile(file));
      }

      emit("manifest.json", `${JSON.stringify(manifest(target), null, 2)}\n`);
    },
  };
}

export default defineConfig(({ mode }) => {
  const target = TARGETS.find((name) => name === mode);

  if (!target) {
    throw new Error(
      `There is no "${mode}" build. Pass --mode with one of: ${TARGETS.join(", ")}; or run the build script, which builds them all.`,
    );
  }

  return {
    plugins: [extensionFiles(target)],
    build: {
      outDir: `dist/${target}`,
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
