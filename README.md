# Mikata

A browser extension that syncs your scores from game servers to
[Kamaitachi](https://kamai.tachi.ac).

Mikata downloads the score export of each server you add, using the login you
already have in the browser, and uploads it to Kamaitachi with a token that can
only submit scores.

## Building

You need:

- [Bun](https://bun.sh) 1.4.2. Where there is only npm, `npm install --global
  bun@1.4.2` installs it.
- Node.js 22.12 or later, which runs the build itself.

Any system these two run on will do. Then:

1. Copy `.env.example` to `.env.local` and fill in a Kamaitachi OAuth2 client.
   A source package made by `bun run package` already has this file.
2. Install and build:

   ```sh
   bun install --frozen-lockfile
   bun run build
   ```

The build writes one folder for each browser: `dist/chrome`, `dist/firefox` and
`dist/safari`. It makes the same files wherever it is run: nothing in it
depends on the system, and the icons are not drawn by it but kept in `icons/`.

## Loading

- **Chrome**: open `chrome://extensions`, turn on Developer mode, choose Load
  unpacked, and pick `dist/chrome`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, choose Load
  Temporary Add-on, and pick `dist/firefox/manifest.json`.
- **Safari**: in Settings → Developer, choose Add Temporary Extension, and pick
  `dist/safari`.

## Developing

| Command             | What it does                                                              |
| ------------------- | ------------------------------------------------------------------------- |
| `bun run test`      | Runs the tests.                                                           |
| `bun run typecheck` | Checks the types.                                                         |
| `bun run lint`      | Lints with oxlint.                                                        |
| `bun run fmt`       | Formats with oxfmt.                                                       |
| `bun run preview`   | Renders every state of the UI to `preview/index.html`.                    |
| `bun run icons`     | Draws `icons/` again from `src/icon.svg`. Commit the result.              |
| `bun run package`   | Makes the archives for the stores, in `dist/`.                            |
| `bun run xcode`     | Wraps the Safari build in an app and builds it for this Mac. Needs Xcode. |

## License

[MIT](LICENSE)
