// Prints the line to add to the table in src/server-hints.ts for a server whose
// export gives play times in a zone other than UTC.
//
//   bun run hash <address> [minutes from UTC, 540 if left out]
//
// Run it yourself, in your own terminal: the point of the table is that the
// address goes nowhere else.

import { hashHostname } from "./src/server-hints.ts";

const [address, minutes = "540"] = process.argv.slice(2);

if (!address || !Number.isInteger(Number(minutes))) {
  console.error("Usage: bun run hash <address> [minutes from UTC, 540 if left out]");
  process.exit(1);
}

// The same reading the settings page gives an address: a bare domain means https,
// and everything after the host is ignored.
const { hostname } = new URL(
  /^[a-z][a-z0-9+.-]*:\/\//i.test(address) ? address : `https://${address}`,
);

console.error(`Host: ${hostname}`);
console.log(`  "${await hashHostname(hostname)}": ${Number(minutes)},`);
