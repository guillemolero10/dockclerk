// bill_so_far and explain_charge: read the month's bill for ONE customer and hand it to the clerk.
// The customer id is given by the caller (the message sender or the portal session), never by the model.
// The figures are computed by src/lib/billing (or read from the saved pre-invoice): nothing is calculated here.
import { db } from "@/lib/db";
import { dateOfDay, ymdOf } from "@/lib/billing/calendar";
import { loadBilling } from "@/lib/billing/load";
import { eurosEs, resolveWindow, shapeBill, shapeExplain, type BillIn, type BillStatus, type DetailIn, type Window } from "./bill-format";

type Found = { code: string; w: Window; bill: BillIn; detail: DetailIn[]; log: string[] };
type Failed = { error: string; log: string[] };

const isRows = (value: unknown): value is DetailIn[] => Array.isArray(value);

/** The saved pre-invoice of that whole month if there is one; otherwise computed now from the records. */
async function getBill(clientId: string, month: unknown): Promise<Found | Failed> {
  if (!clientId) return { error: "this message is not from a known customer: a person must handle billing questions", log: [] };
  const w = resolveWindow(month, ymdOf(new Date()));
  if ("error" in w) return { error: w.error, log: [] };
  const { p } = w;

  if (!w.toDate) {
    const saved = await db.preInvoice.findUnique({
      where: { clientId_from_to: { clientId, from: dateOfDay(p.start), to: dateOfDay(p.end - 1) } },
      include: { client: { select: { code: true } } },
    });
    const detail = (saved?.detail as { rows?: unknown } | null)?.rows;
    if (saved && Array.isArray(saved.lines) && isRows(detail)) {
      const status: BillStatus = saved.status === "APPROVED" ? "approved" : "draft";
      const bill: BillIn = {
        p, toDate: false, status, rule: saved.partialPallets,
        lines: saved.lines as unknown as BillIn["lines"],
        baseCents: saved.baseCents, vatPct: saved.vatPct, vatCents: saved.vatCents, totalCents: saved.totalCents,
      };
      return { code: saved.client.code, w, bill, detail, log: [`pre_invoice(${saved.client.code}, ${p.first}..${p.last}) → ${eurosEs(saved.totalCents)} (${status})`] };
    }
  }

  const live = await loadBilling(clientId, p);
  if (!live.hasTariff) return { error: "this customer has no tariff in the software: a person must check", log: live.steps };
  if (!live.result.checks.detailMatches) return { error: "the detail does not add up to the summary: a person must check", log: live.steps };
  const r = live.result;
  const bill: BillIn = { p, toDate: w.toDate, status: "not prepared", rule: r.rule, lines: r.lines, baseCents: r.baseCents, vatPct: r.vatPct, vatCents: r.vatCents, totalCents: r.totalCents };
  return { code: live.clientCode, w, bill, detail: r.detail as unknown as DetailIn[], log: live.steps };
}

export type ToolOut = { data: Record<string, unknown>; log: string[]; failed: boolean };

/** bill_so_far {"month"?: "2026-10"} */
export async function billSoFar(clientId: string, month?: unknown): Promise<ToolOut> {
  const found = await getBill(clientId, month);
  if ("error" in found) return { data: { error: found.error }, log: [...found.log, `bill_so_far → ${found.error}`], failed: true };
  const data = shapeBill(found.bill);
  return { data, log: [...found.log, `bill_so_far(${found.code}, ${found.bill.p.first}..${found.bill.p.last}) → ${eurosEs(found.bill.totalCents)} (${found.bill.status})`], failed: false };
}

/** explain_charge {"month"?, "inbound": 1043} or {"month"?, "lot": "L-2310"} */
export async function explainCharge(clientId: string, args: { month?: unknown; inbound?: unknown; lot?: unknown }): Promise<ToolOut> {
  const inbound = args.inbound === undefined || args.inbound === null || args.inbound === "" ? undefined : Number(args.inbound);
  const lot = typeof args.lot === "string" && args.lot.trim() ? args.lot.trim() : undefined;
  if ((inbound === undefined || !Number.isInteger(inbound)) && !lot) {
    return { data: { error: 'give an "inbound" number or a "lot"' }, log: ["explain_charge → needs an inbound number or a lot"], failed: true };
  }
  const found = await getBill(clientId, args.month);
  if ("error" in found) return { data: { error: found.error }, log: [...found.log, `explain_charge → ${found.error}`], failed: true };
  const what = inbound !== undefined && Number.isInteger(inbound) ? `inbound ${inbound}` : `lot ${lot}`;
  const data = shapeExplain(found.detail, found.bill.p, { inbound: Number.isInteger(inbound) ? inbound : undefined, lot }, found.bill.status);
  const failed = "error" in data;
  return { data, log: [...found.log, `explain_charge(${found.code}, ${what}) → ${failed ? "nothing found" : `${(data as { rows: unknown[] }).rows.length} storage rows`}`], failed };
}
