"use server";

import { revalidatePath } from "next/cache";
import { period } from "@/lib/billing/calendar";
import { prepareClients, todayDay, type PrepareOutcome } from "@/lib/billing/load";
import { db } from "@/lib/db";
import { assertRole } from "@/lib/session";

/** Drafts for the pre-invoices of one month ("2026-10"). Nothing here is a legal invoice: always a draft for a person to approve. */
export async function prepareMonth(month: string): Promise<PrepareOutcome> {
  await assertRole("office");
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) throw new Error("Month must look like 2026-10.");
  let p;
  try {
    p = period(month);
  } catch {
    throw new Error("Month must look like 2026-10.");
  }
  if (p.start > todayDay()) throw new Error("That month has not started.");
  const { prepared, skipped } = await prepareClients(p);
  revalidatePath("/office/billing");
  return { prepared, skipped };
}

/** DRAFT to APPROVED, once. Approving again changes nothing (and keeps who approved first). */
export async function approvePreInvoice(id: string): Promise<void> {
  const session = await assertRole("office");
  if (typeof id !== "string" || !id) throw new Error("Pre-invoice not found.");
  const found = await db.preInvoice.findUnique({ where: { id }, select: { status: true, detail: true } });
  if (!found) throw new Error("Pre-invoice not found.");
  if (found.status === "APPROVED") return;
  const checks = (found.detail as { checks?: { detailMatches?: boolean } } | null)?.checks;
  if (!checks?.detailMatches) throw new Error("The detail does not add up to the summary.");
  await db.preInvoice.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: session.username } });
  revalidatePath("/office/billing");
  revalidatePath(`/office/billing/${id}`);
}
