// What happens on the warehouse floor, shared by the driver's link and the operator's handheld.
// Every step writes into the same "legacy software" tables the office sees.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { countLoad, readDeliveryNote } from "@/lib/ai/vision";
import { saveUpload, type Media } from "@/lib/uploads";
import { dispatchLane, receivingLane, suggestSlot } from "@/lib/warehouse/lanes";
import { abcClasses, velocitySlot } from "@/lib/warehouse/velocity";
import { makeLayout } from "@/lib/warehouse/layout";
import { allocatePicks } from "@/lib/warehouse/picking";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const layoutOf = (w: { length: number; width: number; height: number; aisleWidth: number; docks: number }) => makeLayout(w);

export type NoteLine = { sku: string | null; description: string; lot: string | null; pallets: number | null; units: number | null };

async function receiptFor(inboundId: string) {
  return db.dockReceipt.upsert({ where: { inboundId }, create: { inboundId }, update: {} });
}

// ---------- receiving ----------

/**
 * Photo of the delivery note: Muse Spark reads it when available, otherwise a person types the pallets.
 * `read: false` keeps the photo but skips the model (used when a link has asked for too many readings).
 */
export async function recordNote(inboundId: string, media: Media, options: { read?: boolean } = {}) {
  const inbound = await db.inbound.findUniqueOrThrow({ where: { id: inboundId }, include: { client: { include: { items: true } } } });
  const url = await saveUpload("note", media);
  await receiptFor(inboundId);
  const reading = options.read === false ? null : await readDeliveryNote(media, { customer: inbound.client.name, items: inbound.client.items });
  if (!reading) {
    await db.dockReceipt.update({ where: { inboundId }, data: { noteImageUrl: url } });
    return { read: false as const };
  }
  const pallets = reading.totalPallets ?? reading.lines.reduce((sum, l) => sum + (l.pallets ?? 0), 0);
  await saveNoteLines(inbound.id, inbound.client.items, reading.lines, pallets, "muse-spark", url, reading.docRef);
  return { read: true as const, reading };
}

/** Typed instead of read: just how many pallets, and optionally which item. */
export async function typeNote(inboundId: string, pallets: number, sku: string | null, by: "driver" | "operator") {
  const inbound = await db.inbound.findUniqueOrThrow({ where: { id: inboundId }, include: { client: { include: { items: true } } } });
  await receiptFor(inboundId);
  const item = inbound.client.items.find((i) => i.sku === sku);
  const lines: NoteLine[] = [{ sku: item?.sku ?? null, description: item?.description ?? "", lot: null, pallets, units: item ? pallets * item.unitsPerPallet : null }];
  await saveNoteLines(inbound.id, inbound.client.items, lines, pallets, by, undefined, null);
}

async function saveNoteLines(
  inboundId: string,
  items: { id: string; sku: string; unitsPerPallet: number }[],
  lines: NoteLine[],
  pallets: number,
  readBy: string,
  noteImageUrl: string | undefined,
  docRef: string | null,
) {
  const known = lines.filter((l) => l.sku && l.pallets);
  await db.$transaction([
    db.dockReceipt.update({
      where: { inboundId },
      data: { noteData: json(lines), notePallets: pallets || null, readBy, ...(noteImageUrl ? { noteImageUrl } : {}) },
    }),
    db.inbound.update({
      where: { id: inboundId },
      data: {
        expectedPallets: pallets || null,
        expectedUnits: known.reduce((sum, l) => sum + (l.units ?? 0), 0) || null,
        ...(docRef ? { clientDocRef: docRef } : {}),
      },
    }),
    // Expected lines, replaced by what is actually received later.
    db.inboundLine.deleteMany({ where: { inboundId } }),
    ...known.map((l) => {
      const item = items.find((i) => i.sku === l.sku)!;
      return db.inboundLine.create({ data: { inboundId, itemId: item.id, lot: l.lot, pallets: l.pallets!, units: l.units ?? l.pallets! * item.unitsPerPallet } });
    }),
  ]);
}

/** Driver at the gate, or the office ticking it: the slot turns "at the dock". */
export async function checkIn(inboundId: string) {
  const inbound = await db.inbound.findUniqueOrThrow({ where: { id: inboundId }, include: { appointment: true } });
  await db.$transaction([
    ...(inbound.appointment?.status === "BOOKED"
      ? [db.dockAppointment.update({ where: { id: inbound.appointment.id }, data: { status: "ARRIVED", arrivedAt: new Date() } })]
      : []),
    ...(inbound.status === "EXPECTED" ? [db.inbound.update({ where: { id: inboundId }, data: { status: "RECEIVING" } })] : []),
  ]);
}

