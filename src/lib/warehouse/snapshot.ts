// Everything the 3D view needs, read from the warehouse software in one go and
// flattened into small arrays (the browser gets a few hundred pallets on every refresh).

import { db } from "@/lib/db";
import { madridDayRange } from "@/lib/format";
import { dispatchLane } from "./lanes";
import { makeLayout, parseLocation, type WarehouseDims } from "./layout";
import { allocatePicks } from "./picking";

const DAY = 24 * 60 * 60 * 1000;

export type WarehouseSummary = {
  code: string;
  name: string;
  city: string;
  dims: WarehouseDims;
  capacity: number;
  inRacks: number;
  receiving: number;
  toShip: number;
};

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
  /** Outbound it has been picked for. */
  outbound: string | null;
};

export type SnapshotOrder = {
  id: string;
  number: number;
  /** Warehouse code it will leave from, or null when nothing is in stock. */
  warehouse: string | null;
  client: number;
  consignee: string | null;
  deadline: string | null;
  pallets: number;
  lines: { sku: string; description: string; pallets: number }[];
  picks: string[];
  picked: string[];
  /** Dispatch lane its pallets go to. */
  lane: number;
  short: number;
  byClerk: boolean;
};

export type SnapshotPrepared = { id: string; number: number; client: number; consignee: string | null; deadline: string | null; pallets: number };

export type WarehouseSnapshot = {
  warehouses: WarehouseSummary[];
  current: string;
  clients: { code: string; name: string }[];
  items: { sku: string; description: string; client: number; unit: string }[];
  pallets: SnapshotPallet[];
  orders: SnapshotOrder[];
  /** Picked outbounds waiting in the dispatch lanes of this warehouse. */
  prepared: SnapshotPrepared[];
  truck: { number: number; client: string; plate: string | null; status: string } | null;
  /** Dock doors with a truck at them right now. */
  busyDocks: number[];
};

const dimsOf = (w: { length: number; width: number; height: number; aisleWidth: number; docks: number }): WarehouseDims => ({
  length: w.length,
  width: w.width,
  height: w.height,
  aisleWidth: w.aisleWidth,
  docks: w.docks,
});

export async function getWarehouseSnapshot(code?: string): Promise<WarehouseSnapshot | null> {
  const now = Date.now();
  const today = madridDayRange(new Date());
  const warehouses = await db.warehouse.findMany({ orderBy: { code: "asc" } });
  if (!warehouses.length) return null;
  const current = warehouses.find((w) => w.code === code) ?? warehouses[0];

  const [clients, items, stock, open, prepared, truck, atDock] = await Promise.all([
    db.client.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }),
    db.item.findMany({ orderBy: { sku: "asc" }, select: { id: true, sku: true, description: true, clientId: true, unit: true } }),
    db.stock.findMany({ include: { inbound: { select: { date: true } } } }),
    db.outbound.findMany({
      where: { status: "REQUESTED" },
      include: { consignee: true, lines: { include: { item: true } } },
      orderBy: [{ deadline: "asc" }, { number: "asc" }],
    }),
    db.outbound.findMany({
      where: { status: "PREPARED", picked: { some: { warehouseId: current.id } } },
      include: { consignee: true },
      orderBy: [{ deadline: "asc" }, { number: "asc" }],
    }),
    db.inbound.findFirst({
      where: { status: { in: ["EXPECTED", "RECEIVING"] }, warehouseId: current.id, date: { gte: today.start, lt: today.end } },
      include: { client: true },
    }),
    db.dockAppointment.findMany({ where: { warehouseId: current.id, status: "ARRIVED" }, select: { dock: true } }),
  ]);

  const clientIndex = new Map(clients.map((c, i) => [c.id, i]));
  const itemIndex = new Map(items.map((it, i) => [it.id, i]));
  const codeOf = new Map(warehouses.map((w) => [w.id, w.code]));
  const layoutOf = new Map(warehouses.map((w) => [w.id, makeLayout(dimsOf(w))]));
  const stockIn = (warehouseId: string) => stock.filter((s) => s.warehouseId === warehouseId);

  const plans = allocatePicks(
    stock.map((s) => ({
      id: s.id, warehouseId: s.warehouseId, itemId: s.itemId, location: s.location, units: s.units,
      expiresAt: s.expiresAt, receivedAt: s.inbound?.date ?? null, outboundId: s.outboundId,
    })),
    open.map((o) => ({ id: o.id, number: o.number, date: o.date, deadline: o.deadline, lines: o.lines.map((l) => ({ itemId: l.itemId, units: l.units })) })),
  );

  const here = stockIn(current.id);
  const count = (list: typeof stock, test: (loc: string) => boolean) => list.filter((s) => test(s.location)).reduce((sum, s) => sum + s.pallets, 0);

  return {
    warehouses: warehouses.map((w) => {
      const mine = stockIn(w.id);
      return {
        code: w.code,
        name: w.name,
        city: w.city,
        dims: dimsOf(w),
        capacity: layoutOf.get(w.id)!.capacity,
        inRacks: count(mine, (loc) => parseLocation(loc)?.kind === "rack"),
        receiving: count(mine, (loc) => loc.startsWith("REC-")),
        toShip: count(mine, (loc) => loc.startsWith("EXP-")),
      };
    }),
    current: current.code,
    clients: clients.map((c) => ({ code: c.code, name: c.name })),
    items: items.map((it) => ({ sku: it.sku, description: it.description, client: clientIndex.get(it.clientId)!, unit: it.unit })),
    pallets: here.map((s) => ({
      id: s.id,
      loc: s.location,
      item: itemIndex.get(s.itemId)!,
      lot: s.lot,
      units: s.units,
      days: s.inbound ? Math.max(0, Math.floor((now - s.inbound.date.getTime()) / DAY)) : 0,
      expiresIn: s.expiresAt ? Math.ceil((s.expiresAt.getTime() - now) / DAY) : null,
      outbound: s.outboundId,
    })),
    orders: open.map((o) => {
      const plan = plans.get(o.id) ?? { warehouseId: null, stockIds: [], picked: [], short: 0 };
      return {
        id: o.id,
        number: o.number,
        warehouse: plan.warehouseId ? codeOf.get(plan.warehouseId)! : null,
        client: clientIndex.get(o.clientId)!,
        consignee: o.consignee?.name ?? null,
        deadline: (o.deadline ?? o.date).toISOString(),
        pallets: o.lines.reduce((sum, l) => sum + l.pallets, 0),
        lines: o.lines.map((l) => ({ sku: l.item.sku, description: l.item.description, pallets: l.pallets })),
        picks: plan.stockIds,
        picked: plan.picked,
        lane: plan.warehouseId ? dispatchLane(layoutOf.get(plan.warehouseId)!, stockIn(plan.warehouseId), o.id) : 1,
        short: plan.short,
        byClerk: o.notes?.startsWith("Alta DockClerk") ?? false,
      };
    }),
    prepared: prepared.map((o) => ({
      id: o.id,
      number: o.number,
      client: clientIndex.get(o.clientId)!,
      consignee: o.consignee?.name ?? null,
      deadline: (o.deadline ?? o.date).toISOString(),
      pallets: here.filter((s) => s.outboundId === o.id).length,
    })),
    truck: truck ? { number: truck.number, client: truck.client.name, plate: truck.plate, status: truck.status } : null,
    busyDocks: atDock.map((a) => a.dock),
  };
}
