// What the settings page can tell about a server from its address: a time zone
// for the servers it knows, and a guess at a name for any other.

/**
 * Servers known to give play times in a zone other than UTC, as the hash of
 * their host and that zone in minutes from UTC.
 *
 * Hashes, because the addresses themselves are not Mikata's to publish. A hash
 * keeps an address from being read off this file. It does not keep someone who
 * already has the address from checking whether it is listed here.
 *
 * `bun run hash <address>` prints the line to add for a server.
 */
const TIME_OFFSETS_BY_HOST: Record<string, number> = {
  // geki.example.net, a reserved name that no real server can have. It is here
  // so that the preview and the tests have an address the rule applies to.
  bab6e0d9e07219e45a519e9cc9cf4a678cec232da0e05adc67044cf5a3e803c9: 540,
  "5154c8cec23e3edb3c2067807d4a019c9b8c5a29e3e7368095e850ed15371b62": 540,
};

/** The key a host is listed under in the table above. */
export async function hashHostname(hostname: string): Promise<string> {
  // The prefix keeps a ready-made table of plain SHA-256 hashes of domain names
  // from matching anything here.
  const bytes = new TextEncoder().encode(`mikata:${hostname.toLowerCase()}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);

  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The time zone a server is known to give its play times in, as minutes from
 * UTC, or null when the server is not one Mikata knows.
 */
export async function recommendedTimeOffset(hostname: string): Promise<number | null> {
  if (!hostname) {
    return null;
  }
  return TIME_OFFSETS_BY_HOST[await hashHostname(hostname)] ?? null;
}

/** A piece of an address, and the names of the games it points to as their makers write them. */
const GAMES: Array<[fragment: string, names: string[]]> = [
  ["mai", ["maimai", "maimai DX"]],
  ["chu", ["CHUNITHM"]],
  ["geki", ["O.N.G.E.K.I."]],
];

/**
 * Names to suggest for a server: those of the games its address hints at.
 * A guess, where the time zone is a lookup: a wrong guess here costs nothing.
 */
export function suggestedNames(hostname: string): string[] {
  const host = hostname.toLowerCase();
  return GAMES.flatMap(([fragment, names]) => (host.includes(fragment) ? names : []));
}
