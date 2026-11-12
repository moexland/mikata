import {
  browser,
  origin,
  remote,
  resetBrowser,
  resetRemote,
  sampleExport,
  secondOrigin,
} from "./fakes.ts";

import { beforeEach, expect, test } from "bun:test";

const { runSync, timing } = await import("../src/sync.ts");

timing.pollIntervalMs = 5;

const tracker = { origin, token: "good-token" };
const server = (address: string, timeOffsetMinutes = 0) => ({ origin: address, timeOffsetMinutes });
// Of the three records in the sample export: one imported, one stored until its
// chart is known, one refused.
const imported = { outcome: "imported", submitted: 3, imported: 1, waiting: 1, rejected: 1 };

beforeEach(() => {
  resetBrowser({ servers: [server(origin)], tracker });
  resetRemote();
});

/** The step of each progress update, or the phase once the sync is over. */
function timeline(): unknown[] {
  return browser.statuses.map((status) =>
    status.phase === "running" ? status.step : status.phase,
  );
}

function finalStatus() {
  return browser.statuses.at(-1)!;
}

test("fetches the export, uploads it with the token, and reports the import result", async () => {
  await runSync();

  expect(timeline()).toEqual(["fetching", "uploading", "processing", "done"]);
  expect(finalStatus().results).toEqual([
    { server: origin, ...imported, rejections: ["InvalidDatapoint: percent out of range"] },
  ]);

  expect(remote.uploads).toHaveLength(1);
  const upload = remote.uploads[0]!;
  expect(upload.headers.get("authorization")).toBe("Bearer good-token");
  expect(upload.headers.get("x-user-intent")).toBe("true");
  expect(upload.headers.get("content-type")).toStartWith("multipart/form-data");
  expect(upload.fromTab).toBe(false);
  expect(upload.body).toMatch(/name="importType"\r\n\r\nfile\/batch-manual/);
  expect(upload.body).toMatch(/name="scoreData"; filename="scores.json"/);
  expect(upload.body).toContain(sampleExport);

  // 404 while queued, then ongoing, then completed.
  expect(remote.polls).toBe(3);
});

test("counts scores Kamaitachi is holding for later as waiting, not rejected", async () => {
  resetRemote({
    importErrors: [
      { type: "SongOrChartNotFound", message: "no chart for 2" },
      // The same score met again on a later sync.
      { type: "OrphanExists", message: "no chart for 3" },
    ],
  });

  await runSync();

  expect(finalStatus().results).toEqual([
    {
      server: origin,
      outcome: "imported",
      submitted: 3,
      imported: 1,
      waiting: 2,
      rejected: 0,
      rejections: [],
    },
  ]);
});

test("treats an error type it does not know as rejected, so it stays visible", async () => {
  resetRemote({ importErrors: [{ type: "SomethingNew", message: "who knows" }] });

  await runSync();

  expect(finalStatus().results).toMatchObject([
    { waiting: 0, rejected: 1, rejections: ["SomethingNew: who knows"] },
  ]);
});

test("syncs every server in the list, one after another", async () => {
  resetBrowser({ servers: [server(origin), server(secondOrigin)], tracker });

  await runSync();

  expect(remote.exportRequests).toEqual([origin, secondOrigin]);
  expect(remote.uploads).toHaveLength(2);
  expect(finalStatus()).toMatchObject({
    phase: "done",
    results: [
      { server: origin, ...imported },
      { server: secondOrigin, ...imported },
    ],
  });

  // Progress names the server being worked on and carries the results so far.
  const secondFetch = browser.statuses.find((status) => status.server === secondOrigin)!;
  expect(secondFetch).toMatchObject({ step: "fetching", index: 1, total: 2 });
  expect(secondFetch.results).toHaveLength(1);
});

test("keeps going when one server's login has expired", async () => {
  resetBrowser({ servers: [server(origin), server(secondOrigin)], tracker });
  resetRemote({ loggedOutOrigins: [origin] });
  browser.openTabs = [{ id: 7, url: `${origin}/dashboard`, discarded: false }];

  await runSync();

  expect(finalStatus()).toMatchObject({
    phase: "done",
    results: [
      { server: origin, outcome: "failed", needsLogin: true, message: "Signed out" },
      { server: secondOrigin, ...imported },
    ],
  });
  expect(remote.uploads).toHaveLength(1);
});

test("falls back to an open server tab when the background request is not logged in", async () => {
  resetRemote({ exportNeedsTab: true });
  browser.openTabs = [{ id: 7, url: `${origin}/dashboard`, discarded: false }];

  await runSync();

  expect(finalStatus()).toMatchObject({ phase: "done", results: [{ outcome: "imported" }] });
  expect(remote.uploads).toHaveLength(1);
  // Only the export goes through the tab; the upload never does.
  expect(remote.uploads[0]!.fromTab).toBe(false);
});

// What a server was seen to answer without a login: a few words of JSON under
// an HTTP status of 200. The status it means is only in the text. It looks
// nothing like a login page, and is no more of an export than one.
const signedOutMessage = JSON.stringify({ message: "Authentication required", status: 403 });

test("falls back to an open server tab when the background request gets a message in place of the export", async () => {
  resetRemote({ exportNeedsTab: true, signedOutBody: signedOutMessage });
  browser.openTabs = [{ id: 7, url: `${origin}/dashboard`, discarded: false }];

  await runSync();

  expect(finalStatus()).toMatchObject({ phase: "done", results: [{ outcome: "imported" }] });
  expect(remote.exportRequests).toHaveLength(2);
  expect(remote.uploads).toHaveLength(1);
});

