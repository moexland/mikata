import "./fakes.ts";

import { expect, test } from "bun:test";

import type { ServerResult, SyncStatus } from "../src/shared.ts";

const { withoutServer } = await import("../src/shared.ts");

const MAI = "https://maimai.example.net";
const CHU = "https://chunithm.example.net";
const GEKI = "https://geki.example.net";

const imported = (server: string): ServerResult => ({
  server,
  outcome: "imported",
  submitted: 3,
  imported: 1,
  waiting: 0,
  rejected: 1,
  rejections: ["InvalidDatapoint: no such chart"],
});
const failed = (server: string): ServerResult => ({
  server,
  outcome: "failed",
  message: "Signed out",
  needs: "login",
});

test("drops what a finished sync recorded about a server, and keeps the rest", () => {
  const status: SyncStatus = { phase: "done", results: [imported(MAI), failed(CHU)], time: 1 };

  expect(withoutServer(status, CHU)).toEqual({ phase: "done", results: [imported(MAI)], time: 1 });
  expect(JSON.stringify(withoutServer(status, CHU))).not.toContain(CHU);
});

test("leaves nothing of a finished sync whose only server is removed", () => {
  const status: SyncStatus = { phase: "done", results: [imported(MAI)], time: 1 };

  expect(withoutServer(status, MAI)).toBeNull();
});

test("returns the very same status when the server has no part in it", () => {
  const done: SyncStatus = { phase: "done", results: [imported(MAI)], time: 1 };
  const error: SyncStatus = { phase: "error", message: "Not authorized", time: 1 };

  expect(withoutServer(done, GEKI)).toBe(done);
  expect(withoutServer(error, MAI)).toBe(error);
});

test("drops a finished server from the progress of an interrupted sync", () => {
  const status: SyncStatus = {
    phase: "running",
    step: "uploading",
    server: CHU,
    index: 1,
    total: 2,
    results: [imported(MAI)],
    time: 1,
  };

  expect(withoutServer(status, MAI)).toEqual({ ...status, results: [] });
});

test("leaves nothing of an interrupted sync that stopped on the removed server", () => {
  const status: SyncStatus = {
    phase: "running",
    step: "fetching",
    server: CHU,
    index: 1,
    total: 2,
    results: [imported(MAI)],
    time: 1,
  };

  expect(withoutServer(status, CHU)).toBeNull();
});
