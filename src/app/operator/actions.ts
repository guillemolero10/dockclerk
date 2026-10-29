"use server";

import { revalidatePath } from "next/cache";
import { transcribe } from "@/lib/ai/voice";
import { db } from "@/lib/db";
import { Fixable, orFixable } from "@/lib/fixable";
import { checkIn, confirmReceipt, pickPallet, putAway, recordLoad, recordNote, suggestPutAway, typeNote, type ReceivedLine } from "@/lib/ops/floor";
import { assertRole } from "@/lib/session";
import { parseDataUrl, saveUpload } from "@/lib/uploads";

// Every exported function below is reachable by anybody who can POST to the site: check the role in each one.
const requireFloor = () => assertRole("operator");

/** A count typed on the PDA, checked here whatever the browser sends: a whole number, never negative or 2,5 pallets. */
function wholeCount(n: unknown, min: number, max: number, what: string) {
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) throw new Fixable(`Type the number of ${what} (${min} to ${max}).`);
  return n;
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
  return orFixable(async () => {
    await typeNote(inboundId, wholeCount(pallets, 1, 66, "pallets"), sku, "operator");
    refresh();
  });
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
  return orFixable(() => receiveChecked(inboundId, lines, damaged, incident));
}

async function receiveChecked(inboundId: string, lines: ReceivedLine[], damaged: number, incident: string) {
  // A line left at 0 is an empty line; anything else must be a whole number of pallets.
  const clean = lines.filter((l) => l.itemId && l.pallets !== 0);
  for (const l of clean) wholeCount(l.pallets, 1, 66, "pallets");
  if (!clean.length) throw new Fixable("Add at least one line with pallets.");
  wholeCount(damaged, 0, 500, "damaged boxes");
  // Only this customer's items: the stock is booked to the customer of the delivery.
  const inbound = await db.inbound.findUniqueOrThrow({ where: { id: inboundId }, select: { clientId: true } });
  const items = await db.item.findMany({ where: { id: { in: clean.map((l) => l.itemId) }, clientId: inbound.clientId } });
  if (clean.some((l) => !items.some((i) => i.id === l.itemId))) throw new Fixable("That item is not one of this customer's. Reload and pick it again.");
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

export async function pick(outboundId: string, stockId: string, units?: number) {
  await requireFloor();
  const result = await pickPallet(outboundId, stockId, units);
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
