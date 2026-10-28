"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@prisma/client";
import { runClerk } from "@/lib/agent";
import { orderReply } from "@/lib/agent/rules";
import type { Doubt, DraftSeed, OutboundPayload, Step } from "@/lib/agent/types";
import { db } from "@/lib/db";
import { madridDayRange } from "@/lib/format";
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
    await db.draft.update({ where: { id }, data: { status: "APPROVED" } });
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
      const line = payload.lines.find((l) => `pallets:${l.sku}` === doubt.field);
      if (line) line.pallets = Number(value);
    }
  }

  const deliverBy = payload.deliverBy ? new Date(payload.deliverBy) : null;
  const outbound = await db.outbound.create({
    data: {
      date: madridDayRange(deliverBy ?? new Date()).start,
      deadline: deliverBy,
      clientId: payload.clientId,
      clientDocRef: payload.clientDocRef,
      consigneeId: payload.consigneeId,
      notes: "Alta DockClerk · aprobada en oficina",
      status: "REQUESTED",
      lines: { create: payload.lines.map((l) => ({ itemId: l.itemId, pallets: l.pallets, units: l.pallets * l.unitsPerPallet })) },
    },
  });

  await db.draft.update({
    where: { id },
    data: {
      status: "APPROVED",
      payload: json({ ...payload, outboundId: outbound.id, outboundNumber: outbound.number }),
      reply: draft.message ? orderReply(payload, draft.message.fromName) : draft.reply,
    },
  });
  revalidatePath("/office", "layout");
}

export async function discardDraft(formData: FormData) {
  await requireOffice();
  const id = String(formData.get("draftId") ?? "");
  await db.draft.updateMany({ where: { id, status: "PENDING" }, data: { status: "DISCARDED" } });
  revalidatePath("/office", "layout");
}

/** Demo helper: put every message back in the inbox and forget the drafts, to replay the morning. */
export async function resetInbox() {
  await requireOffice();
  const created = await db.draft.findMany({ where: { status: "APPROVED", kind: "CREATE_OUTBOUND" } });
  const outboundIds = created
    .map((d) => (d.payload as { outboundId?: string }).outboundId)
    .filter((x): x is string => Boolean(x));
  await db.$transaction([
    db.outbound.deleteMany({ where: { id: { in: outboundIds } } }),
    db.draft.deleteMany(),
    db.message.updateMany({ data: { status: "NEW" } }),
  ]);
  revalidatePath("/office", "layout");
}
