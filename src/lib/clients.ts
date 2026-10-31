// Customer and item sheets for the office: what each customer stores, how fast it moves
// and what is promised to go out. Read in a handful of queries and added up in memory.

import { db } from "@/lib/db";
import { splitUnits } from "@/lib/pallets/quantity";

const DAY = 24 * 60 * 60 * 1000;
/** Window used for rotation figures. */
export const ROTATION_DAYS = 30;

export async function customerOverview(now = new Date()) {
  const since = new Date(now.getTime() - ROTATION_DAYS * DAY);
  const [clients, stock, inbounds, outbounds, open, rows] = await Promise.all([
    db.client.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { items: true } } } }),
    db.stock.groupBy({ by: ["clientId", "warehouseId"], _sum: { pallets: true }, _min: { expiresAt: true } }),
    db.inboundLine.groupBy({ by: ["itemId"], where: { inbound: { date: { gte: since }, status: { in: ["RECEIVED", "CLOSED"] } } }, _sum: { pallets: true } }),
    db.outboundLine.groupBy({ by: ["itemId"], where: { outbound: { date: { gte: since }, status: { in: ["SHIPPED", "CLOSED"] } } }, _sum: { pallets: true } }),
    db.outbound.groupBy({ by: ["clientId"], where: { status: { in: ["REQUESTED", "PREPARED"] } }, _count: true }),
    db.stock.findMany({ select: { clientId: true, itemId: true, units: true } }),
  ]);
  const items = await db.item.findMany({ select: { id: true, clientId: true, unitsPerPallet: true } });
  const perPallet = new Map(items.map((i) => [i.id, i.unitsPerPallet]));
  const warehouses = await db.warehouse.findMany({ select: { id: true, code: true } });
  const clientOfItem = new Map(items.map((i) => [i.id, i.clientId]));
  const codeOf = new Map(warehouses.map((w) => [w.id, w.code]));
  const byClient = <T extends { itemId: string; _sum: { pallets: number | null } }>(rows: T[], clientId: string) =>
    rows.filter((r) => clientOfItem.get(r.itemId) === clientId).reduce((sum, r) => sum + (r._sum.pallets ?? 0), 0);

  const total = stock.reduce((sum, s) => sum + (s._sum.pallets ?? 0), 0);
  return clients.map((c) => {
    const mine = stock.filter((s) => s.clientId === c.id);
    const pallets = mine.reduce((sum, s) => sum + (s._sum.pallets ?? 0), 0);
    // Whole pallets and loose ones (picos) apart: 33 pallets + 1 pico, not "34".
    let fullPallets = 0;
    let picos = 0;
    for (const r of rows.filter((x) => x.clientId === c.id)) {
      const split = splitUnits(r.units, perPallet.get(r.itemId) ?? 1);
      fullPallets += split.full;
      if (split.loose > 0) picos++;
    }
    const expiries = mine.map((s) => s._min.expiresAt).filter((d): d is Date => !!d);
    return {
      code: c.code,
      name: c.name,
      type: c.type,
      contact: c.contact,
      items: c._count.items,
      pallets,
      fullPallets,
      picos,
      share: total ? pallets / total : 0,
      warehouses: mine.map((s) => codeOf.get(s.warehouseId)!).sort(),
      in30: byClient(inbounds, c.id),
      out30: byClient(outbounds, c.id),
      open: open.find((o) => o.clientId === c.id)?._count ?? 0,
      nextExpiry: expiries.length ? new Date(Math.min(...expiries.map((d) => d.getTime()))) : null,
    };
  });
}

