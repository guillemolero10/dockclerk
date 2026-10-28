// Calendar days for billing. Everything is counted in whole Madrid calendar days (integers),
// never in milliseconds, so the clock change cannot turn 31 days into 31.04.

const madridFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });

const DAY_MS = 24 * 60 * 60 * 1000;

/** "2026-10-27": the Madrid calendar day of an instant. */
export const ymdOf = (date: Date) => madridFmt.format(date);

/** Whole days since 1970-01-01 of a "YYYY-MM-DD" string. */
export const dayOfYmd = (ymd: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!match) throw new Error(`Not a date: ${ymd}`);
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(y, m - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) throw new Error(`Not a date: ${ymd}`);
  return ms / DAY_MS;
};

/** Day number of the Madrid calendar date of an instant. */
export const dayNumber = (date: Date) => dayOfYmd(ymdOf(date));

/** "2026-10-27" for a day number. */
export const ymdOfDay = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The instant a day number is stored as in the database: midnight UTC of that calendar date. */
export const dateOfDay = (day: number) => new Date(day * DAY_MS);

export type Period = {
  /** First and last day, both included. */
  first: string;
  last: string;
  /** Day numbers: `start` is the first day, `end` the day after the last one (exclusive). */
  start: number;
  end: number;
  days: number;
};

/** period("2026-10") is the whole month; period("2026-06-05", "2026-06-20") is any range with both ends included. */
export function period(from: string, to?: string): Period {
  let first = from;
  let last = to;
  if (to === undefined) {
    const match = /^(\d{4})-(\d{2})$/.exec(from);
    if (!match) throw new Error(`Not a month: ${from}`);
    const [y, m] = [Number(match[1]), Number(match[2])];
    if (m < 1 || m > 12) throw new Error(`Not a month: ${from}`);
    first = `${from}-01`;
    last = ymdOfDay(dayOfYmd(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`) - 1);
  }
  const start = dayOfYmd(first);
  const end = dayOfYmd(last as string) + 1;
  if (end <= start) throw new Error("The period ends before it starts.");
  return { first, last: last as string, start, end, days: end - start };
}

/** Whole days a stay [inDay, outDay) spends inside the period. Enter counts, leave does not: same day is 0. */
export const daysInside = (inDay: number, outDay: number | null, p: Period) =>
  Math.max(0, Math.min(outDay ?? p.end, p.end) - Math.max(inDay, p.start));
