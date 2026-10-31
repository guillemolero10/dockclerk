"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { runClerk } from "@/lib/agent";
import { withUnits } from "@/lib/agent/lines";
import { orderReply } from "@/lib/agent/rules";
import type { Doubt, DraftSeed, OutboundPayload, Step } from "@/lib/agent/types";
import { db, longTransaction } from "@/lib/db";
import { madridDayRange } from "@/lib/format";
import { PORTAL_LIVE_ADDRESS } from "@/lib/portal";
import { makeLayout } from "@/lib/warehouse/layout";
import { suggestSlot } from "@/lib/warehouse/lanes";
import { planRestore } from "@/lib/warehouse/restore";
import { assertRole } from "@/lib/session";

// Every exported function below is reachable by anybody who can POST to the site: check the role in each one.
const requireOffice = () => assertRole("office");

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Runs the clerk on one message and stores its drafts. Called one by one so the UI can show progress. */
export async function processMessage(messageId: string): Promise<{ steps: Step[]; kinds: DraftSeed["kind"][] }> {
  await requireOffice();
  // Claim the message in one step: if two clicks (or two tabs) arrive together only one of them gets count === 1,
  // so a message is never drafted twice, and the second one does not pay the model for nothing.
  const claimed = await db.message.updateMany({ where: { id: messageId, status: "NEW" }, data: { status: "PROCESSING" } });
  if (claimed.count !== 1) return { steps: [], kinds: [] };
  const message = await db.message.findUnique({ where: { id: messageId }, include: { client: true } });
  if (!message) return { steps: [], kinds: [] };
  try {
    const drafts = await runClerk(message);
    await db.$transaction([
      ...drafts.map((d) =>
        db.draft.create({
          data: { messageId, kind: d.kind, payload: json(d.payload), doubts: json(d.doubts), steps: json(d.steps), reply: d.reply },
        }),
      ),
      db.message.update({ where: { id: messageId }, data: { status: "PROCESSED" } }),
    ]);
    return { steps: drafts.flatMap((d) => d.steps), kinds: drafts.map((d) => d.kind) };
  } catch (error) {
    // Leave it in the inbox for the next run instead of losing it.
    await db.message.update({ where: { id: messageId }, data: { status: "NEW" } });
    throw error;
  }
}

/** Approval writes into the warehouse software. Nothing reaches it without this click. */
export async function approveDraft(formData: FormData) {
  await requireOffice();
  const id = String(formData.get("draftId") ?? "");
  const draft = await db.draft.findUnique({ where: { id }, include: { message: true } });
  if (!draft || draft.status !== "PENDING") return;

  if (draft.kind !== "CREATE_OUTBOUND") {
    await db.draft.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED" } });
    revalidatePath("/office", "layout");
    return;
  }

  const payload = structuredClone(draft.payload) as unknown as OutboundPayload;
  for (const doubt of draft.doubts as unknown as Doubt[]) {
    const value = formData.get(doubt.field);
    if (typeof value !== "string" || !doubt.options.some((o) => o.value === value)) {
      throw new Error(`Pick an option for: ${doubt.question}`);
    }
    if (doubt.field === "consigneeId") {
      const consignee = await db.consignee.findUniqueOrThrow({ where: { id: value } });
      payload.consigneeId = consignee.id;
      payload.consigneeName = consignee.name;
    } else {
      const idx = payload.lines.findIndex((l) => `units:${l.sku}` === doubt.field);
      if (idx >= 0) payload.lines[idx] = withUnits(payload.lines[idx], Number(value));
    }
  }

  if (!payload.lines.every((l) => Number.isInteger(l.units) && l.units > 0)) throw new Error("This draft has no valid quantity. Discard it and replay the message.");

  const deliverBy = payload.deliverBy ? new Date(payload.deliverBy) : null;
  // Claim the draft and create the outbound in one transaction: with two clicks (or two tabs) only one gets count === 1,
  // the other one rolls back without creating anything.
  const outbound = await db.$transaction(async (tx) => {
    const claimed = await tx.draft.updateMany({ where: { id, status: "PENDING" }, data: { status: "APPROVED" } });
    if (claimed.count !== 1) return null;
    const created = await tx.outbound.create({
      data: {
        date: madridDayRange(deliverBy ?? new Date()).start,
        deadline: deliverBy,
        clientId: payload.clientId,
        clientDocRef: payload.clientDocRef,
        consigneeId: payload.consigneeId,
        notes: "Alta DockClerk · aprobada en oficina",
        status: "REQUESTED",
        lines: { create: payload.lines.map((l) => ({ itemId: l.itemId, pallets: Math.ceil(l.units / l.unitsPerPallet), units: l.units })) },
      },
    });
    await tx.draft.update({
      where: { id },
      data: {
        payload: json({ ...payload, outboundId: created.id, outboundNumber: created.number }),
        reply: draft.message ? orderReply(payload, draft.message.fromName) : draft.reply,
      },
    });
    return created;
  }, longTransaction);
  if (!outbound) return;
  revalidatePath("/office", "layout");
}

