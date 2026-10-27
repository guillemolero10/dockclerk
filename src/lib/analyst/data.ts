// Everything the analyst studies, read from the warehouse software in one go.
// The analyses work on this plain shape, so they can be tested without a database.

import { db } from "@/lib/db";
import type { WarehouseDims } from "@/lib/warehouse/layout";

const DAY = 24 * 60 * 60 * 1000;

export type AnalystData = {
  now: Date;
  /** Days of history studied. */
  days: number;
  warehouses: { id: string; code: string; name: string; dims: WarehouseDims }[];
  clients: { id: string; code: string; name: string; contact: string | null }[];
  items: { id: string; clientId: string; sku: string; description: string; unitsPerPallet: number }[];
  stock: { id: string; warehouseId: string; clientId: string; itemId: string; location: string; pallets: number; outboundId: string | null; received: Date | null }[];
  outbounds: {
    id: string;
    date: Date;
    clientId: string;
    warehouseId: string | null;
    status: "REQUESTED" | "PREPARED" | "SHIPPED" | "CLOSED";
    lines: { itemId: string; pallets: number }[];
  }[];
  inbounds: {
    id: string;
    date: Date;
    clientId: string;
    warehouseId: string | null;
    supplier: string | null;
    carrier: string | null;
    expected: number | null;
    received: number | null;
    incident: string | null;
    status: "EXPECTED" | "RECEIVING" | "RECEIVED" | "CLOSED";
    lines: { itemId: string; pallets: number }[];
  }[];
  slots: { warehouseId: string; startsAt: Date; arrivedAt: Date | null; carrier: string | null; kind: "in" | "out" }[];
};

export async function loadAnalystData(days: number, now = new Date()): Promise<AnalystData> {
  const since = new Date(now.getTime() - days * DAY);
  const [warehouses, clients, items, stock, outbounds, inbounds, slots] = await Promise.all([
    db.warehouse.findMany({ orderBy: { code: "asc" } }),
    db.client.findMany({ orderBy: { code: "asc" } }),
    db.item.findMany({ orderBy: { sku: "asc" } }),
    db.stock.findMany({
      select: { id: true, warehouseId: true, clientId: true, itemId: true, location: true, pallets: true, outboundId: true, inbound: { select: { date: true } } },
    }),
    // Open orders whatever their date (they reserve stock), the rest inside the window.
    db.outbound.findMany({
      where: { OR: [{ date: { gte: since } }, { status: { in: ["REQUESTED", "PREPARED"] } }] },
      select: { id: true, date: true, clientId: true, warehouseId: true, status: true, lines: { select: { itemId: true, pallets: true } } },
    }),
    db.inbound.findMany({
      where: { date: { gte: since } },
      select: {
        id: true, date: true, clientId: true, warehouseId: true, supplier: true, expectedPallets: true, receivedPallets: true, incident: true, status: true,
        carrier: { select: { name: true } },
        lines: { select: { itemId: true, pallets: true } },
      },
    }),
    db.dockAppointment.findMany({
      where: { startsAt: { gte: since, lt: now }, status: { in: ["ARRIVED", "DONE"] } },
      select: { warehouseId: true, startsAt: true, arrivedAt: true, inboundId: true, carrier: { select: { name: true } } },
    }),
  ]);

  return {
    now,
    days,
    warehouses: warehouses.map((w) => ({
      id: w.id, code: w.code, name: w.name,
      dims: { length: w.length, width: w.width, height: w.height, aisleWidth: w.aisleWidth, docks: w.docks },
    })),
    clients: clients.map((c) => ({ id: c.id, code: c.code, name: c.name, contact: c.contact })),
    items: items.map((i) => ({ id: i.id, clientId: i.clientId, sku: i.sku, description: i.description, unitsPerPallet: i.unitsPerPallet })),
    stock: stock.map(({ inbound, ...s }) => ({ ...s, received: inbound?.date ?? null })),
    outbounds,
    inbounds: inbounds.map((i) => ({
      id: i.id, date: i.date, clientId: i.clientId, warehouseId: i.warehouseId, supplier: i.supplier, carrier: i.carrier?.name ?? null,
      expected: i.expectedPallets, received: i.receivedPallets, incident: i.incident, status: i.status, lines: i.lines,
    })),
    slots: slots.map((s) => ({ warehouseId: s.warehouseId, startsAt: s.startsAt, arrivedAt: s.arrivedAt, carrier: s.carrier?.name ?? null, kind: s.inboundId ? "in" : "out" })),
  };
}
