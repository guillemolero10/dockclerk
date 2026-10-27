"use server";

import { revalidatePath } from "next/cache";
import { transcribe } from "@/lib/ai/voice";
import { db } from "@/lib/db";
import { checkIn, confirmReceipt, pickPallet, putAway, recordLoad, recordNote, suggestPutAway, typeNote, type ReceivedLine } from "@/lib/ops/floor";
import { getSession } from "@/lib/session";
import { parseDataUrl, saveUpload } from "@/lib/uploads";

async function requireFloor() {
  const session = await getSession();
  if (session?.role !== "operator") throw new Error("Only the warehouse floor can do this.");
}

const refresh = () => {
  revalidatePath("/operator", "layout");
  revalidatePath("/office", "layout");
};

export async function truckHere(inboundId: string) {
  await requireFloor();
  await checkIn(inboundId);
  refresh();
}

export async function notePhoto(inboundId: string, photo: string) {
  await requireFloor();
  const media = parseDataUrl(photo);
  if (!media) throw new Error("That photo could not be read.");
  const result = await recordNote(inboundId, media);
  refresh();
  return { read: result.read };
}

export async function notePallets(inboundId: string, pallets: number, sku: string | null) {
  await requireFloor();
  await typeNote(inboundId, pallets, sku, "operator");
  refresh();
}

export async function loadPhoto(inboundId: string, photo: string) {
  await requireFloor();
  const media = parseDataUrl(photo);
  if (!media) throw new Error("That photo could not be read.");
  const count = await recordLoad(inboundId, media);
  refresh();
  return count ? { boxes: count.boxes.length, damaged: count.boxes.filter((b) => b.damaged).length, pallets: count.pallets, by: count.by } : null;
}

export async function receive(inboundId: string, lines: ReceivedLine[], damaged: number, incident: string) {
  await requireFloor();
  const clean = lines.filter((l) => l.itemId && l.pallets > 0);
  if (!clean.length) throw new Error("Add at least one line with pallets.");
  const items = await db.item.findMany({ where: { id: { in: clean.map((l) => l.itemId) } } });
  const withUnits = clean.map((l) => ({ ...l, lot: l.lot?.trim() || null, unitsPerPallet: items.find((i) => i.id === l.itemId)!.unitsPerPallet }));
  const receipt = await db.dockReceipt.findUnique({ where: { inboundId } });
  const found = (receipt?.damages as { box: number; note: string }[] | null) ?? [];
  const damages = found.length >= damaged ? found.slice(0, damaged) : [...found, ...Array.from({ length: damaged - found.length }, (_, i) => ({ box: found.length + i + 1, note: "Damaged (operator)" }))];
  await confirmReceipt(inboundId, withUnits, damages, incident.trim() || null);
  refresh();
}

export async function suggestSlotFor(stockId: string) {
  await requireFloor();
  return suggestPutAway(stockId);
}

export async function putAwayPallet(stockId: string, location: string) {
  await requireFloor();
  await putAway(stockId, location.trim().toUpperCase());
  refresh();
}

/** Puts every waiting pallet of a lane where the clerk suggests, one after the other. */
export async function putAwayAll(warehouseCode: string) {
  await requireFloor();
  const waiting = await db.stock.findMany({
    where: { warehouse: { code: warehouseCode }, location: { startsWith: "REC-" } },
    orderBy: [{ location: "asc" }, { id: "asc" }],
  });
  for (const pallet of waiting) {
    const slot = await suggestPutAway(pallet.id);
    if (!slot) break;
    await putAway(pallet.id, slot);
  }
  refresh();
  return waiting.length;
}

export async function pick(outboundId: string, stockId: string) {
  await requireFloor();
  const result = await pickPallet(outboundId, stockId);
  refresh();
  return result;
}

/** A voice note from the floor goes to the AI inbox like any other message. */
export async function voiceNote(warehouseCode: string, audio: string) {
  await requireFloor();
  const media = parseDataUrl(audio);
  if (!media) throw new Error("That recording could not be read.");
  const url = await saveUpload("voice", media);
  const text = await transcribe(media);
  await db.message.create({
    data: {
      channel: "FLOOR",
      fromName: `Operator · ${warehouseCode}`,
      body: text ?? "Voice note (transcription needs the Meta key).",
      audioUrl: url,
    },
  });
  refresh();
  return { transcribed: !!text };
}
