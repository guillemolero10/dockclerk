// Everything the 3D view needs, read from the warehouse software in one go and
// flattened into small arrays (the browser gets ~800 pallets on every refresh).

import { db } from "@/lib/db";
import { madridDayRange } from "@/lib/format";
import { allocatePicks } from "./picking";

const DAY = 24 * 60 * 60 * 1000;

export type SnapshotPallet = {
  id: string;
  loc: string;
  item: number;
  lot: string | null;
  units: number;
  /** Days since it came in. */
  days: number;
  /** Days left before it expires, only for lot-tracked goods. */
  expiresIn: number | null;
};

export type SnapshotOrder = {
  id: string;
  number: number;
  client: number;
  consignee: string | null;
  deadline: string | null;
  pallets: number;
  lines: { sku: string; description: string; pallets: number }[];
  picks: string[];
  short: number;
  byClerk: boolean;
};

export type SnapshotPrepared = { id: string; number: number; client: number; consignee: string | null; deadline: string | null; pallets: number; lane: number };

export type WarehouseSnapshot = {
  clients: { code: string; name: string }[];
  items: { sku: string; description: string; client: number; unit: string }[];
  pallets: SnapshotPallet[];
  orders: SnapshotOrder[];
  prepared: SnapshotPrepared[];
  truck: { number: number; client: string; plate: string | null; status: string } | null;
};

export async function getWarehouseSnapshot(): Promise<WarehouseSnapshot> {
  const now = Date.now();
  const today = madridDayRange(new Date());
  const [clients, items, stock, open, prepared, truck] = await Promise.all([
    db.client.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.item.findMany({ orderBy: { sku: "asc" }, select: { id: true, sku: true, description: true, clientId: true, unit: true } }),
    db.stock.findMany({ include: { inbound: { select: { date: true } } } }),
    db.outbound.findMany({
      where: { status: "REQUESTED" },
      include: { consignee: true, lines: { include: { item: true } } },
      orderBy: [{ deadline: "asc" }, { number: "asc" }],
    }),
    db.outbound.findMany({
      where: { status: "PREPARED" },
      include: { consignee: true, lines: true },
      orderBy: [{ deadline: "asc" }, { number: "asc" }],
    }),
    db.inbound.findFirst({
      where: { status: { in: ["EXPECTED", "RECEIVING"] }, date: { gte: today.start, lt: today.end } },
      include: { client: true },
    }),
  ]);

  const clientIndex = new Map(clients.map((c, i) => [c.id, i]));
  const itemIndex = new Map(items.map((it, i) => [it.id, i]));

  const plans = allocatePicks(
    stock.map((s) => ({ id: s.id, itemId: s.itemId, location: s.location, pallets: s.pallets, expiresAt: s.expiresAt, receivedAt: s.inbound?.date ?? null })),
    open.map((o) => ({ id: o.id, number: o.number, date: o.date, deadline: o.deadline, lines: o.lines.map((l) => ({ itemId: l.itemId, pallets: l.pallets })) })),
  );

  return {
    clients: clients.map((c) => ({ code: c.code, name: c.name })),
    items: items.map((it) => ({ sku: it.sku, description: it.description, client: clientIndex.get(it.clientId)!, unit: it.unit })),
    pallets: stock.map((s) => ({
      id: s.id,
      loc: s.location,
      item: itemIndex.get(s.itemId)!,
      lot: s.lot,
      units: s.units,
      days: s.inbound ? Math.max(0, Math.floor((now - s.inbound.date.getTime()) / DAY)) : 0,
      expiresIn: s.expiresAt ? Math.ceil((s.expiresAt.getTime() - now) / DAY) : null,
    })),
    orders: open.map((o) => {
      const plan = plans.get(o.id) ?? { stockIds: [], short: 0 };
      return {
        id: o.id,
        number: o.number,
        client: clientIndex.get(o.clientId)!,
        consignee: o.consignee?.name ?? null,
        deadline: (o.deadline ?? o.date).toISOString(),
        pallets: o.lines.reduce((sum, l) => sum + l.pallets, 0),
        lines: o.lines.map((l) => ({ sku: l.item.sku, description: l.item.description, pallets: l.pallets })),
        picks: plan.stockIds,
        short: plan.short,
        byClerk: o.notes?.startsWith("Alta DockClerk") ?? false,
      };
    }),
    prepared: prepared.slice(0, 4).map((o, i) => ({
      id: o.id,
      number: o.number,
      client: clientIndex.get(o.clientId)!,
      consignee: o.consignee?.name ?? null,
      deadline: (o.deadline ?? o.date).toISOString(),
      pallets: o.lines.reduce((sum, l) => sum + l.pallets, 0),
      lane: i + 1,
    })),
    truck: truck ? { number: truck.number, client: truck.client.name, plate: truck.plate, status: truck.status } : null,
  };
}