/** Photo of the load: SAM 3.1 finds the boxes; the operator confirms the numbers. */
export async function recordLoad(inboundId: string, media: Media) {
  const url = await saveUpload("load", media);
  await receiptFor(inboundId);
  const count = await countLoad(media);
  await db.dockReceipt.update({
    where: { inboundId },
    data: {
      palletImageUrl: url,
      boxes: count ? json(count.boxes) : undefined,
      countedBy: count?.by ?? null,
      countedPallets: count?.pallets ?? null,
      countedUnits: count ? count.boxes.length : null,
      damages: count ? json(count.boxes.flatMap((b, i) => (b.damaged ? [{ box: i + 1, note: "Damaged" }] : []))) : undefined,
    },
  });
  return count;
}

export type ReceivedLine = { itemId: string; lot: string | null; pallets: number; unitsPerPallet: number };

/** The operator confirms what came off the truck: pallets land in the receiving lane by the door. */
export async function confirmReceipt(inboundId: string, lines: ReceivedLine[], damages: { box: number; note: string }[], incident: string | null) {
  const inbound = await db.inbound.findUniqueOrThrow({ where: { id: inboundId }, include: { appointment: true, warehouse: true, receipt: true } });
  if (inbound.status === "RECEIVED" || inbound.status === "CLOSED") return;
  const warehouse = inbound.warehouse ?? (await db.warehouse.findFirstOrThrow({ orderBy: { code: "asc" } }));
  const layout = layoutOf(warehouse);
  const here = await db.stock.findMany({ where: { warehouseId: warehouse.id }, select: { location: true, outboundId: true } });
  const lane = receivingLane(layout, here, inbound.appointment?.dock ?? layout.docks[0].n);

  const pallets = lines.reduce((sum, l) => sum + l.pallets, 0);
  const units = lines.reduce((sum, l) => sum + l.pallets * l.unitsPerPallet, 0);
  const expected = inbound.expectedPallets ?? inbound.receipt?.notePallets ?? null;
  const mismatch = expected !== null && expected !== pallets ? `Delivery note says ${expected} pallets, ${pallets} received.` : null;
  const note = [mismatch, damages.length ? `${damages.length} damaged boxes.` : null, incident].filter(Boolean).join(" ") || null;

  await db.$transaction([
    db.inboundLine.deleteMany({ where: { inboundId } }),
    ...lines.map((l) => db.inboundLine.create({ data: { inboundId, itemId: l.itemId, lot: l.lot, pallets: l.pallets, units: l.pallets * l.unitsPerPallet } })),
    db.stock.createMany({
      data: lines.flatMap((l) =>
        Array.from({ length: l.pallets }, () => ({
          warehouseId: warehouse.id, clientId: inbound.clientId, itemId: l.itemId, lot: l.lot, pallets: 1, units: l.unitsPerPallet,
          location: `REC-${lane}`, inboundId,
        })),
      ),
    }),
    db.inbound.update({
      where: { id: inboundId },
      data: { status: "RECEIVED", warehouseId: warehouse.id, receivedPallets: pallets, receivedUnits: units, incident: note },
    }),
    db.dockReceipt.upsert({
      where: { inboundId },
      create: { inboundId, countedPallets: pallets, countedUnits: units, damages: json(damages) },
      update: { countedPallets: pallets, countedUnits: units, damages: json(damages) },
    }),
  ]);
}

/** The driver signs on their phone: the receipt is closed and the truck can leave. */
export async function signReceipt(inboundId: string, signature: Media, name: string) {
  const url = await saveUpload("signature", signature);
  const inbound = await db.inbound.findUniqueOrThrow({ where: { id: inboundId }, include: { appointment: true } });
  await db.$transaction([
    db.dockReceipt.update({ where: { inboundId }, data: { signatureUrl: url, signedAt: new Date(), signedBy: name } }),
    ...(inbound.appointment && inbound.appointment.status !== "DONE"
      ? [db.dockAppointment.update({ where: { id: inbound.appointment.id }, data: { status: "DONE" } })]
      : []),
  ]);
}

// ---------- put away ----------

/** Best free slot for a pallet waiting in a receiving lane. */
export async function suggestPutAway(stockId: string, taken: string[] = []) {
  return (await planPutAway(stockId, taken)).slot;
}

