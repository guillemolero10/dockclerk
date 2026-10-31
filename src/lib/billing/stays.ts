// A "stay" is a piece of goods that was inside the warehouse: a pallet or a loose bit of one.
// There is no movements table. Stays come from documents DockClerk already has:
//   live Stock rows (still inside)  +  Outbound.shipped elements (left on a truck, SHIPPED or CLOSED).
import { dateOfDay, dayNumber } from "./calendar";

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
  /** Pallet ID of the row (live) or of the pallet it left on (shipped). */
  palletCode?: string | null;
  /** Part of a mixed pallet's one pallet (the shares of a pallet add up to 1); null/undefined = a pallet of its own. */
  share?: number | null;
  /** ID of the pallet these boxes were taken off: the pallet it came from is the one that carries the storage. */
  splitFrom?: string | null;
};

export type StayItem = { id: string; sku: string; unitsPerPallet: number; palletType: PalletKind };
export type StayInbound = { id: string; number: number; clientDocRef: string | null; date: Date; receivedAt: Date | null };
export type StayOutbound = { number: number; status: string; date: Date; shippedAt: Date | null; shipped: unknown };
export type StayStock = { itemId: string; lot: string | null; units: number; inboundId: string | null; palletCode?: string | null; palletShare?: number | null; splitFrom?: string | null };

type ShippedPiece = { itemId: string; lot: string | null; units: number; inboundId: string | null; palletCode: string | null; palletShare: number | null; splitFrom: string | null };

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
      palletCode: typeof r.palletCode === "string" ? r.palletCode : null,
      palletShare: typeof r.palletShare === "number" && r.palletShare > 0 && r.palletShare <= 1 ? r.palletShare : null,
      splitFrom: typeof r.splitFrom === "string" ? r.splitFrom : null,
    });
  }
  return pieces;
}

/**
 * Earliest instant of a shipment that can matter to a period: one day before it starts. Madrid is ahead of UTC, so a truck
 * that left in the first hours of the first day has an instant before midnight UTC; the extra day keeps it.
 * A piece that left before the period has no days inside it and no exit in it, and (in FULL) pieces that left earlier never
 * change how the later ones are weighed, so loading them changes nothing in the bill. load.ts uses this in the query.
 */
export const shippedSince = (periodStart: number) => dateOfDay(periodStart - 1);

/** Same rule as the database filter (`shippedAt`, or `date` when it was never stamped): true when the shipment may matter. */
export const shippedInTime = (out: { shippedAt: Date | null; date: Date }, periodStart: number) =>
  (out.shippedAt ?? out.date).getTime() >= shippedSince(periodStart).getTime();

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

  const make = (itemId: string, lot: string | null, units: number, inboundId: string | null, outDay: number | null, outboundNumber: number | null, pallet: { palletCode?: string | null; palletShare?: number | null; splitFrom?: string | null } = {}) => {
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
      palletCode: pallet.palletCode ?? null,
      // A share only means something with the ID of the pallet it belongs to.
      share: pallet.palletCode && pallet.palletShare ? pallet.palletShare : null,
      splitFrom: pallet.splitFrom ?? null,
    });
  };

  for (const row of input.stock) make(row.itemId, row.lot, row.units, row.inboundId, null, null, row);
  for (const out of input.outbounds) {
    if (out.status !== "SHIPPED" && out.status !== "CLOSED") continue; // only what really left
    const day = dayNumber(out.shippedAt ?? out.date);
    for (const piece of readShipped(out.shipped)) make(piece.itemId, piece.lot, piece.units, piece.inboundId, day, out.number, piece);
  }
  return stays;
}

/**
 * Mixed pallets (rows with a `share`): the pallet is one pallet however many items it carries.
 * `enter` and `exit` say how many pallets each row counts when it comes in and when it leaves, null for rows that are
 * not part of a mixed pallet. FRACTION: its share. FULL: the whole pallet once, on the row with the biggest share
 * (the first on a tie), so a mixed pallet enters once and leaves once.
 */
