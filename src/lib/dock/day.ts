// A day at the docks of one warehouse: booked slots and the trucks still without one.

import { db } from "@/lib/db";
import { madridDay } from "@/lib/format";
import { makeLayout } from "@/lib/warehouse/layout";
import { allocatePicks } from "@/lib/warehouse/picking";
import { slotMinutes } from "./slots";

const HOUR = 60 * 60 * 1000;
/** Rough driving time to the customer, to turn "deliver by" into "pick up at". */
export const TRANSIT_H = 3;

/** Warehouse each open outbound will leave from (the same plan the 3D view and the picker use). */
export async function plannedWarehouses() {
  const [stock, open] = await Promise.all([
    db.stock.findMany({ select: { id: true, warehouseId: true, itemId: true, location: true, units: true, expiresAt: true, outboundId: true, palletCode: true, inbound: { select: { date: true } } } }),
    db.outbound.findMany({ where: { status: "REQUESTED" }, include: { lines: { include: { item: { select: { unitsPerPallet: true } } } } } }),
  ]);
  const plans = allocatePicks(
    stock.map((s) => ({ ...s, receivedAt: s.inbound?.date ?? null })),
    open.map((o) => ({ id: o.id, number: o.number, date: o.date, deadline: o.deadline, lines: o.lines.map((l) => ({ itemId: l.itemId, units: l.units, unitsPerPallet: l.item.unitsPerPallet })) })),
  );
  return new Map([...plans].map(([id, plan]) => [id, plan.warehouseId]));
}

export type DockOrder = {
  /** "in:<inboundId>" or "out:<outboundId>", as the booking form sends it. */
  key: string;
  kind: "in" | "out";
  number: number;
  client: string;
  /** Supplier for an inbound, destination for an outbound. */
  counterpart: string;
  pallets: number | null;
  /** When the truck should be at the dock. */
  preferred: Date;
  minutes: number;
  orderStatus: string;
  plate: string | null;
};

export type DockSlot = DockOrder & {
  id: string;
  dock: number;
  start: Date;
  end: Date;
  status: "BOOKED" | "ARRIVED" | "DONE" | "NO_SHOW";
  arrivedAt: Date | null;
  bookedBy: string;
  carrier: string | null;
  driverToken: string | null;
};

const palletsOf = (lines: { pallets: number }[]) => (lines.length ? lines.reduce((sum, l) => sum + l.pallets, 0) : null);

export async function getDockDay(code: string | undefined, ymd: string) {
  const warehouses = await db.warehouse.findMany({ orderBy: { code: "asc" } });
  if (!warehouses.length) return null;
  const current = warehouses.find((w) => w.code === code) ?? warehouses[0];
  const layout = makeLayout({ length: current.length, width: current.width, height: current.height, aisleWidth: current.aisleWidth, docks: current.docks });
  const day = madridDay(ymd);
  const inDay = { gte: day.start, lt: day.end };

  const [booked, perWarehouse, outbounds, inbounds, plan] = await Promise.all([
    db.dockAppointment.findMany({
      where: { warehouseId: current.id, startsAt: inDay },
      include: {
        carrier: true,
        inbound: { include: { client: true, lines: true } },
        outbound: { include: { client: true, consignee: true, lines: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
    db.dockAppointment.groupBy({ by: ["warehouseId"], where: { startsAt: inDay, status: { not: "NO_SHOW" } }, _count: true }),
    db.outbound.findMany({
      where: { status: { in: ["REQUESTED", "PREPARED"] }, appointment: null, date: inDay },
      include: { client: true, consignee: true, lines: true, carrier: true },
      orderBy: { deadline: "asc" },
    }),
    db.inbound.findMany({
      where: { status: "EXPECTED", warehouseId: current.id, appointment: null, date: inDay },
      include: { client: true, lines: true },
    }),
    plannedWarehouses(),
  ]);

  const outboundOrder = (o: (typeof outbounds)[number]): DockOrder => {
    const pallets = palletsOf(o.lines);
    const due = o.deadline ?? new Date(o.date.getTime() + 12 * HOUR);
    return {
      key: `out:${o.id}`, kind: "out", number: o.number, client: o.client.name, counterpart: o.consignee?.name ?? "—", pallets,
      preferred: new Date(due.getTime() - TRANSIT_H * HOUR), minutes: slotMinutes("out", pallets), orderStatus: o.status, plate: o.carrier?.plate ?? null,
    };
  };
  const inboundOrder = (i: (typeof inbounds)[number]): DockOrder => {
    const pallets = i.expectedPallets ?? palletsOf(i.lines);
    return {
      key: `in:${i.id}`, kind: "in", number: i.number, client: i.client.name, counterpart: i.supplier ?? i.client.name, pallets,
      preferred: new Date(day.start.getTime() + 8 * HOUR), minutes: slotMinutes("in", pallets), orderStatus: i.status, plate: i.plate,
    };
  };

  const slots: DockSlot[] = booked.map((a) => {
    const base = a.inbound ? inboundOrder({ ...a.inbound }) : outboundOrder({ ...a.outbound!, carrier: a.carrier });
    return {
      ...base,
      id: a.id,
      dock: a.dock,
      start: a.startsAt,
      end: a.endsAt,
      status: a.status,
      arrivedAt: a.arrivedAt,
      bookedBy: a.bookedBy,
      carrier: a.carrier?.name ?? null,
      plate: a.plate ?? base.plate,
      driverToken: a.inbound?.driverToken ?? null,
    };
  });

  const waiting = [
    ...inbounds.map(inboundOrder),
    ...outbounds
      .filter((o) => (o.status === "PREPARED" ? o.warehouseId === current.id : plan.get(o.id) === current.id))
      .map(outboundOrder),
  ].sort((a, b) => a.preferred.getTime() - b.preferred.getTime());

  return {
    warehouses: warehouses.map((w) => ({ code: w.code, name: w.name, trucks: perWarehouse.find((p) => p.warehouseId === w.id)?._count ?? 0 })),
    current: { id: current.id, code: current.code, name: current.name },
    docks: layout.docks,
    day,
    slots,
    waiting,
  };
}
