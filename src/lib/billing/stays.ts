// A "stay" is a piece of goods that was inside the warehouse: a pallet or a loose bit of one.
// There is no movements table. Stays come from documents DockClerk already has:
//   live Stock rows (still inside)  +  Outbound.shipped elements (left on a truck, SHIPPED or CLOSED).
import { dayNumber } from "./calendar";

export type PalletKind = "EURO" | "AMERICAN";
/** FRACTION: a loose bit counts units / units-per-pallet. FULL: each row with goods counts as one whole pallet while inside, and loose boxes enter and leave as a whole pallet. */
export type PartialRule = "FRACTION" | "FULL";

export type Stay = {
  inboundId: string | null;
  inboundNumber: number | null;
  docRef: string | null;
  itemId: string;
  sku: string;
  lot: string | null;
  palletType: PalletKind;
  units: number;
  perPallet: number;
  /** Day number the goods came in. */
  inDay: number;
  /** False when the entry is unknown: inDay is then the start of the period and the detail says so. */
  inKnown: boolean;
  /** Day number they left, null while still inside. */
  outDay: number | null;
  outboundNumber: number | null;
};

export type StayItem = { id: string; sku: string; unitsPerPallet: number; palletType: PalletKind };
export type StayInbound = { id: string; number: number; clientDocRef: string | null; date: Date; receivedAt: Date | null };
export type StayOutbound = { number: number; status: string; date: Date; shippedAt: Date | null; shipped: unknown };
export type StayStock = { itemId: string; lot: string | null; units: number; inboundId: string | null };

type ShippedPiece = { itemId: string; lot: string | null; units: number; inboundId: string | null };

/** Outbound.shipped is JSON written by the app: read it defensively and ignore anything that is not a whole positive piece. */
function readShipped(value: unknown): ShippedPiece[] {
  if (!Array.isArray(value)) return [];
  const pieces: ShippedPiece[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    if (typeof r.itemId !== "string" || typeof r.units !== "number" || !Number.isFinite(r.units) || r.units <= 0) continue;
    pieces.push({
      itemId: r.itemId,
      lot: typeof r.lot === "string" ? r.lot : null,
      units: r.units,
      inboundId: typeof r.inboundId === "string" ? r.inboundId : null,
    });
  }
  return pieces;
}

/** `periodStart` is where goods of an unknown entry are placed (they are not charged an entry, only storage). */
export function buildStays(input: {
  items: StayItem[];
  inbounds: StayInbound[];
  outbounds: StayOutbound[];
  stock: StayStock[];
  periodStart: number;
}): Stay[] {
  const items = new Map(input.items.map((i) => [i.id, i]));
  const inbounds = new Map(input.inbounds.map((i) => [i.id, i]));
  const stays: Stay[] = [];

  const make = (itemId: string, lot: string | null, units: number, inboundId: string | null, outDay: number | null, outboundNumber: number | null) => {
    const item = items.get(itemId);
    if (!item || units <= 0) return;
    const inbound = inboundId ? inbounds.get(inboundId) : undefined;
    stays.push({
      inboundId: inbound?.id ?? null,
      inboundNumber: inbound?.number ?? null,
      docRef: inbound?.clientDocRef ?? null,
      itemId,
      sku: item.sku,
      lot,
      palletType: item.palletType,
      units,
      perPallet: item.unitsPerPallet,
      inDay: inbound ? dayNumber(inbound.receivedAt ?? inbound.date) : input.periodStart,
      inKnown: Boolean(inbound),
      outDay,
      outboundNumber,
    });
  };

  for (const row of input.stock) make(row.itemId, row.lot, row.units, row.inboundId, null, null);
  for (const out of input.outbounds) {
    if (out.status !== "SHIPPED" && out.status !== "CLOSED") continue; // only what really left
    const day = dayNumber(out.shippedAt ?? out.date);
    for (const piece of readShipped(out.shipped)) make(piece.itemId, piece.lot, piece.units, piece.inboundId, day, out.number);
  }
  return stays;
}

/**
 * How many pallets each stay is charged as. Same order as `stays`.
 * FRACTION: units / perPallet.
 * FULL: a pallet is charged once while any of its goods is inside. A live row is one pallet. A shipped piece that
 * filled a whole pallet is one pallet. Shipped pieces smaller than a pallet were cut from a pallet: they first
 * fill the free room in the loose rows of the same lot, then share new pallets; the piece that stays longest
 * carries the pallet (the others weigh 0), so a pallet is never charged twice.
 */
export function chargedPallets(stays: Stay[], rule: PartialRule): number[] {
  if (rule === "FRACTION") return stays.map((s) => s.units / s.perPallet);

  const weights = stays.map(() => 0);
  const groups = new Map<string, number[]>();
  stays.forEach((s, i) => {
    const key = `${s.inboundId ?? "-"}|${s.itemId}|${s.lot ?? "-"}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });

  for (const indexes of groups.values()) {
    const bins: number[] = []; // units already used in each pallet
    const loose: number[] = [];
    for (const i of indexes) {
      const s = stays[i];
      if (s.outDay === null) {
        weights[i] = 1;
        if (s.units < s.perPallet) bins.push(s.units);
      } else if (s.units >= s.perPallet) {
        weights[i] = Math.ceil(s.units / s.perPallet);
      } else {
        loose.push(i);
      }
    }
    loose.sort((a, b) => (stays[b].outDay as number) - (stays[a].outDay as number) || a - b);
    for (const i of loose) {
      const s = stays[i];
      const bin = bins.findIndex((used) => used + s.units <= s.perPallet);
      if (bin >= 0) {
        bins[bin] += s.units;
      } else {
        bins.push(s.units);
        weights[i] = 1;
      }
    }
  }
  return weights;
}
