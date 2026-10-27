// Dock slots: how long a truck needs, and the first door free for it.
// Pure functions on epoch milliseconds, shared by the office, the clerk and the seed.

const MIN = 60 * 1000;
export const DOCK_OPEN_H = 6;
export const DOCK_CLOSE_H = 20;
export const SLOT_STEP_MIN = 15;

const roundUp = (minutes: number) => Math.ceil(minutes / SLOT_STEP_MIN) * SLOT_STEP_MIN;

/** Unloading takes a bit longer than loading (counting, checking for damage). */
export function slotMinutes(kind: "in" | "out", pallets: number | null) {
  if (pallets === null) return 45;
  return Math.max(30, roundUp(kind === "in" ? 15 + pallets * 1.2 : 10 + pallets));
}

export type Busy = { dock: number; start: number; end: number; label?: string };

export const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && a.end > b.start;

/**
 * First slot at or after `from` on any of `docks` (tried in order), inside opening hours.
 * `dayStart` is the instant the day starts in Madrid.
 */
export function firstFree(busy: Busy[], docks: number[], dayStart: number, from: number, minutes: number) {
  const open = dayStart + DOCK_OPEN_H * 60 * MIN;
  const close = dayStart + DOCK_CLOSE_H * 60 * MIN;
  const step = SLOT_STEP_MIN * MIN;
  let start = Math.max(open, Math.ceil((from - dayStart) / step) * step + dayStart);
  for (; start + minutes * MIN <= close; start += step) {
    const slot = { start, end: start + minutes * MIN };
    const dock = docks.find((d) => !busy.some((b) => b.dock === d && overlaps(b, slot)));
    if (dock !== undefined) return { dock, ...slot };
  }
  return null;
}
