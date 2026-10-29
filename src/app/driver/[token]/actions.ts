"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { checkIn, recordNote, signReceipt, typeNote } from "@/lib/ops/floor";
import { consume } from "@/lib/rate-limit";
import { parseDataUrl } from "@/lib/uploads";

// The driver has no account: the secret token in the link is the only key, and it only opens one delivery.
async function inboundOf(token: string) {
  const inbound = await db.inbound.findUnique({ where: { driverToken: token } });
  if (!inbound) throw new Error("This link is not valid any more.");
  return inbound;
}

const refresh = (token: string) => {
  revalidatePath(`/driver/${token}`);
  revalidatePath("/office", "layout");
  revalidatePath("/operator", "layout");
};

export async function sendNotePhoto(token: string, photo: string) {
  const inbound = await inboundOf(token);
  const media = parseDataUrl(photo);
  if (!media) throw new Error("That photo could not be read.");
  // Reading a photo costs model credits and this link has no login: ten readings an hour per delivery.
  // Past that the photo is kept and the driver types the pallets, as when no model is available.
  const read = await consume(`driver-note:${inbound.id}`, 10, 60 * 60 * 1000);
  const result = await recordNote(inbound.id, media, { read });
  refresh(token);
  return { read: result.read };
}

export async function sendPallets(token: string, pallets: number) {
  const inbound = await inboundOf(token);
  // Returned, not thrown: in production Next hides the message of a thrown error.
  if (!Number.isInteger(pallets) || pallets < 1 || pallets > 66) return { error: "Type the number of pallets (1 to 66)." };
  await typeNote(inbound.id, pallets, null, "driver");
  refresh(token);
  return {};
}

export async function arrive(token: string) {
  const inbound = await inboundOf(token);
  await checkIn(inbound.id);
  refresh(token);
}

export async function sign(token: string, signature: string, name: string) {
  const inbound = await inboundOf(token);
  const media = parseDataUrl(signature);
  if (!media || !name.trim()) throw new Error("Sign and write your name.");
  if (inbound.status !== "RECEIVED" && inbound.status !== "CLOSED") throw new Error("The unloading is not finished yet.");
  await signReceipt(inbound.id, media, name.trim().slice(0, 80));
  refresh(token);
}