/**
 * The slot for a received pallet, and why. By default next to the customer's other goods;
 * with the velocity rule (switched on from an analyst report), by how fast the item moves:
 * class A low and near the dock, class C at the back and on top.
 */
export async function planPutAway(stockId: string, taken: string[] = []) {
  const pallet = await db.stock.findUniqueOrThrow({ where: { id: stockId }, include: { warehouse: true } });
  const layout = layoutOf(pallet.warehouse);
  const here = await db.stock.findMany({ where: { warehouseId: pallet.warehouseId }, select: { location: true, clientId: true } });
  const occupied = new Set([...here.map((s) => s.location), ...taken]);
  if (pallet.warehouse.putaway === "velocity") {
    const lines = await db.outboundLine.groupBy({
      by: ["itemId"],
      where: { outbound: { warehouseId: pallet.warehouseId, date: { gte: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }, status: { in: ["PREPARED", "SHIPPED", "CLOSED"] } } },
      _sum: { pallets: true },
    });
    const speed = abcClasses(new Map(lines.map((l) => [l.itemId, l._sum.pallets ?? 0]))).classes.get(pallet.itemId) ?? "C";
    const why = { A: "Fast mover (class A): low and near the dock", B: "Steady mover (class B): middle of the racks", C: "Slow mover (class C): back and top, to keep the quick slots free" }[speed];
    return { slot: velocitySlot(layout, occupied, speed), why };
  }
  return { slot: suggestSlot(layout, occupied, here.filter((s) => s.clientId === pallet.clientId).map((s) => s.location)), why: "Next to the customer's goods" };
}

export async function putAway(stockId: string, location: string) {
  const pallet = await db.stock.findUniqueOrThrow({ where: { id: stockId }, include: { warehouse: true } });
  if (!layoutOf(pallet.warehouse).contains(location) || location.startsWith("REC-") || location.startsWith("EXP-")) throw new Error(`${location} is not a rack slot here.`);
  const busy = await db.stock.findFirst({ where: { warehouseId: pallet.warehouseId, location } });
  if (busy) throw new Error(`${location} is taken.`);
  await db.stock.update({ where: { id: stockId }, data: { location } });
}

// ---------- picking and shipping ----------

/** Pick plan of every open outbound, as the 3D view shows it. */
export async function openPickPlans() {
  const [stock, open] = await Promise.all([
    db.stock.findMany({ include: { inbound: { select: { date: true } } } }),
    db.outbound.findMany({ where: { status: "REQUESTED" }, include: { lines: true } }),
  ]);
  const plans = allocatePicks(
    stock.map((s) => ({ ...s, receivedAt: s.inbound?.date ?? null })),
    open.map((o) => ({ id: o.id, number: o.number, date: o.date, deadline: o.deadline, lines: o.lines })),
  );
  return { plans, stock, open };
}

/** Takes one pallet to the outbound's dispatch lane. When everything is there, the outbound is prepared. */
export async function pickPallet(outboundId: string, stockId: string) {
  const { plans, stock, open } = await openPickPlans();
  const plan = plans.get(outboundId);
  const order = open.find((o) => o.id === outboundId);
  if (!plan || !order || !plan.warehouseId) throw new Error("Nothing to pick for this outbound.");
  if (!plan.stockIds.includes(stockId) || plan.picked.includes(stockId)) throw new Error("That pallet is not on this pick list.");

  const warehouse = await db.warehouse.findUniqueOrThrow({ where: { id: plan.warehouseId } });
  const lane = dispatchLane(layoutOf(warehouse), stock.filter((s) => s.warehouseId === warehouse.id), outboundId);
  await db.stock.update({ where: { id: stockId }, data: { outboundId, location: `EXP-${lane}` } });

  const done = plan.picked.length + 1 >= plan.stockIds.length && plan.short === 0;
  if (done) await db.outbound.update({ where: { id: outboundId }, data: { status: "PREPARED", warehouseId: warehouse.id } });
  return { done, lane };
}

/** Truck loaded: the pallets leave the building and the lots are recorded on the outbound. */
export async function shipOutbound(outboundId: string) {
  const picked = await db.stock.findMany({ where: { outboundId }, include: { item: true } });
  await db.$transaction([
    db.outbound.update({
      where: { id: outboundId },
      data: {
        status: "SHIPPED",
        shipped: json(picked.map((s) => ({ itemId: s.itemId, sku: s.item.sku, lot: s.lot, units: s.units, location: s.location, inboundId: s.inboundId }))),
      },
    }),
    db.stock.deleteMany({ where: { outboundId } }),
  ]);
}