export async function customerDetail(code: string, now = new Date()) {
  const client = await db.client.findUnique({ where: { code } });
  if (!client) return null;
  const t = now.getTime();
  const since = new Date(t - ROTATION_DAYS * DAY);

  const [items, stock, ordered, shipped, inbounds, outbounds] = await Promise.all([
    db.item.findMany({ where: { clientId: client.id }, orderBy: { sku: "asc" } }),
    db.stock.findMany({ where: { clientId: client.id }, include: { warehouse: true, inbound: { select: { date: true } }, outbound: { select: { status: true } } } }),
    db.outboundLine.groupBy({ by: ["itemId"], where: { outbound: { clientId: client.id, status: "REQUESTED" } }, _sum: { pallets: true, units: true } }),
    db.outboundLine.groupBy({
      by: ["itemId"],
      where: { outbound: { clientId: client.id, date: { gte: since }, status: { in: ["SHIPPED", "CLOSED"] } } },
      _sum: { pallets: true },
    }),
    db.inbound.findMany({ where: { clientId: client.id }, orderBy: { date: "desc" }, take: 8, include: { lines: { include: { item: true } }, receipt: { select: { id: true } } } }),
    db.outbound.findMany({ where: { clientId: client.id }, orderBy: { date: "desc" }, take: 8, include: { lines: { include: { item: true } }, consignee: true } }),
  ]);

  const rows = items.map((item) => {
    const mine = stock.filter((s) => s.itemId === item.id);
    const pallets = mine.reduce((sum, s) => sum + s.pallets, 0);
    const picked = mine.filter((s) => s.outboundId).reduce((sum, s) => sum + s.pallets, 0);
    const pickedForOpen = mine.filter((s) => s.outbound?.status === "REQUESTED").reduce((sum, s) => sum + s.pallets, 0);
    const reserved = Math.max(0, (ordered.find((o) => o.itemId === item.id)?._sum.pallets ?? 0) - pickedForOpen);
    const free = Math.max(0, pallets - picked - reserved);
    // The same in units, to show "33 + pico 12" instead of 34.
    const units = mine.reduce((sum, s) => sum + s.units, 0);
    const pickedUnits = mine.filter((s) => s.outboundId).reduce((sum, s) => sum + s.units, 0);
    const pickedForOpenUnits = mine.filter((s) => s.outbound?.status === "REQUESTED").reduce((sum, s) => sum + s.units, 0);
    const reservedUnits = Math.max(0, (ordered.find((o) => o.itemId === item.id)?._sum.units ?? 0) - pickedForOpenUnits);
    const freeSplit = splitUnits(Math.max(0, units - pickedUnits - reservedUnits), item.unitsPerPallet);
    // A row of a mixed pallet holds part of a pallet by design: it is not a pico.
    const picos = mine.filter((s) => s.palletShare === null && s.units % item.unitsPerPallet !== 0).length;
    const out30 = shipped.find((o) => o.itemId === item.id)?._sum.pallets ?? 0;
    const perWeek = (out30 / ROTATION_DAYS) * 7;

    const lots = new Map<string, { lot: string; pallets: number; expiresAt: Date | null }>();
    for (const s of mine.filter((x) => x.lot)) {
      const l = lots.get(s.lot!) ?? { lot: s.lot!, pallets: 0, expiresAt: s.expiresAt };
      l.pallets += s.pallets;
      lots.set(s.lot!, l);
    }
    const received = mine.map((s) => s.inbound?.date.getTime()).filter((d): d is number => !!d);
    return {
      id: item.id,
      sku: item.sku,
      description: item.description,
      unit: item.unit,
      unitsPerPallet: item.unitsPerPallet,
      tracksLot: item.tracksLot,
      pallets,
      /** Whole pallets, and units that do not fill one (picos), counted from units. */
      fullPallets: mine.reduce((sum, s) => sum + Math.floor(s.units / item.unitsPerPallet), 0),
      looseUnits: mine.reduce((sum, s) => sum + (s.units % item.unitsPerPallet), 0),
      picos,
      freeFull: freeSplit.full,
      freeLoose: freeSplit.loose,
      picked,
      reserved,
      free,
      out30,
      /** Weeks the free stock lasts at the pace of the last month; null when nothing went out. */
      weeksCover: perWeek > 0 ? free / perWeek : null,
      oldestDays: received.length ? Math.floor((t - Math.min(...received)) / DAY) : null,
      lots: [...lots.values()].sort((a, b) => (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity)),
      warehouses: [...new Set(mine.map((s) => s.warehouse.code))].sort(),
    };
  });

  const movements = [
    ...inbounds.map((i) => ({
      key: i.id,
      kind: "in" as const,
      date: i.date,
      number: i.number,
      status: i.status as string,
      what: i.lines.map((l) => `${l.pallets} × ${l.item.sku}`).join(", ") || (i.expectedPallets !== null ? `${i.expectedPallets} pallets` : "pallets not announced yet"),
      who: i.supplier ?? "—",
      receipt: i.receipt ? i.id : null,
    })),
    ...outbounds.map((o) => ({
      key: o.id,
      kind: "out" as const,
      date: o.date,
      number: o.number,
      status: o.status as string,
      what: o.lines.map((l) => `${l.pallets} × ${l.item.sku}`).join(", "),
      who: o.consignee?.name ?? "—",
      receipt: null,
    })),
  ]
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, 10);

  return { client, items: rows, movements };
}

export type CustomerDetail = NonNullable<Awaited<ReturnType<typeof customerDetail>>>;
