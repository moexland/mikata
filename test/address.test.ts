import "./fakes.ts";

import { expect, test } from "bun:test";

const { parseServerAddress } = await import("../src/shared.ts");

const origin = (input: string): string | undefined => parseServerAddress(input)?.origin;

test("takes a bare domain to mean https", () => {
  expect(origin("maimai.example.net")).toBe("https://maimai.example.net");
  expect(origin("  maimai.example.net  ")).toBe("https://maimai.example.net");
});

test("keeps only the origin of whatever follows the domain", () => {
  expect(origin("maimai.example.net/login?next=/")).toBe("https://maimai.example.net");
  expect(origin("https://maimai.example.net/rest/playlog/export")).toBe(
    "https://maimai.example.net",
  );
});

test("keeps a scheme and port the user did type", () => {
  expect(origin("http://localhost:8080")).toBe("http://localhost:8080");
  expect(origin("localhost:8080")).toBe("https://localhost:8080");
  expect(origin("HTTPS://Example.NET")).toBe("https://example.net");
});

test("refuses what is not a web address", () => {
  expect(parseServerAddress("")).toBeNull();
  expect(parseServerAddress("   ")).toBeNull();
  expect(parseServerAddress("ftp://example.net")).toBeNull();
  expect(parseServerAddress("not a domain")).toBeNull();
});
