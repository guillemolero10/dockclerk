import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Archive, Lock } from "lucide-react";
import { ApproveButton } from "@/components/billing/approve-button";
import { PrintButton } from "@/components/print-button";
import { dayOfYmd } from "@/lib/billing/calendar";
import type { DetailRow } from "@/lib/billing/compute";
import { ddmm, dmy, eur, groupMovements, num, periodText, readDetail, readLines, RULE_HELP, RULE_LABEL, splitText } from "@/lib/billing/view";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

export default async function PreInvoicePage({ params }: PageProps<"/office/billing/[id]">) {
  await requireRole("office");
  const { id } = await params;
  const inv = await db.preInvoice.findUnique({ where: { id }, include: { client: { select: { code: true, name: true } } } });
  if (!inv) notFound();

  const first = ymd(inv.from);
  const last = ymd(inv.to);
  const days = dayOfYmd(last) - dayOfYmd(first) + 1;
  const lines = readLines(inv.lines);
  const { rows, checks } = readDetail(inv.detail);
  const groups = groupMovements(rows);
  const approved = inv.status === "APPROVED";
  // A pre-invoice whose detail does not add up to its summary must never be approved.
  const broken = !checks || !checks.detailMatches;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8 print:max-w-none print:p-0">
      <Link href={`/office/billing?month=${first.slice(0, 7)}`} className="cond flex items-center gap-1 text-xs text-dock-ink/50 hover:text-dock-ink print:hidden">
        <ArrowLeft size={13} /> Billing
      </Link>

      <p className="cond mt-3 border-[1.5px] border-dock-ink bg-dock-yellow px-3 py-1.5 text-center text-sm font-bold tracking-wide print:border-dock-ink">
        Pre-invoice: not an invoice
      </p>

      {broken && (
        <div role="alert" className="mt-3 flex items-start gap-2 bg-dock-red px-4 py-3 text-sm font-medium text-white">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>
            The detail does not add up to the summary
            {checks ? ` (pallet·days ${num(checks.palletDaysSummary)} vs ${num(checks.palletDaysDetail)}; cents ${checks.centsSummary} vs ${checks.centsDetail})` : " (no check was saved)"}. It cannot be approved. Prepare the month again.
          </span>
        </div>
      )}

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mono text-xs text-dock-ink/50">
            {inv.client.code} · pre-invoice Nº {inv.number}
          </p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">{inv.client.name}</h1>
          <p className="mt-1 text-[15px] font-medium">
            {periodText(first, last)} <span className="text-dock-ink/55">· {days} days, last day included</span>
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {approved ? (
            <span className="cond flex items-center gap-1.5 bg-dock-ink px-3 py-1.5 text-sm text-dock-yellow">
              <Lock size={14} /> Approved
            </span>
          ) : (
            <span className="cond border-[1.5px] border-dock-ink bg-white px-3 py-1.5 text-sm">Draft</span>
          )}
          {approved && inv.approvedAt && (
            <span className="text-xs text-dock-ink/55">
              {when(inv.approvedAt)}
              {inv.approvedBy ? ` · ${inv.approvedBy}` : ""}
            </span>
          )}
        </div>
      </header>

      <p className="mt-3 border-l-4 border-dock-ink bg-white px-3 py-2 text-sm">
        <span className="cond text-xs font-semibold">Loose pallets: {RULE_LABEL[inv.partialPallets]}</span>
        <span className="block text-dock-ink/65">{RULE_HELP[inv.partialPallets]}</span>
      </p>

      <section className="dock-card mt-5 bg-white">
        {/* Phone: one block per line (concept, amount, then quantity × price), so nothing needs sliding. */}
        <div className="sm:hidden print:hidden">
          <ul className="divide-y divide-dock-line">
            {lines.map((l, i) => (
              <li key={i} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-medium">{l.label}</span>
                  <span className="mono shrink-0">{eur(l.cents)}</span>
                </div>
                <p className="mono mt-0.5 text-xs text-dock-ink/60">
                  {num(l.quantity)} {l.unit} × {num(l.price)} €
                </p>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t-[1.5px] border-dock-ink px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="cond text-xs text-dock-ink/60">Base</dt>
              <dd className="mono">{eur(inv.baseCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="cond text-xs text-dock-ink/60">VAT {num(inv.vatPct)} %</dt>
              <dd className="mono">{eur(inv.vatCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <dt className="cond text-sm font-semibold">Total</dt>
              <dd className="mono text-lg font-semibold">{eur(inv.totalCents)}</dd>
            </div>
          </dl>
        </div>
        <div className="hidden overflow-x-auto sm:block print:block">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="cond border-b-[1.5px] border-dock-ink text-left text-[11px] text-dock-ink/55">
                <th className="px-4 py-2">Concept</th>
                <th className="px-2 py-2 text-right">Quantity</th>
                <th className="px-2 py-2 text-right">Price</th>
                <th className="px-4 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dock-line">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5 font-medium">{l.label}</td>
                  <td className="mono px-2 py-2.5 text-right">
                    {num(l.quantity)} <span className="text-xs text-dock-ink/50">{l.unit}</span>
                  </td>
                  <td className="mono px-2 py-2.5 text-right">{num(l.price)} €</td>
                  <td className="mono px-4 py-2.5 text-right">{eur(l.cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-[1.5px] border-dock-ink">
              <tr>
                <td colSpan={3} className="cond px-4 pt-2 text-right text-xs text-dock-ink/60">Base</td>
                <td className="mono px-4 pt-2 text-right">{eur(inv.baseCents)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="cond px-4 text-right text-xs text-dock-ink/60">VAT {num(inv.vatPct)} %</td>
                <td className="mono px-4 text-right">{eur(inv.vatCents)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="cond px-4 pb-3 pt-1 text-right text-sm font-semibold">Total</td>
                <td className="mono px-4 pb-3 pt-1 text-right text-lg font-semibold">{eur(inv.totalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="cond text-sm text-dock-ink/60">Warehouse movements</h2>
        <p className="mb-3 text-xs text-dock-ink/55">The proof behind the lines above: every pallet, grouped by the delivery note it came in on.</p>
        {groups.length === 0 ? (
          <p className="dock-card bg-white p-5 text-sm text-dock-ink/60">There is no movement detail saved for this pre-invoice.</p>
        ) : (
          <ul className="space-y-4">
            {groups.map((g) => (
              <li key={g.key} className={`dock-card overflow-hidden bg-white ${g.split ? "ring-[3px] ring-dock-yellow" : ""} print:break-inside-avoid`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b-[1.5px] border-dock-ink bg-dock-concrete-2 px-4 py-2">
                  <span className="cond text-xs font-semibold">Nº {g.inboundNumber ?? "—"}</span>
                  <span className="mono text-sm font-semibold">{g.sku}</span>
                  {g.lot && <span className="mono text-xs text-dock-ink/55">lot {g.lot}</span>}
                  <span className="text-xs text-dock-ink/55">
                    entered {dmy(g.inDate)}
                    {g.docRef ? ` · ${g.docRef}` : ""}
                  </span>
                  <span className="mono ml-auto text-xs font-semibold">{eur(g.cents)}</span>
                </div>
                {g.split && (
                  <p className="bg-dock-yellow px-4 py-2 text-[15px] font-bold leading-snug">{splitText(g.split)}</p>
                )}
                <ul className="divide-y divide-dock-line sm:hidden print:hidden">
                  {g.rows.map((r, i) => (
                    <MovementCard key={i} row={r} periodLast={last} />
                  ))}
                </ul>
                <div className="hidden overflow-x-auto sm:block print:block">
                  <table className="w-full min-w-[520px] text-sm">
                    <tbody className="divide-y divide-dock-line">
                      {g.rows.map((r, i) => (
                        <MovementRow key={i} row={r} periodLast={last} />
                      ))}
                    </tbody>
                  </table>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {checks && (
        <p className="mono mt-4 text-[11px] text-dock-ink/50">
          Check · detail {num(checks.palletDaysDetail)} pallet·days = summary {num(checks.palletDaysSummary)} · {eur(checks.centsDetail)} = {eur(checks.centsSummary)}
        </p>
      )}
      {checks && checks.warnings.length > 0 && (
        <ul className="mt-2 space-y-1">
          {checks.warnings.map((w, i) => (
            <li key={i} className="bg-dock-yellow/70 px-3 py-1.5 text-xs">{w}</li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <PrintButton />
        {approved ? (
          <span className="cond flex items-center gap-1.5 text-sm text-dock-ink/60">
            <Lock size={14} /> Approved: this pre-invoice no longer changes
          </span>
        ) : (
          <ApproveButton id={inv.id} disabled={broken} reason="The detail does not add up to the summary." />
        )}
      </div>
    </main>
  );
}

function describeRow(r: DetailRow, periodLast: string) {
  const leaving = r.exitDate !== null;
  const gone = leaving && r.exitDate! <= periodLast;
  const exitText = r.exitDate === null ? "no exit" : `${gone ? "left" : "leaves"} ${ddmm(r.exitDate)}`;
  const Icon = r.concept === "in" ? ArrowDownToLine : r.concept === "out" ? ArrowUpFromLine : Archive;
  const kind = r.concept === "in" ? "Entry" : r.concept === "out" ? "Exit" : "Storage";
  return { leaving, exitText, Icon, kind };
}

/** The same movement as MovementRow, stacked for a phone: kind and amount on top, the pallets below, exit and price last. */
function MovementCard({ row: r, periodLast }: { row: DetailRow; periodLast: string }) {
  const { leaving, exitText, Icon, kind } = describeRow(r, periodLast);
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="cond flex items-center gap-1.5 text-xs text-dock-ink/60">
          <Icon size={13} aria-hidden /> {kind}
        </span>
        <span className="mono shrink-0">{eur(r.cents)}</span>
      </div>
      <p className="mt-0.5">
        <span className="mono text-[15px] font-semibold">{num(r.pallets)}</span> <span className="text-xs text-dock-ink/55">pallets</span>
        {r.concept === "storage" && (
          <span className="mono text-xs text-dock-ink/65">
            {" "}× {r.days} days = <b>{num(r.palletDays ?? 0)}</b> pallet·days
          </span>
        )}
        {r.concept === "out" && (
          <span className="mono text-xs text-dock-ink/65">
            {" "}on {r.exitDate ? ddmm(r.exitDate) : ""}
            {r.outboundNumber ? ` · Nº ${r.outboundNumber}` : ""}
          </span>
        )}
      </p>
      {r.note && <p className="text-[11px] text-dock-ink/50">{r.note}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {r.concept === "storage" && (
          <span className={`cond whitespace-nowrap px-2 py-0.5 text-xs font-semibold ${leaving ? "bg-dock-ink text-dock-yellow" : "border-[1.5px] border-dock-ink"}`}>{exitText}</span>
        )}
        <span className="mono text-xs text-dock-ink/55">at {num(r.price)} €</span>
      </p>
    </li>
  );
}

function MovementRow({ row: r, periodLast }: { row: DetailRow; periodLast: string }) {
  const { leaving, exitText, Icon, kind } = describeRow(r, periodLast);
  return (
    <tr className="align-baseline">
      <td className="w-28 whitespace-nowrap px-4 py-2">
        <span className="cond flex items-center gap-1.5 text-xs text-dock-ink/60">
          <Icon size={13} /> {kind}
        </span>
      </td>
      <td className="px-2 py-2">
        <span className="mono text-[15px] font-semibold">{num(r.pallets)}</span> <span className="text-xs text-dock-ink/55">pallets</span>
        {r.concept === "storage" && (
          <span className="mono text-xs text-dock-ink/65">
            {" "}× {r.days} days = <b>{num(r.palletDays ?? 0)}</b> pallet·days
          </span>
        )}
        {r.concept === "out" && (
          <span className="mono text-xs text-dock-ink/65">
            {" "}on {r.exitDate ? ddmm(r.exitDate) : ""}
            {r.outboundNumber ? ` · Nº ${r.outboundNumber}` : ""}
          </span>
        )}
        {r.note && <span className="block text-[11px] text-dock-ink/50">{r.note}</span>}
      </td>
      <td className="px-2 py-2">
        {r.concept === "storage" && (
          <span className={`cond whitespace-nowrap px-2 py-0.5 text-xs font-semibold ${leaving ? "bg-dock-ink text-dock-yellow" : "border-[1.5px] border-dock-ink"}`}>{exitText}</span>
        )}
      </td>
      <td className="mono whitespace-nowrap px-2 py-2 text-right text-xs text-dock-ink/55">{num(r.price)} €</td>
      <td className="mono whitespace-nowrap px-4 py-2 text-right">{eur(r.cents)}</td>
    </tr>
  );
}
