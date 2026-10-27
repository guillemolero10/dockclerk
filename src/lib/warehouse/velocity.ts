// How long it takes to fetch a pallet from each slot, and which items move fast.
// Shared by the analyst (to measure) and by put-away (to act on it with the velocity rule).

import { LEVEL_H, parseLocation, type Layout } from "./layout";
import { pickRoute } from "./route";

/** Reach truck: average travel speed including turns, and loaded lift speed. */
export const TRAVEL_MPS = 1.5;
export const LIFT_MPS = 0.35;

/** Seconds for a round trip from the dispatch lane to each rack slot, lifting to its level and back down. */
export function slotSeconds(layout: Layout) {
  const seconds = new Map<string, number>();
  for (const slot of layout.rackSlotsInFillOrder()) {
    const loc = parseLocation(slot);
    const height = loc?.kind === "rack" ? (loc.level - 1) * LEVEL_H : 0;
    seconds.set(slot, pickRoute(layout, [{ id: "x", loc: slot }], 1).metres / TRAVEL_MPS + (2 * height) / LIFT_MPS);
  }
  return seconds;
}

export type SpeedClass = "A" | "B" | "C";

/**
 * ABC by pallets picked: A items make the first 80% of the picks, B the next 15%, C the rest
 * (and anything that did not move at all).
 */
export function abcClasses(picks: Map<string, number>) {
  const ranked = [...picks.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, n]) => s + n, 0);
  const classes = new Map<string, SpeedClass>();
  const pareto: number[] = [];
  let cum = 0;
  for (const [itemId, n] of ranked) {
    classes.set(itemId, cum / total < 0.8 ? "A" : cum / total < 0.95 ? "B" : "C");
    cum += n;
    pareto.push(cum / total);
  }
  return { classes, pareto, ranked, total };
}

/**
 * Put-away by speed: class A takes the quickest free slot, class C the slowest,
 * class B the quickest one outside the best fifth of the building (kept for class A).
 */
export function velocitySlot(layout: Layout, occupied: Set<string>, speed: SpeedClass) {
  const all = [...slotSeconds(layout).entries()].sort((a, b) => a[1] - b[1]).map(([slot]) => slot);
  const free = all.filter((slot) => !occupied.has(slot));
  if (!free.length) return null;
  if (speed === "A") return free[0];
  if (speed === "C") return free[free.length - 1];
  const reserved = new Set(all.slice(0, Math.floor(all.length / 5)));
  return free.find((slot) => !reserved.has(slot)) ?? free[free.length - 1];
}
