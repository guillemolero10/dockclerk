// The clerk's tools: read-only lookups against the warehouse software.
// The rules engine calls them today; Muse Spark will call the same functions through tool calling.
import { db } from "@/lib/db";
import { madridDayRange } from "@/lib/format";
import { describeUnits, splitUnits, unitWordFor } from "@/lib/pallets/quantity";
import { itemScore, norm, SKU_SCORE, SYNONYMS } from "./words";

export { norm };

/** Destinations named in the text. Specific aliases ("Turia Quart") win over the bare chain name. */
export async function findConsignees(text: string) {
  const t = norm(text);
  const all = await db.consignee.findMany();
  const byAlias = all.filter((c) => c.aliases.some((a) => t.includes(norm(a))));
  if (byAlias.length > 0) return byAlias;
  return all.filter((c) => t.includes(norm(c.name.split("–")[0])));
}

/** Best item of this customer for a free-text fragment such as "gel de 750" or "toallas blancas". */
export async function findItem(clientId: string, fragment: string) {
  let t = norm(fragment);
  for (const [re, rep] of SYNONYMS) t = t.replace(re, rep);
  const items = await db.item.findMany({ where: { clientId } });
  let best: (typeof items)[number] | null = null;
  let bestScore = 0;
  for (const item of items) {
    const score = itemScore(t, item);
    if (score >= SKU_SCORE) return item; // the SKU itself is in the text
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * What is free to promise of an item right now, in units: what is on the shelves and not picked yet,
 * minus what open outbounds still have to pick (it stays on the shelf until then).
 * Pallets are derived: whole pallets, loose units, and the loose pallets (picos) with where they stand.
 */
export async function checkStock(clientId: string, itemId: string) {
  const [item, unpicked, ordered, pickedForOpen, loosePallets] = await Promise.all([
    db.item.findUniqueOrThrow({ where: { id: itemId } }),
    db.stock.aggregate({ where: { clientId, itemId, outboundId: null }, _sum: { units: true } }),
    db.outboundLine.aggregate({ where: { itemId, outbound: { clientId, status: "REQUESTED" } }, _sum: { units: true } }),
    db.stock.aggregate({ where: { clientId, itemId, outbound: { status: "REQUESTED" } }, _sum: { units: true } }),
    db.stock.findMany({ where: { clientId, itemId, outboundId: null }, select: { location: true, units: true }, orderBy: { location: "asc" } }),
  ]);
  const stillToPick = Math.max(0, (ordered._sum.units ?? 0) - (pickedForOpen._sum.units ?? 0));
  const units = Math.max(0, (unpicked._sum.units ?? 0) - stillToPick);
  const unitWord = unitWordFor(item.unit);
  const split = splitUnits(units, item.unitsPerPallet);
  return {
    /** Free units (the truth). */
    units,
    /** Pallet positions those units take: ⌈units / unitsPerPallet⌉. */
    pallets: split.slots,
    full: split.full,
    loose: split.loose,
    equivalent: split.equivalent,
    unitsPerPallet: item.unitsPerPallet,
    unitWord,
    /** Loose pallets standing in the building, not yet promised to anyone. */
    picos: loosePallets.filter((r) => r.units < item.unitsPerPallet),
    text: describeUnits(units, item.unitsPerPallet, unitWord),
  };
}

/** Most recent shipment of this customer to a destination, if any in the last 10 days. */
export async function lastShipmentTo(clientId: string, consigneeIds: string[]) {
  const since = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  return db.outbound.findFirst({
    where: { clientId, consigneeId: { in: consigneeIds }, date: { gte: since } },
    orderBy: { date: "desc" },
    include: { consignee: true, lines: { include: { item: true } } },
  });
}

/** Inbounds of this customer in the current month. */
export async function inboundsThisMonth(clientId: string) {
  const firstOfMonth = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }).slice(0, 8) + "01";
  const monthStart = madridDayRange(new Date(`${firstOfMonth}T12:00:00Z`)).start;
  return db.inbound.findMany({
    where: { clientId, date: { gte: monthStart } },
    orderBy: { date: "asc" },
    include: { lines: { include: { item: true } } },
  });
}
