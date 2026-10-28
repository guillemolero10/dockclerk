// Undoing a pick: pallets that sit in a dispatch lane go back to the racks.
// A row that was split off a loose pallet is joined with it again when the two still fit in one pallet.
// Pure: the database work is in src/app/office/inbox/actions.ts.

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
};

export type RestorePlan = {
  /** `fromId` is deleted and its units are added to `intoId`. */
  merges: { fromId: string; intoId: string; units: number }[];
  /** The row stays as it is and only changes place (a rack slot, or the receiving lane if the building is full). */
  moves: { id: string; location: string }[];
};

const isRack = (location: string) => !location.startsWith("REC-") && !location.startsWith("EXP-");
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

  for (const row of [...lane].sort((a, b) => a.id.localeCompare(b.id))) {
    const full = perPallet.get(row.itemId) ?? row.units;
    const target = row.inboundId
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
    plan.moves.push({ id: row.id, location });
    racks.push({ ...row, location });
  }
  return plan;
}
