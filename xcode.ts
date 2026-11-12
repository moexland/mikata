// Wraps the Safari build in the app that Safari needs an extension to come in,
// and builds that app for this Mac. Run `bun run xcode`; it needs Xcode.
//
// Everything lands in dist/xcode/: the Xcode project, which Apple's packager
// writes anew each time from dist/safari, and under build/ the app itself. The
// project is not kept in the repository, since nothing in it is written by hand.
//
// The app is signed to run on this Mac only, which takes no developer account.
// Safari leaves such an extension out until "Allow unsigned extensions" is
// ticked under Settings > Developer, and unticks that again whenever it quits.
// Handing the app to anyone else takes the Apple Developer Program.

import { join } from "node:path";

const root = import.meta.dir;
const location = join(root, "dist", "xcode");

const APP_NAME = "Mikata";
/** The app's identifier. It can still be changed until the app is first sent to the App Store. */
const BUNDLE_IDENTIFIER = "land.moex.mikata";
/** The scheme the packager makes for the Mac. There is one for iOS beside it. */
const SCHEME = `${APP_NAME} (macOS)`;

async function run(command: string[]): Promise<void> {
  const child = Bun.spawn(command, { cwd: root, stdout: "inherit", stderr: "inherit" });

  if ((await child.exited) !== 0) {
    console.error(`${command[0]} failed.`);
    process.exit(1);
  }
}

if (process.platform !== "darwin" || Bun.which("xcrun") === null) {
  console.error("This needs a Mac with Xcode installed.");
  process.exit(1);
}

await run(["bun", "x", "vite", "build", "--mode", "safari"]);

// The project refers to the files in dist/safari rather than holding copies of
// them, so a later build of the extension is picked up by building the app again.
await run([
  "xcrun",
  "safari-web-extension-packager",
  join(root, "dist", "safari"),
  "--project-location",
  location,
  "--app-name",
  APP_NAME,
  "--bundle-identifier",
  BUNDLE_IDENTIFIER,
  "--no-open",
  "--no-prompt",
  "--force",
]);

await run([
  "xcodebuild",
  "-quiet",
  "-project",
  join(location, APP_NAME, `${APP_NAME}.xcodeproj`),
  "-scheme",
  SCHEME,
  "-configuration",
  "Release",
  // For any Mac, not this one's processor alone.
  "-destination",
  "generic/platform=macOS",
  "-derivedDataPath",
  join(location, "build"),
  // "Sign to Run Locally": no team, and the identity that stands for none.
  "CODE_SIGN_STYLE=Manual",
  "CODE_SIGN_IDENTITY=-",
  "DEVELOPMENT_TEAM=",
  "build",
]);

const app = join(location, "build", "Build", "Products", "Release", `${APP_NAME}.app`);

console.log(`
Built ${app.slice(root.length + 1)}

To use it in Safari:
  1. Open the app once, so that Safari learns of the extension.
  2. In Safari, under Settings > Developer, tick "Allow unsigned extensions".
  3. Under Settings > Extensions, turn Mikata on.
`);
