// Makes the files to hand to the stores, in dist/:
//
//   mikata-<version>-chrome.zip    the Chrome Web Store's upload
//   mikata-<version>-firefox.zip   addons.mozilla.org's upload
//   mikata-<version>-source.zip    the source Mozilla's reviewers rebuild the
//                                  Firefox upload from
//
// Run `bun run package` on a commit with nothing left uncommitted.

import { rm, stat } from "node:fs/promises";
import { join } from "node:path";

import pkg from "./package.json" with { type: "json" };

const root = import.meta.dir;
const dist = join(root, "dist");

/** The build's settings, which are not in the repository and which a rebuild cannot do without. */
const LOCAL_SETTINGS = ".env.local";

async function run(command: string[], cwd = root): Promise<string> {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" });
  const output = await new Response(child.stdout).text();

  if ((await child.exited) !== 0) {
    throw new Error(`${command.join(" ")} failed.`);
  }
  return output;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// The source that goes to the reviewers is the commit, so the upload has to be
// built from exactly that and nothing beside it.
if ((await run(["git", "status", "--porcelain"])).trim() !== "") {
  fail(
    "There are uncommitted changes. Commit them first: the source package is made from the commit.",
  );
}
if (!(await Bun.file(join(root, LOCAL_SETTINGS)).exists())) {
  fail(`There is no ${LOCAL_SETTINGS}, so the extension would be built without its OAuth client.`);
}

await run(["bun", "run", "build"]);

const name = (kind: string): string => `mikata-${pkg.version}-${kind}.zip`;
const made: string[] = [];

/** Zips what is inside a built folder, so that the manifest is at the top of the archive. */
async function zipFolder(folder: string, kind: string): Promise<void> {
  const archive = join(dist, name(kind));

  await rm(archive, { force: true });
  // -X leaves out the extra file attributes macOS would add.
  await run(["zip", "-q", "-r", "-X", archive, ".", "-x", "*.DS_Store"], join(dist, folder));
  made.push(archive);
}

await zipFolder("chrome", "chrome");
await zipFolder("firefox", "firefox");

// Every file of the commit, plus the settings the build read. Those hold the
// OAuth client, which whoever has the upload has already: it is built into it.
const source = join(dist, name("source"));

await rm(source, { force: true });
await run(["git", "archive", "--format=zip", "-o", source, "HEAD"]);
await run(["zip", "-q", "-X", source, LOCAL_SETTINGS]);
made.push(source);

const commit = (await run(["git", "rev-parse", "--short", "HEAD"])).trim();

console.log(`Packaged ${pkg.version} from ${commit}:`);
for (const archive of made) {
  const kilobytes = ((await stat(archive)).size / 1024).toFixed(0);
  console.log(`  ${archive.slice(root.length + 1)}  ${kilobytes} kB`);
}
