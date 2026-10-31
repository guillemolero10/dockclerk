// Undoing a pick: pallets that sit in a dispatch lane go back to the racks.
// A row that was split off a loose pallet is joined with it again when the two still fit in one pallet.
// A piece taken off a mixed pallet (`splitFrom`) goes back onto that pallet, under its ID, when it still fits;
// then the pallet's shares and head row are worked out again, with the same rule as when it was received.
// Pure: the database work is in src/app/office/inbox/actions.ts.

import { leadIndex, sharesOf } from "../pallets/breakdown";

export type LaneRow = {
  id: string;
  warehouseId: string;
  itemId: string;
  clientId: string;
  lot: string | null;
  expiresAt: Date | null;
  inboundId: string | null;
  units: number;
  location: string;
  /** Pallet ID, share of the pallet (null = a pallet of its own), `pallets` (1 on the head row, 0 on the others of a mixed pallet) and the ID it was taken off. */
  palletCode?: string | null;
  palletShare?: number | null;
  pallets?: number;
  splitFrom?: string | null;
};

export type RestorePlan = {
  /** `fromId` is deleted and its units are added to `intoId`. */
  merges: { fromId: string; intoId: string; units: number }[];
  /** The row stays as it is and only changes place (a rack slot, or the receiving lane if the building is full). */
  moves: { id: string; location: string }[];
  /** Left out when empty. The row goes back onto the mixed pallet `palletCode` it was taken off, in its slot. */
  joins?: { id: string; palletCode: string; location: string }[];
  /** Left out when empty. New `pallets` and `palletShare` of the rows of every pallet that changed. */
  shares?: { id: string; pallets: number; palletShare: number | null }[];
};

const isRack = (location: string) => !location.startsWith("REC-") && !location.startsWith("EXP-");
const EPS = 1e-9;
const sameDay = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);

/**
 * @param lane     rows to put back (the ones that were picked for an outbound that no longer exists)
 * @param here     every other row of the same buildings (to find the loose pallet and the taken slots)
 * @param perPallet units in a full pallet, by item
 * @param pickSlot free rack slot for a row, or null when there is none; `taken` has every slot already used
 */
export function planRestore(
  lane: LaneRow[],
  here: LaneRow[],
  perPallet: Map<string, number>,
  pickSlot: (row: LaneRow, taken: Set<string>) => string | null,
): RestorePlan {
  const laneIds = new Set(lane.map((r) => r.id));
  // Rows that can take units: in a rack slot, not in the lane being emptied. Their units grow as rows join them.
  const racks = here.filter((r) => !laneIds.has(r.id) && isRack(r.location)).map((r) => ({ ...r }));
  const taken = new Set(here.filter((r) => !laneIds.has(r.id)).map((r) => `${r.warehouseId}|${r.location}`));
  const plan: RestorePlan = { merges: [], moves: [] };
  const joins: NonNullable<RestorePlan["joins"]> = [];
  const touched = new Set<string>(); // "warehouse|pallet ID" whose shares must be worked out again
  const fullOf = (r: LaneRow) => perPallet.get(r.itemId) ?? r.units;
  const done = new Set<string>();

  for (const row of [...lane].sort((a, b) => a.id.localeCompare(b.id))) {
    if (done.has(row.id)) continue;
    done.add(row.id);
    const full = fullOf(row);

    // A piece taken off a mixed pallet: back onto that pallet if it still stands in a rack and the piece still fits.
    if (row.splitFrom) {
      const origin = racks.filter((r) => r.warehouseId === row.warehouseId && r.palletCode === row.splitFrom);
      if (origin.length) {
        const same = origin
          .filter((r) => r.itemId === row.itemId && r.lot === row.lot && sameDay(r.expiresAt, row.expiresAt) && r.units + row.units <= full)
          .sort((a, b) => a.id.localeCompare(b.id))[0];
        if (same) {
          same.units += row.units;
          plan.merges.push({ fromId: row.id, intoId: same.id, units: row.units });
          touched.add(`${row.warehouseId}|${row.splitFrom}`);
          continue;
        }
        const filled = origin.reduce((sum, r) => sum + r.units / fullOf(r), 0) + row.units / full;
        if (origin.length < 4 && filled <= 1 + EPS) {
          const location = origin[0].location;
          joins.push({ id: row.id, palletCode: row.splitFrom, location });
          racks.push({ ...row, location, palletCode: row.splitFrom });
          touched.add(`${row.warehouseId}|${row.splitFrom}`);
          continue;
        }
      }
    }

    // A pallet that left whole (it kept its ID) goes back as it was; only rows without an ID can join a loose pallet.
    const target =
      row.inboundId && !row.palletCode
        ? racks
            .filter(
              (r) =>
                r.warehouseId === row.warehouseId && r.itemId === row.itemId && r.inboundId === row.inboundId &&
                r.lot === row.lot && sameDay(r.expiresAt, row.expiresAt) && r.units + row.units <= full,
            )
            .sort((a, b) => a.location.localeCompare(b.location))[0]
        : undefined;
    if (target) {
      target.units += row.units;
      plan.merges.push({ fromId: row.id, intoId: target.id, units: row.units });
      continue;
    }
    const takenHere = new Set([...taken].filter((t) => t.startsWith(`${row.warehouseId}|`)).map((t) => t.slice(row.warehouseId.length + 1)));
    const slot = pickSlot(row, takenHere);
    const location = slot ?? "REC-1";
    if (slot) taken.add(`${row.warehouseId}|${slot}`);
    // The other rows of the same pallet (a mixed pallet that left whole) share its slot.
    const together = row.palletCode && !row.splitFrom
      ? lane.filter((r) => r.id !== row.id && !done.has(r.id) && r.warehouseId === row.warehouseId && r.palletCode === row.palletCode && !r.splitFrom)
      : [];
    for (const r of [row, ...together]) {
      done.add(r.id);
      plan.moves.push({ id: r.id, location });
      racks.push({ ...r, location });
    }
  }

  if (joins.length) plan.joins = joins;
  // Merge targets of a pallet with an ID change units too.
  for (const m of plan.merges) {
    const into = racks.find((r) => r.id === m.intoId);
    if (into?.palletCode) touched.add(`${into.warehouseId}|${into.palletCode}`);
  }
  const shares: NonNullable<RestorePlan["shares"]> = [];
  for (const key of touched) {
    const sep = key.indexOf("|");
    const rows = racks.filter((r) => r.warehouseId === key.slice(0, sep) && r.palletCode === key.slice(sep + 1)).sort((a, b) => a.id.localeCompare(b.id));
    if (rows.length === 1) { shares.push({ id: rows[0].id, pallets: 1, palletShare: null }); continue; }
    const items = rows.map((r) => ({ id: r.itemId, sku: "", unitsPerPallet: fullOf(r) }));
    const parts = sharesOf(rows.map((r) => ({ itemId: r.itemId, lot: r.lot, expiresAt: null, units: r.units })), items);
    const lead = leadIndex(parts);
    rows.forEach((r, i) => shares.push({ id: r.id, pallets: i === lead ? 1 : 0, palletShare: parts[i] }));
  }
  if (shares.length) plan.shares = shares;
  return plan;
}
