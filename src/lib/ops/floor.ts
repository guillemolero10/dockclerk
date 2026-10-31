// What happens on the warehouse floor, shared by the driver's link and the operator's handheld.
// Every step writes into the same "legacy software" tables the office sees.

import type { Prisma } from "@prisma/client";
import { db, longTransaction } from "@/lib/db";
import { countLoad, readDeliveryNote } from "@/lib/ai/vision";
import { saveUpload, type Media } from "@/lib/uploads";
import { dispatchLane, receivingLane, suggestSlot } from "@/lib/warehouse/lanes";
import { abcClasses, velocitySlot } from "@/lib/warehouse/velocity";
import { makeLayout } from "@/lib/warehouse/layout";
import { allocatePicks } from "@/lib/warehouse/picking";
import { Fixable } from "@/lib/fixable";
import { checkBreakdown, leadIndex, sharesOf, summarize, type PalletDraft } from "@/lib/pallets/breakdown";
import { freshCodes } from "@/lib/pallets/codes";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const layoutOf = (w: { length: number; width: number; height: number; aisleWidth: number; docks: number }) => makeLayout(w);

export type NoteLine = { sku: string | null; description: string; lot: string | null; pallets: number | null; units: number | null; /** Pallet IDs printed on the note for this line, if any. */ palletCodes?: string[] | null };

type Tx = Prisma.TransactionClient;

/** Pallet IDs of the pallets inside the buildings right now, with where each one is. */
async function liveCodes(tx: Tx) {
  const rows = await tx.stock.findMany({ where: { palletCode: { not: null } }, select: { palletCode: true, location: true }, distinct: ["palletCode"] });
  return new Map(rows.map((r) => [r.palletCode!, r.location]));
}

/** `count` fresh pallet IDs for a building (N1-000123…): numbers taken with an atomic increment, skipping any ID that is alive. */
async function takeCodes(tx: Tx, warehouse: { id: string; code: string }, count: number, taken: Set<string>) {
  const out: string[] = [];
  while (out.length < count) {
    const need = count - out.length;
    const w = await tx.warehouse.update({ where: { id: warehouse.id }, data: { nextPalletNo: { increment: need } }, select: { nextPalletNo: true } });
    out.push(...freshCodes(warehouse.code, w.nextPalletNo - need, need, taken).codes.slice(0, need));
  }
  return out;
}

/**
 * After rows of a pallet changed: a pallet with one row left is a pallet of its own (head, no share);
 * with several, shares are worked out again and the head row (most share, lowest id on a tie) gets `pallets: 1`.
 */
async function rebalancePallet(tx: Tx, warehouseId: string, palletCode: string | null) {
  if (!palletCode) return;
  const rows = await tx.stock.findMany({ where: { warehouseId, palletCode }, orderBy: { id: "asc" }, include: { item: { select: { unitsPerPallet: true } } } });
  if (!rows.length) return;
  const shares = sharesOf(
    rows.map((r) => ({ itemId: r.itemId, lot: r.lot, expiresAt: null, units: r.units })),
    rows.map((r) => ({ id: r.itemId, sku: "", unitsPerPallet: r.item.unitsPerPallet })),
  );
  const lead = leadIndex(shares);
  for (const [i, r] of rows.entries()) {
    const data = { pallets: i === lead ? 1 : 0, palletShare: shares[i] };
    if (r.pallets !== data.pallets || r.palletShare !== data.palletShare) await tx.stock.update({ where: { id: r.id }, data });
  }
}

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

/**
 * The operator confirms what came off the truck, pallet by pallet: each one lands in the receiving lane by the door
 * with its ID (the supplier's, or one the warehouse generates: N1-000123). Several lines on one pallet = a mixed pallet,
 * one row of stock per line sharing the ID; `pallets` is 1 on the head row and 0 on the others.
 * Returns the generated IDs, to label those pallets. Throws a `Fixable` when the breakdown cannot be right.
 */