export function mixedMovements(stays: Stay[], rule: PartialRule) {
  const enter: (number | null)[] = stays.map(() => null);
  const exit: (number | null)[] = stays.map(() => null);
  const pallets = new Map<string, number[]>();
  stays.forEach((s, i) => {
    if (s.share == null || !s.palletCode) return;
    const key = `${s.palletCode}|${s.inboundId ?? "-"}|${s.outDay ?? "in"}|${s.outboundNumber ?? "-"}`;
    pallets.set(key, [...(pallets.get(key) ?? []), i]);
  });
  for (const rows of pallets.values()) {
    const lead = rows.reduce((best, i) => ((stays[i].share as number) > (stays[best].share as number) + 1e-9 ? i : best), rows[0]);
    for (const i of rows) {
      const v = rule === "FRACTION" ? (stays[i].share as number) : i === lead ? 1 : 0;
      enter[i] = v;
      exit[i] = v;
    }
  }
  if (rule === "FULL") {
    // Boxes of another item taken off a mixed pallet did not come in on a pallet of their own: the pallet entered once.
    const group = (s: Stay) => `${s.inboundId ?? "-"}|${s.itemId}|${s.lot ?? "-"}`;
    const withOwner = new Set(stays.filter((s) => !s.splitFrom).map(group));
    stays.forEach((s, i) => {
      if (s.splitFrom && enter[i] === null && !withOwner.has(group(s)) && stays.some((o) => o.palletCode === s.splitFrom && !o.splitFrom)) enter[i] = 0;
    });
  }
  return { enter, exit };
}

/**
 * Boxes taken off a pallet (`splitFrom`) are not a second pallet: the pallet they came off carries the storage.
 * Returns the indexes of those pieces that weigh 0: all of them when another row still carries the origin's ID,
 * otherwise all but the one that stays longest.
 */
function carriedPieces(stays: Stay[]): Set<number> {
  const zero = new Set<number>();
  const byOrigin = new Map<string, number[]>();
  stays.forEach((s, i) => { if (s.splitFrom) byOrigin.set(s.splitFrom, [...(byOrigin.get(s.splitFrom) ?? []), i]); });
  for (const [origin, pieces] of byOrigin) {
    const owned = stays.some((s) => s.palletCode === origin && !s.splitFrom);
    const keep = owned ? -1 : pieces.reduce((best, i) => ((stays[i].outDay ?? Infinity) > (stays[best].outDay ?? Infinity) ? i : best), pieces[0]);
    for (const i of pieces) if (i !== keep) zero.add(i);
  }
  return zero;
}

/**
 * How many pallets each stay is charged as. Same order as `stays`.
 * FRACTION: units / perPallet; a row of a mixed pallet counts its share (the pallet adds up to 1).
 * FULL: a pallet is charged once while any of its goods is inside. A live row is one pallet. A shipped piece that
 * filled a whole pallet is one pallet. Shipped pieces smaller than a pallet were cut from a pallet: they first
 * fill the free room in the loose rows of the same lot, then share new pallets; the piece that stays longest
 * carries the pallet (the others weigh 0), so a pallet is never charged twice.
 * Pieces that carry a `splitFrom` weigh 0 (the pallet they came off is charged), unless nothing of it is left
 * to carry it. Rows of a mixed pallet weigh their share in both rules.
 */
export function chargedPallets(stays: Stay[], rule: PartialRule): number[] {
  const mixed = (s: Stay) => s.share != null && !!s.palletCode;
  const carried = carriedPieces(stays);
  if (rule === "FRACTION") return stays.map((s) => (mixed(s) ? (s.share as number) : s.units / s.perPallet));

  const weights = stays.map((s) => (mixed(s) ? (s.share as number) : 0));
  const groups = new Map<string, number[]>();
  stays.forEach((s, i) => {
    if (mixed(s) || carried.has(i)) return;
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
