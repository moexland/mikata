import { expect, test } from "bun:test";

import { correctTimes, formatOffset, TIME_OFFSETS } from "../src/time-offset.ts";

test("offers every whole hour from UTC−12:00 to UTC+14:00", () => {
  expect(TIME_OFFSETS).toHaveLength(27);
  expect(TIME_OFFSETS[0]).toBe(-720);
  expect(TIME_OFFSETS.at(-1)).toBe(840);
  expect(TIME_OFFSETS).toContain(0);
});

test("names an offset the way it is usually written", () => {
  expect(formatOffset(0)).toBe("UTC");
  expect(formatOffset(540)).toBe("UTC+09:00 (JST)");
  expect(formatOffset(-300)).toBe("UTC−05:00");
  expect(formatOffset(330)).toBe("UTC+05:30");
});

test("moves times back for zones ahead of UTC and forward for zones behind", () => {
  const hour = 60 * 60 * 1000;
  const time = Date.UTC(2026, 0, 1);

  expect(correctTimes([{ timeAchieved: time }], 540)).toEqual([{ timeAchieved: time - 9 * hour }]);
  expect(correctTimes([{ timeAchieved: time }], -300)).toEqual([{ timeAchieved: time + 5 * hour }]);
});

test("leaves alone what is not a known time, and does not change its input", () => {
  const scores = [
    { timeAchieved: 1_000_000_000_000 },
    { timeAchieved: "yesterday" },
    { timeAchieved: null },
    7,
  ];
  const before = structuredClone(scores);

  expect(correctTimes(scores, 60).slice(1)).toEqual(before.slice(1));
  expect(scores).toEqual(before);
});
