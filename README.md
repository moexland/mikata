# Mikata

A browser extension that syncs your scores from game servers to
[Kamaitachi](https://kamai.tachi.ac).

Mikata downloads the score export of each server you add, using the login you
already have in the browser, and uploads it to Kamaitachi with a token that can
only submit scores.

## Building

You need [Bun](https://bun.sh) and Node.js.

1. Copy `.env.example` to `.env.local` and fill in a Kamaitachi OAuth2 client.
2. Install and build:

   ```sh
   bun install
   bun run build
   ```

The build writes `dist/` for Chrome and Firefox, and `dist-safari/` for Safari.

## Loading

- **Chrome**: open `chrome://extensions`, turn on Developer mode, choose Load
  unpacked, and pick `dist`.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, choose Load
  Temporary Add-on, and pick `dist/manifest.json`.
- **Safari**: in Settings → Developer, choose Add Temporary Extension, and pick
  `dist-safari`.

## Developing

| Command             | What it does                                           |
| ------------------- | ------------------------------------------------------ |
| `bun run test`      | Runs the tests.                                        |
| `bun run typecheck` | Checks the types.                                      |
| `bun run lint`      | Lints with oxlint.                                     |
| `bun run fmt`       | Formats with oxfmt.                                    |
| `bun run preview`   | Renders every state of the UI to `preview/index.html`. |

## License

[MIT](LICENSE)