export async function discardDraft(formData: FormData) {
  await requireOffice();
  const id = String(formData.get("draftId") ?? "");
  await db.draft.updateMany({ where: { id, status: "PENDING" }, data: { status: "DISCARDED" } });
  revalidatePath("/office", "layout");
}

/** Demo helper: put the morning's messages back in the inbox, forget the drafts and what the portal and the floor sent meanwhile, to replay the morning. */
export async function resetInbox() {
  await requireOffice();
  const created = await db.draft.findMany({ where: { status: "APPROVED", kind: "CREATE_OUTBOUND" } });
  const outboundIds = created
    .map((d) => (d.payload as { outboundId?: string }).outboundId)
    .filter((x): x is string => Boolean(x));
  await db.$transaction(async (tx) => {
    // Pallets already picked for those outbounds go back to the racks (and a split row joins its loose pallet again)
    // before the outbounds are deleted, so nothing stays in a dispatch lane without an owner.
    const lane = await tx.stock.findMany({ where: { outboundId: { in: outboundIds } } });
    if (lane.length) {
      const warehouses = await tx.warehouse.findMany({ where: { id: { in: [...new Set(lane.map((r) => r.warehouseId))] } } });
      const here = await tx.stock.findMany({ where: { warehouseId: { in: warehouses.map((w) => w.id) } } });
      const items = await tx.item.findMany({ where: { id: { in: [...new Set(lane.map((r) => r.itemId))] } }, select: { id: true, unitsPerPallet: true } });
      const layouts = new Map(warehouses.map((w) => [w.id, makeLayout(w)]));
      const plan = planRestore(lane, here, new Map(items.map((i) => [i.id, i.unitsPerPallet])), (row, taken) =>
        suggestSlot(layouts.get(row.warehouseId)!, taken, here.filter((s) => s.warehouseId === row.warehouseId && s.clientId === row.clientId).map((s) => s.location)),
      );
      for (const m of plan.merges) {
        await tx.stock.update({ where: { id: m.intoId }, data: { units: { increment: m.units } } });
        await tx.stock.delete({ where: { id: m.fromId } });
      }
      for (const m of plan.moves) await tx.stock.update({ where: { id: m.id }, data: { outboundId: null, location: m.location, splitFrom: null } });
      // A piece taken off a mixed pallet goes back onto it, under its ID; then every pallet that changed is re-shared.
      for (const j of plan.joins ?? []) await tx.stock.update({ where: { id: j.id }, data: { outboundId: null, location: j.location, palletCode: j.palletCode, splitFrom: null } });
      for (const u of plan.shares ?? []) await tx.stock.update({ where: { id: u.id }, data: { pallets: u.pallets, palletShare: u.palletShare } });
    }
    await tx.outbound.deleteMany({ where: { id: { in: outboundIds } } });
    await tx.draft.deleteMany();
    // What customers asked in the portal and the voice notes recorded on the floor during the demo are not part of the morning
    // (the seed has no floor notes).
    await tx.message.deleteMany({ where: { OR: [{ channel: "PORTAL", fromAddress: PORTAL_LIVE_ADDRESS }, { channel: "FLOOR" }] } });
    await tx.message.updateMany({ data: { status: "NEW" } });
  }, longTransaction);
  revalidatePath("/office", "layout");
}
