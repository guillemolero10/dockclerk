"use server";

import { revalidatePath } from "next/cache";
import { period } from "@/lib/billing/calendar";
import { prepareClients, todayDay, type PrepareOutcome } from "@/lib/billing/load";
import { db } from "@/lib/db";
import { getT } from "@/lib/i18n/server";
import { assertRole } from "@/lib/session";

/** Drafts for the pre-invoices of one month ("2026-10"). Nothing here is a legal invoice: always a draft for a person to approve. */
export async function prepareMonth(month: string): Promise<PrepareOutcome> {
  await assertRole("office");
  const { t } = await getT();
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) throw new Error(t("bx.err.month"));
  let p;
  try {
    p = period(month);
  } catch {
    throw new Error(t("bx.err.month"));
  }
  if (p.start > todayDay()) throw new Error(t("bx.err.notStarted"));
  const { prepared, skipped } = await prepareClients(p);
  revalidatePath("/office/billing");
  return { prepared, skipped };
}

/** DRAFT to APPROVED, once. Approving again changes nothing (and keeps who approved first). */
export async function approvePreInvoice(id: string): Promise<void> {
  const session = await assertRole("office");
  const { t } = await getT();
  if (typeof id !== "string" || !id) throw new Error(t("bx.err.notFound"));
  const found = await db.preInvoice.findUnique({ where: { id }, select: { status: true, detail: true } });
  if (!found) throw new Error(t("bx.err.notFound"));
  if (found.status === "APPROVED") return;
  const checks = (found.detail as { checks?: { detailMatches?: boolean } } | null)?.checks;
  if (!checks?.detailMatches) throw new Error(t("bx.err.noAdd"));
  await db.preInvoice.updateMany({ where: { id, status: "DRAFT" }, data: { status: "APPROVED", approvedAt: new Date(), approvedBy: session.username } });
  revalidatePath("/office/billing");
  revalidatePath(`/office/billing/${id}`);
}

/**
 * How loose pallets (picos) are charged for one customer, from now on: FRACTION or FULL.
 * Pre-invoices already approved keep the rule they were made with; drafts take the new one the next time they are prepared.
 */
export async function setPartialPallets(clientId: string, mode: string): Promise<void> {
  await assertRole("office");
  const { t } = await getT();
  if (mode !== "FRACTION" && mode !== "FULL") throw new Error(t("bx.err.rule"));
  if (typeof clientId !== "string" || !clientId) throw new Error(t("bx.err.client"));
  const { count } = await db.tariff.updateMany({ where: { clientId }, data: { partialPallets: mode } });
  if (count === 0) throw new Error(t("bx.err.tariff"));
  revalidatePath("/office/billing");
  revalidatePath("/office/clients/[code]", "page");
}
