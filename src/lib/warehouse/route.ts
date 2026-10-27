// Picking route over the floor plan: leave the dispatch lane, sweep the aisles
// that have something to pick (in and back out, deepest pallet last), return.

import { CROSS_AISLE_Z, LANE_Z0, aisleX, laneX, parseLocation, positionZ } from "./layout";

export type RoutePoint = [x: number, z: number];

export function pickRoute(picks: { id: string; loc: string }[], dispatchLane = 1) {
  type Stop = { x: number; picks: { id: string; z: number }[]; floor: boolean };
  const stops = new Map<string, Stop>();
  for (const p of picks) {
    const loc = parseLocation(p.loc);
    if (!loc) continue;
    if (loc.kind === "rack") {
      const x = aisleX(loc.row);
      const key = `aisle:${x}`;
      if (!stops.has(key)) stops.set(key, { x, picks: [], floor: false });
      stops.get(key)!.picks.push({ id: p.id, z: positionZ(loc.position) });
    } else {
      const x = laneX(loc.zone, loc.lane);
      const key = `lane:${loc.zone}${loc.lane}`;
      if (!stops.has(key)) stops.set(key, { x, picks: [], floor: true });
      stops.get(key)!.picks.push({ id: p.id, z: LANE_Z0 });
    }
  }

  const home = laneX("EXP", dispatchLane);
  // Sweep from the dispatch side across the building.
  const ordered = [...stops.values()].sort((a, b) => b.x - a.x);
  const order: string[] = [];
  const path: RoutePoint[] = [[home, LANE_Z0 + 0.4], [home, CROSS_AISLE_Z]];
  for (const stop of ordered) {
    stop.picks.sort((a, b) => b.z - a.z);
    order.push(...stop.picks.map((p) => p.id));
    path.push([stop.x, CROSS_AISLE_Z]);
    if (stop.floor) {
      path.push([stop.x, LANE_Z0 - 0.2], [stop.x, CROSS_AISLE_Z]);
    } else {
      path.push([stop.x, stop.picks[stop.picks.length - 1].z - 0.3], [stop.x, CROSS_AISLE_Z]);
    }
  }
  path.push([home, CROSS_AISLE_Z], [home, LANE_Z0 + 0.4]);

  const clean = path.filter((p, i) => i === 0 || p[0] !== path[i - 1][0] || p[1] !== path[i - 1][1]);
  const metres = clean.reduce((sum, p, i) => (i ? sum + Math.abs(p[0] - clean[i - 1][0]) + Math.abs(p[1] - clean[i - 1][1]) : 0), 0);
  return { order, path: clean, metres: Math.round(metres) };
}