test("takes a message in place of the export for an expired login, not for an export it cannot read", async () => {
  resetRemote({ loggedOutOrigins: [origin], signedOutBody: signedOutMessage });

  await runSync();

  expect(finalStatus()).toMatchObject({
    phase: "done",
    results: [{ server: origin, outcome: "failed", needsLogin: true, message: "Signed out" }],
  });
  expect(remote.uploads).toHaveLength(0);
});

test("stops at the first server when Kamaitachi rejects the token", async () => {
  resetBrowser({
    servers: [server(origin), server(secondOrigin)],
    tracker: { origin, token: "revoked" },
  });

  await runSync();

  expect(timeline()).toEqual(["fetching", "uploading", "error"]);
  expect(finalStatus()).toMatchObject({ phase: "error", message: "Authorization expired" });
  expect(remote.uploads).toHaveLength(0);
  // The second server would fail the same way, so it is never contacted.
  expect(remote.exportRequests).toEqual([origin]);
  // The token is remembered as no longer good, which is how the rest of the UI finds out.
  expect(browser.store.tracker).toEqual({ origin, token: "revoked", expired: true });
});

test("does not try an authorization already known to have expired", async () => {
  resetBrowser({ servers: [server(origin)], tracker: { ...tracker, expired: true } });

  await runSync();

  expect(timeline()).toEqual(["error"]);
  expect(remote.exportRequests).toEqual([]);
});

test("does not contact any server before Kamaitachi is authorized", async () => {
  resetBrowser({ servers: [server(origin)] });

  await runSync();

  expect(timeline()).toEqual(["error"]);
  expect(finalStatus()).toMatchObject({ phase: "error", message: "Not authorized" });
  expect(remote.exportRequests).toEqual([]);
});

test("points to settings when no server has been added", async () => {
  resetBrowser({ tracker });

  await runSync();

  expect(finalStatus()).toMatchObject({ phase: "error", message: "No servers added" });
});

test("reports an export that is not BATCH-MANUAL without uploading it", async () => {
  // It has scores, so it is an export of some kind, but says nothing of the game.
  resetRemote({ exportBody: JSON.stringify({ scores: [{ identifier: "1" }] }) });
  browser.openTabs = [{ id: 7, url: `${origin}/dashboard`, discarded: false }];

  await runSync();

  expect(finalStatus()).toMatchObject({
    phase: "done",
    results: [
      {
        server: origin,
        outcome: "failed",
        needsLogin: false,
        // The short name is what the popup shows; the technical explanation travels separately.
        message: "Unsupported export format",
        detail: expect.stringContaining("BATCH-MANUAL"),
      },
    ],
  });
  expect(remote.uploads).toHaveLength(0);
  // The login is plainly in order, so there is nothing a tab could do better.
  expect(remote.exportRequests).toHaveLength(1);
});

test("skips the upload when the export has no scores", async () => {
  resetRemote({
    exportBody: JSON.stringify({ meta: { game: "maimaidx", service: "t" }, scores: [] }),
  });

  await runSync();

  expect(finalStatus()).toEqual({
    phase: "done",
    results: [{ server: origin, outcome: "empty" }],
    time: expect.any(Number),
  });
  expect(remote.uploads).toHaveLength(0);
});

// 12:00 on 11 November 2026 by a clock in Japan, written out as if it were UTC.
const noonInJapan = Date.UTC(2026, 10, 11, 12);
const timedScores = [
  { identifier: "1", timeAchieved: noonInJapan },
  // The ways of saying that the time is unknown.
  { identifier: "2", timeAchieved: null },
  { identifier: "3", timeAchieved: 0 },
  { identifier: "4" },
];
const timedExport = JSON.stringify({
  meta: { game: "ongeki", playtype: "Single", service: "test" },
  scores: timedScores,
});

/** The uploaded file, read back out of the multipart body. */
function uploadedDocument(index: number): unknown {
  const body = remote.uploads[index]!.body;
  return JSON.parse(body.slice(body.indexOf('{"meta"'), body.lastIndexOf("}") + 1));
}

test("moves play times to UTC for a server set to another time zone", async () => {
  resetBrowser({ servers: [server(origin, 540)], tracker });
  resetRemote({ exportBody: timedExport });

  await runSync();

  expect(uploadedDocument(0)).toEqual({
    meta: { game: "ongeki", playtype: "Single", service: "test" },
    scores: [
      // 03:00 UTC is noon in Japan.
      { identifier: "1", timeAchieved: Date.UTC(2026, 10, 11, 3) },
      { identifier: "2", timeAchieved: null },
      { identifier: "3", timeAchieved: 0 },
      { identifier: "4" },
    ],
  });
  expect(finalStatus().results).toMatchObject([{ outcome: "imported", submitted: 4 }]);
});

test("uploads the export untouched for servers without a time zone set", async () => {
  resetBrowser({ servers: [server(origin), server(secondOrigin, 540)], tracker });
  resetRemote({ exportBody: timedExport });

  await runSync();

  // Byte for byte what the server sent, not a re-serialised copy.
  expect(remote.uploads[0]!.body).toContain(timedExport);
  expect(remote.uploads[1]!.body).not.toContain(timedExport);
  expect(uploadedDocument(1)).toMatchObject({
    scores: [{ timeAchieved: Date.UTC(2026, 10, 11, 3) }, {}, {}, {}],
  });
});
