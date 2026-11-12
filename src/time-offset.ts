// Correction for servers that write play times in their own time zone.
//
// A score's timeAchieved is Unix time in milliseconds, which has no time zone.
// A server that reads its clock in local time and writes that reading out as if
// it were UTC puts every play ahead or behind by its zone's offset: nine hours
// ahead for one that runs on Japan time. Taking the offset away again gives the
// real time.

/** The zones offered on the settings page, as minutes from UTC: every whole hour. */
export const TIME_OFFSETS: readonly number[] = Array.from({ length: 27 }, (_, i) => (i - 12) * 60);

const ZONE_NAMES: Record<number, string> = { 540: "JST" };

/** "UTC", "UTC+09:00 (JST)", "UTC−05:00". */
export function formatOffset(minutes: number): string {
  if (minutes === 0) {
    return "UTC";
  }

  const size = Math.abs(minutes);
  const hours = String(Math.floor(size / 60)).padStart(2, "0");
  const rest = String(size % 60).padStart(2, "0");
  const name = ZONE_NAMES[minutes];

  return `UTC${minutes < 0 ? "−" : "+"}${hours}:${rest}${name ? ` (${name})` : ""}`;
}

/**
 * Returns the scores with their times moved from the given zone to UTC.
 *
 * Kamaitachi reads 0, null and a missing timeAchieved as "time unknown", so
 * those are kept as they are. So is anything that is not a number, which is for
 * Kamaitachi to turn down.
 */
export function correctTimes(scores: unknown[], offsetMinutes: number): unknown[] {
  const shift = offsetMinutes * 60_000;

  return scores.map((score) => {
    if (typeof score !== "object" || score === null) {
      return score;
    }

    const time = (score as { timeAchieved?: unknown }).timeAchieved;
    return typeof time === "number" && time !== 0
      ? { ...score, timeAchieved: time - shift }
      : score;
  });
}
