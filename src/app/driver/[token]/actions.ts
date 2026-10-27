"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { checkIn, recordNote, signReceipt, typeNote } from "@/lib/ops/floor";
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
  const result = await recordNote(inbound.id, media);
  refresh(token);
  return { read: result.read };
}

export async function sendPallets(token: string, pallets: number) {
  const inbound = await inboundOf(token);
  if (!Number.isInteger(pallets) || pallets < 1 || pallets > 66) throw new Error("Type the number of pallets.");
  await typeNote(inbound.id, pallets, null, "driver");
  refresh(token);
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
