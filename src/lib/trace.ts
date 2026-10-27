// Lot traceability: where a lot came from, where it is now and which trucks took it.
// The answer a food or cosmetics 3PL owes its customer within hours of a recall.

import { db } from "@/lib/db";

export type ShippedPallet = { itemId: string; sku: string; lot: string | null; units: number; location: string; inboundId: string | null };

export type LotOption = { lot: string; sku: string; description: string; client: string; date: Date };

/** Lots matching a search on lot code or SKU, newest delivery first. */
export async function findLots(q: string): Promise<LotOption[]> {
  const query = q.trim();
  const lines = await db.inboundLine.findMany({
    where: {
      lot: query ? undefined : { not: null },
      ...(query
        ? { OR: [{ lot: { contains: query, mode: "insensitive" } }, { item: { sku: { contains: query, mode: "insensitive" } } }], NOT: { lot: null } }
        : {}),
    },
    include: { item: { include: { client: true } }, inbound: { select: { date: true } } },
    orderBy: { inbound: { date: "desc" } },
    take: 24,
  });
  const seen = new Set<string>();
  return lines
    .filter((l) => l.lot && !seen.has(l.lot) && seen.add(l.lot))
    .map((l) => ({ lot: l.lot!, sku: l.item.sku, description: l.item.description, client: l.item.client.name, date: l.inbound.date }));
}

/** Lots of the goods that expire first and are still in the building: the ones a recall would hit. */
export async function lotsAtRisk(): Promise<LotOption[]> {
  const stock = await db.stock.findMany({
    where: { lot: { not: null }, expiresAt: { not: null } },
    distinct: ["lot"],
    orderBy: { expiresAt: "asc" },
    include: { item: true, client: true, inbound: { select: { date: true } } },
    take: 8,
  });
  return stock.map((s) => ({ lot: s.lot!, sku: s.item.sku, description: s.item.description, client: s.client.name, date: s.inbound?.date ?? new Date(0) }));
}

export async function traceLot(lot: string) {
  const [lines, stock, outbounds] = await Promise.all([
    db.inboundLine.findMany({
      where: { lot },
      include: {
        item: { include: { client: true } },
        inbound: { include: { warehouse: true, carrier: true, receipt: { select: { id: true } } } },
      },
      orderBy: { inbound: { date: "asc" } },
    }),
    db.stock.findMany({ where: { lot }, include: { warehouse: true, outbound: { select: { number: true } } }, orderBy: { location: "asc" } }),
    db.outbound.findMany({
      where: { shipped: { array_contains: [{ lot }] } },
      include: { consignee: true, carrier: true },
      orderBy: { date: "asc" },
    }),
  ]);
  if (!lines.length && !stock.length) return null;

  const item = lines[0]?.item ?? (await db.item.findUniqueOrThrow({ where: { id: stock[0].itemId }, include: { client: true } }));

  const came = lines.map((l) => ({
    inboundId: l.inbound.id,
    number: l.inbound.number,
    date: l.inbound.date,
    supplier: l.inbound.supplier,
    docRef: l.inbound.clientDocRef,
    warehouse: l.inbound.warehouse?.code ?? null,
    carrier: l.inbound.carrier?.name ?? null,
    plate: l.inbound.plate,
    pallets: l.pallets,
    units: l.units,
    receipt: !!l.inbound.receipt,
    incident: l.inbound.incident,
  }));

  // Pallets still in the building, grouped by where they stand.
  const groups = new Map<string, { warehouse: string; area: "rack" | "receiving" | "dispatch"; locations: string[]; pallets: number; units: number; outbound: number | null }>();
  for (const s of stock) {
    const area = s.location.startsWith("REC-") ? "receiving" : s.location.startsWith("EXP-") ? "dispatch" : "rack";
    const key = `${s.warehouse.code}|${area}|${s.outbound?.number ?? ""}`;
    const g = groups.get(key) ?? { warehouse: s.warehouse.code, area, locations: [], pallets: 0, units: 0, outbound: s.outbound?.number ?? null };
    g.locations.push(s.location);
    g.pallets += s.pallets;
    g.units += s.units;
    groups.set(key, g);
  }

  const went = outbounds.map((o) => {
    const mine = ((o.shipped ?? []) as ShippedPallet[]).filter((p) => p.lot === lot);
    return {
      outboundId: o.id,
      number: o.number,
      date: o.date,
      consignee: o.consignee?.name ?? "—",
      city: o.consignee?.city ?? null,
      carrier: o.carrier?.name ?? null,
      docRef: o.clientDocRef,
      pallets: mine.length,
      units: mine.reduce((sum, p) => sum + p.units, 0),
    };
  });

  const sum = <T,>(list: T[], f: (x: T) => number) => list.reduce((s, x) => s + f(x), 0);
  const totals = {
    in: sum(came, (c) => c.pallets),
    here: sum(stock, (s) => s.pallets),
    out: sum(went, (w) => w.pallets),
  };

  return {
    lot,
    sku: item.sku,
    description: item.description,
    client: item.client.name,
    contact: item.client.contact,
    expiresAt: stock.find((s) => s.expiresAt)?.expiresAt ?? null,
    came,
    here: [...groups.values()],
    went,
    totals,
    balanced: totals.in === totals.here + totals.out,
  };
}

export type LotTrace = NonNullable<Awaited<ReturnType<typeof traceLot>>>;
