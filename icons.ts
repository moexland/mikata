// Draws the icons: renders src/icon.svg into the PNG files under icons/. Run
// `bun run icons` after changing the drawing, and commit what it writes.
//
// The PNGs are kept in the repository rather than drawn by the build, because
// the renderer is a native program that differs from one system to the next,
// and a build has to come out the same wherever it is run.

import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

import { Resvg } from "@resvg/resvg-js";

import {
  CHROME_STORE_ICON,
  CHROME_STORE_SIZE,
  TILE_SIZES,
  tilePath,
  TOOLBAR_SIZES,
  toolbarPath,
} from "./manifest.ts";

const root = import.meta.dir;

function render(svg: string, size: number): Uint8Array {
  const image = new Resvg(svg, {
    fitTo: { mode: "width", value: size },
    // The drawing has no text, and looking up the system's fonts takes about a second each time.
    font: { loadSystemFonts: false },
  });

  return image.render().asPng();
}

/** The frame of the drawing as src/icon.svg gives it: the tile and nothing around it. */
const FRAME = `viewBox="0 0 48 48"`;

/** Makes each change to the drawing, and refuses if the text to change is not there. */
function rewrite(source: string, changes: Array<[from: string, to: string]>): string {
  return changes.reduce((svg, [from, to]) => {
    if (!svg.includes(from)) {
      throw new Error(`src/icon.svg no longer contains ${from}`);
    }
    return svg.replace(from, to);
  }, source);
}

/**
 * The drawing without its tile, with the frame pulled in so the sheets fill it.
 * This is the toolbar icon in every browser: at that size the sheets are easier
 * to make out when they have the whole frame to themselves.
 *
 * Its colours answer to Safari, which is the hardest to please. Safari shows a
 * toolbar icon in grey on pages the extension has no access to, and in the
 * icon's own colours on pages it does. A tile would turn into a grey block in
 * the first case, which is nearly always; the sheets alone turn into grey
 * sheets.
 *
 * Safari also takes an image drawn in a single colour for a template, whatever
 * that colour is, and tints it with the system accent colour instead of showing
 * it as drawn. Black sheets and sheets in one pink were both tinted. Hence the
 * two pinks: the sheet behind is a lighter one.
 */
function withoutTile(source: string): string {
  return rewrite(source, [
    // The sheets span 32.2 units from top to bottom, centred on the canvas.
    [FRAME, `viewBox="7.5 7.5 33 33"`],
    [`<rect id="tile" width="48" height="48" rx="10.5" fill="#e91e63" />`, ""],
    [`<g id="sheets" fill="#fff">`, `<g id="sheets" fill="#e91e63">`],
    [`<rect id="back" `, `<rect id="back" fill="#f06292" `],
  ]);
}

/**
 * The drawing with a clear margin around the tile, which then takes up three
 * quarters of the image. Only Chrome's store icon is drawn this way; everywhere
 * else the tile fills the image.
 */
function withMargin(source: string): string {
  return rewrite(source, [[FRAME, `viewBox="-8 -8 64 64"`]]);
}

const tile = await Bun.file(join(root, "src/icon.svg")).text();
const sheets = withoutTile(tile);

const files: Array<[path: string, png: Uint8Array]> = [
  ...TILE_SIZES.map((size): [string, Uint8Array] => [tilePath(size), render(tile, size)]),
  ...TOOLBAR_SIZES.map((size): [string, Uint8Array] => [toolbarPath(size), render(sheets, size)]),
  [CHROME_STORE_ICON, render(withMargin(tile), CHROME_STORE_SIZE)],
];

for (const [path, png] of files) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await Bun.write(join(root, path), png);
}

console.log(`Drew ${files.length} icons into ${join(root, "icons")}`);
