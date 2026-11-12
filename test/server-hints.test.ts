import { expect, test } from "bun:test";

import { hashHostname, recommendedTimeOffset, suggestedNames } from "../src/server-hints.ts";

test("knows the time zone of a listed server, and of nothing else", async () => {
  expect(await recommendedTimeOffset("geki.example.net")).toBe(540);
  expect(await recommendedTimeOffset("GEKI.example.net")).toBe(540);

  // Nothing about the shape of an address counts, only the address itself.
  expect(await recommendedTimeOffset("geki.example.com")).toBeNull();
  expect(await recommendedTimeOffset("ongeki.example.net")).toBeNull();
  expect(await recommendedTimeOffset("www.geki.example.net")).toBeNull();
  expect(await recommendedTimeOffset("example.net")).toBeNull();
  expect(await recommendedTimeOffset("")).toBeNull();
});

test("hashes a host the same way every time, whatever its letter case", async () => {
  const hash = await hashHostname("geki.example.net");

  expect(hash).toMatch(/^[0-9a-f]{64}$/);
  expect(await hashHostname("Geki.Example.NET")).toBe(hash);
  expect(await hashHostname("geki.example.org")).not.toBe(hash);
});

test("suggests the game an address hints at as a name", () => {
  expect(suggestedNames("mai.example.net")).toEqual(["maimai", "maimai DX"]);
  expect(suggestedNames("chu.example.net")).toEqual(["CHUNITHM"]);
  expect(suggestedNames("geki.example.net")).toEqual(["O.N.G.E.K.I."]);
  expect(suggestedNames("Ongeki.example.net")).toEqual(["O.N.G.E.K.I."]);
});

test("suggests nothing for an address that hints at no game, and everything it hints at otherwise", () => {
  expect(suggestedNames("example.net")).toEqual([]);
  expect(suggestedNames("")).toEqual([]);
  expect(suggestedNames("chu.geki.example.net")).toEqual(["CHUNITHM", "O.N.G.E.K.I."]);
});