export async function confirmReceipt(inboundId: string, pallets: PalletDraft[], damages: { box: number; note: string }[], incident: string | null) {
  const inbound = await db.inbound.findUniqueOrThrow({ where: { id: inboundId }, include: { appointment: true, warehouse: true, receipt: true } });
  if (inbound.status === "RECEIVED" || inbound.status === "CLOSED") return { codes: [] as string[] };
  const warehouse = inbound.warehouse ?? (await db.warehouse.findFirstOrThrow({ orderBy: { code: "asc" } }));
  const layout = layoutOf(warehouse);
  const here = await db.stock.findMany({ where: { warehouseId: warehouse.id }, select: { location: true, outboundId: true } });
  const lane = receivingLane(layout, here, inbound.appointment?.dock ?? layout.docks[0].n);
  const items = await db.item.findMany({ where: { clientId: inbound.clientId }, select: { id: true, sku: true, unitsPerPallet: true } });

  const count = pallets.length;
  const units = pallets.reduce((sum, p) => sum + p.lines.reduce((a, l) => a + l.units, 0), 0);
  const expected = inbound.expectedPallets ?? inbound.receipt?.notePallets ?? null;
  const mismatch = expected !== null && expected !== count ? `Delivery note says ${expected} pallets, ${count} received.` : null;
  const note = [mismatch, damages.length ? `${damages.length} damaged ${damages.length === 1 ? "box" : "boxes"}.` : null, incident].filter(Boolean).join(" ") || null;

  return db.$transaction(async (tx) => {
    // Claim the delivery first: a double click or a second handheld finds it already received and writes nothing.
    const claim = await tx.inbound.updateMany({
      where: { id: inboundId, status: { notIn: ["RECEIVED", "CLOSED"] } },
      data: { status: "RECEIVED", receivedAt: new Date(), warehouseId: warehouse.id, receivedPallets: count, receivedUnits: units, incident: note },
    });
    if (claim.count !== 1) return { codes: [] as string[] };

    const live = await liveCodes(tx);
    const { errors } = checkBreakdown(pallets, items, live);
    if (errors.length) throw new Fixable(errors.slice(0, 3).join(" "));

    const taken = new Set([...live.keys(), ...pallets.flatMap((p) => (p.code ? [p.code] : []))]);
    const fresh = await takeCodes(tx, warehouse, pallets.filter((p) => !p.code).length, taken);
    let next = 0;
    const final = pallets.map((p) => ({ ...p, generated: !p.code, code: p.code ?? fresh[next++] }));

    const rows = final.flatMap((p) => {
      const shares = sharesOf(p.lines, items);
      const lead = leadIndex(shares);
      return p.lines.map((l, i) => ({
        warehouseId: warehouse.id, clientId: inbound.clientId, itemId: l.itemId, lot: l.lot, expiresAt: l.expiresAt ? new Date(`${l.expiresAt}T00:00:00.000Z`) : null,
        pallets: i === lead ? 1 : 0, palletShare: shares[i], palletCode: p.code, units: l.units, location: `REC-${lane}`, inboundId,
      }));
    });
    await tx.inboundLine.deleteMany({ where: { inboundId } });
    await tx.inboundLine.createMany({ data: summarize(pallets).map((l) => ({ inboundId, itemId: l.itemId, lot: l.lot, pallets: l.pallets, units: l.units })) });
    await tx.stock.createMany({ data: rows });
    const skuOf = new Map(items.map((i) => [i.id, i.sku]));
    const breakdown = final.map((p) => ({
      code: p.code, generated: p.generated,
      lines: p.lines.map((l) => ({ itemId: l.itemId, sku: skuOf.get(l.itemId) ?? null, lot: l.lot, expiresAt: l.expiresAt, units: l.units })),
    }));
    await tx.dockReceipt.upsert({
      where: { inboundId },
      create: { inboundId, countedPallets: count, countedUnits: units, damages: json(damages), pallets: json(breakdown) },
      update: { countedPallets: count, countedUnits: units, damages: json(damages), pallets: json(breakdown) },
    });
    return { codes: final.filter((p) => p.generated).map((p) => p.code) };
  }, longTransaction);
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

/** Puts a pallet in a rack slot. Every row of the same pallet ID that waits in the same place goes with it (a mixed pallet moves as one). */
export async function putAway(stockId: string, location: string) {
  const pallet = await db.stock.findUniqueOrThrow({ where: { id: stockId }, include: { warehouse: true } });
  if (!layoutOf(pallet.warehouse).contains(location) || location.startsWith("REC-") || location.startsWith("EXP-")) throw new Error(`${location} is not a rack slot here.`);
  const together = pallet.palletCode
    ? { warehouseId: pallet.warehouseId, palletCode: pallet.palletCode, location: pallet.location, outboundId: null }
    : { id: stockId };
  await db.$transaction(async (tx) => {
    const busy = await tx.stock.findFirst({ where: { warehouseId: pallet.warehouseId, location, NOT: pallet.palletCode ? { palletCode: pallet.palletCode } : { id: stockId } } });
    if (busy) throw new Error(`${location} is taken.`);
    const moved = await tx.stock.updateMany({ where: together, data: { location } });
    if (moved.count < 1) throw new Error("That pallet is not waiting there any more. Reload the list.");
  }, longTransaction);
}

// ---------- picking and shipping ----------

/** Pick plan of every open outbound, as the 3D view shows it. */
export async function openPickPlans() {
  const [stock, open] = await Promise.all([
    db.stock.findMany({ include: { inbound: { select: { date: true } } } }),
    db.outbound.findMany({ where: { status: "REQUESTED" }, include: { lines: { include: { item: true } } } }),
  ]);
  const plans = allocatePicks(
    stock.map((s) => ({ ...s, receivedAt: s.inbound?.date ?? null })),
    open.map((o) => ({ id: o.id, number: o.number, date: o.date, deadline: o.deadline, lines: o.lines.map((l) => ({ itemId: l.itemId, units: l.units, unitsPerPallet: l.item.unitsPerPallet })) })),
  );
  return { plans, stock, open };
}

/**
 * Does the next step of the pick list that contains `stockId`; when everything is there, the outbound is prepared.
 * - a `pallet` step moves the whole pallet (all its rows) to the dispatch lane, keeping its ID;
 * - a `boxes` step takes boxes off a pallet onto a NEW pallet in the dispatch lane, with a new generated ID
 *   (`splitFrom` = the ID it came off). `units` must be exactly the boxes to take when the step takes only part of the row.
 *   A mixed pallet that stays behind is re-shared (the head row may change).
 * Returns the new pallet's ID when boxes were taken, so the operator can label it.
 */
export async function pickPallet(outboundId: string, stockId: string, units?: number) {
  const { plans, stock, open } = await openPickPlans();
  const plan = plans.get(outboundId);
  const order = open.find((o) => o.id === outboundId);
  if (!plan || !order || !plan.warehouseId) throw new Error("Nothing to pick for this outbound.");
  if (!plan.stockIds.includes(stockId) || plan.picked.includes(stockId)) throw new Error("That pallet is not on this pick list.");
  const step = plan.steps.find((p) => (p.kind === "pallet" ? p.stockIds.includes(stockId) : p.stockId === stockId));
  if (!step) throw new Error("That pallet is not on this pick list.");

  const row = stock.find((s) => s.id === stockId)!;
  const rowsOf = step.kind === "pallet" ? step.stockIds.map((id) => stock.find((s) => s.id === id)!) : [row];
  const expected = step.kind === "boxes" ? step.units : rowsOf.reduce((sum, r) => sum + r.units, 0);
  const partial = step.kind === "boxes" && step.units < row.units;
  if (units !== undefined && (!Number.isInteger(units) || units !== expected) && (partial || rowsOf.length === 1)) throw new Error(`Take ${expected} boxes from ${row.location}.`);
  if (partial && units === undefined) throw new Error(`Take ${expected} boxes from ${row.location}.`);

  const warehouse = await db.warehouse.findUniqueOrThrow({ where: { id: plan.warehouseId } });
  const lane = dispatchLane(layoutOf(warehouse), stock.filter((s) => s.warehouseId === warehouse.id), outboundId);
  // The plan was made before this transaction: check again, inside it, that the rows are still as the plan saw them.
  // If another operator took them in between, nothing is written and the person reloads the list.
  const stale = new Error("Somebody else just picked from this pallet. Reload the list and try again.");
  let newCode: string | null = null;
  await db.$transaction(async (tx) => {
    if (step.kind === "pallet") {
      for (const r of rowsOf) {
        const moved = await tx.stock.updateMany({ where: { id: r.id, outboundId: null, units: r.units }, data: { outboundId, location: `EXP-${lane}` } });
        if (moved.count !== 1) throw stale;
      }
      return;
    }
    [newCode] = await takeCodes(tx, warehouse, 1, new Set((await liveCodes(tx)).keys()));
    const origin = row.palletCode;
    if (partial) {
      const cut = await tx.stock.updateMany({ where: { id: stockId, outboundId: null, units: { gte: step.units } }, data: { units: { decrement: step.units } } });
      if (cut.count !== 1) throw stale;
      await tx.stock.create({
        data: {
          warehouseId: row.warehouseId, clientId: row.clientId, itemId: row.itemId, lot: row.lot, expiresAt: row.expiresAt,
          pallets: 1, units: step.units, location: `EXP-${lane}`, outboundId, inboundId: row.inboundId,
          palletCode: newCode, palletShare: null, splitFrom: origin,
        },
      });
    } else {
      // The whole row of a mixed pallet leaves; the rest of the pallet stays in its slot.
      const moved = await tx.stock.updateMany({
        where: { id: stockId, outboundId: null, units: row.units },
        data: { outboundId, location: `EXP-${lane}`, palletCode: newCode, palletShare: null, splitFrom: origin, pallets: 1 },
      });
      if (moved.count !== 1) throw stale;
    }
    await rebalancePallet(tx, row.warehouseId, origin);
  }, longTransaction);

  const now = step.kind === "pallet" ? rowsOf.length : 1;
  const done = plan.picked.length + now >= plan.stockIds.length && plan.shortUnits === 0;
  if (done) await db.outbound.update({ where: { id: outboundId }, data: { status: "PREPARED", warehouseId: warehouse.id } });
  return { done, lane, newCode: newCode as string | null };
}

/** Truck loaded: the pallets leave the building and the lots (and pallet IDs) are recorded on the outbound. */
export async function shipOutbound(outboundId: string) {
  const picked = await db.stock.findMany({ where: { outboundId }, include: { item: true } });
  await db.$transaction([
    db.outbound.update({
      where: { id: outboundId },
      data: {
        status: "SHIPPED",
        shippedAt: new Date(),
        shipped: json(picked.map((s) => ({
          itemId: s.itemId, sku: s.item.sku, lot: s.lot, units: s.units, location: s.location, inboundId: s.inboundId,
          palletCode: s.palletCode, palletShare: s.palletShare, splitFrom: s.splitFrom,
        }))),
      },
    }),
    db.stock.deleteMany({ where: { outboundId } }),
  ]);
}
