import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { PartialRule } from "@/components/billing/partial-rule";
import { PrepareBox } from "@/components/billing/prepare-box";
import { dateOfDay, period } from "@/lib/billing/calendar";
import { eur, monthLabel, num, pickMonth, readLines, readSteps, RULE_HELP, RULE_LABEL, shiftMonth, summarize } from "@/lib/billing/view";
import { db } from "@/lib/db";
import { madridYmd } from "@/lib/format";
import { requireRole } from "@/lib/session";
import { clientColor } from "@/lib/warehouse/palette";

export const dynamic = "force-dynamic";
// The server actions of this page (prepare / pick) run under this limit; a transaction may take up to 20 s.
export const maxDuration = 60;

export default async function BillingPage({ searchParams }: PageProps<"/office/billing">) {
  await requireRole("office");
  const { month: asked } = await searchParams;
  const today = madridYmd();
  const month = pickMonth(typeof asked === "string" ? asked : undefined, today);
  const p = period(month);
  const label = monthLabel(month);
  const isCurrent = month === today.slice(0, 7);

  const [clients, invoices] = await Promise.all([
    db.client.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, tariff: { select: { partialPallets: true } } } }),
    db.preInvoice.findMany({
      where: { from: dateOfDay(p.start), to: dateOfDay(p.end - 1) },
      select: { id: true, number: true, clientId: true, status: true, partialPallets: true, lines: true, baseCents: true, totalCents: true, steps: true, approvedAt: true },
    }),
  ]);
  const byClient = new Map(invoices.map((i) => [i.clientId, i]));
  const steps = clients.flatMap((c) => readSteps(byClient.get(c.id)?.steps));
  const totalCents = invoices.reduce((a, i) => a + i.totalCents, 0);
  const approved = invoices.filter((i) => i.status === "APPROVED").length;
  const next = shiftMonth(month, 1);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="cond text-sm text-dock-ink/50">Month end · one pre-invoice per customer, drafted from the warehouse records</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Billing</h1>
        </div>
        <nav aria-label="Month" className="dock-card flex items-stretch bg-white">
          <Link href={`/office/billing?month=${shiftMonth(month, -1)}`} aria-label="Previous month" className="grid w-10 place-items-center hover:bg-dock-yellow">
            <ChevronLeft size={18} />
          </Link>
          <span className="cond grid min-w-40 place-items-center border-x-[1.5px] border-dock-ink px-3 py-2 text-sm font-semibold">{label}</span>
          {isCurrent ? (
            <span aria-disabled="true" aria-label="Next month (not started yet)" className="grid w-10 cursor-not-allowed place-items-center text-dock-ink/25">
              <ChevronRight size={18} />
            </span>
          ) : (
            <Link href={`/office/billing?month=${next}`} aria-label="Next month" className="grid w-10 place-items-center hover:bg-dock-yellow">
              <ChevronRight size={18} />
            </Link>
          )}
        </nav>
      </header>

      {isCurrent && <p className="mt-3 bg-dock-yellow/60 px-3 py-2 text-sm">This month is still running: the pre-invoice covers until the end of the month, goods still inside count as staying.</p>}

      <div className="mt-6">
        <PrepareBox key={month} month={month} label={label} steps={steps} hasApproved={approved > 0} />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="cond text-sm text-dock-ink/60">Pre-invoices · {label}</h2>
          {invoices.length > 0 && (
            <p className="mono text-xs text-dock-ink/60">
              {invoices.length} drafted · {approved} approved · {eur(totalCents)} with VAT
            </p>
          )}
        </div>

        <div className="dock-card overflow-x-auto bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="cond border-b-[1.5px] border-dock-ink text-left text-[11px] text-dock-ink/55">
                <th className="px-4 py-2">Customer</th>
                <th className="px-2 py-2 text-right">Pallets in</th>
                <th className="px-2 py-2 text-right">Pallets out</th>
                <th className="px-2 py-2 text-right">Pallet·days</th>
                <th className="px-2 py-2 text-right">Handling</th>
                <th className="px-2 py-2 text-right">Base</th>
                <th className="px-2 py-2 text-right">Total</th>
                <th className="px-2 py-2">Loose pallets</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dock-line">
              {clients.map((c, idx) => {
                const inv = byClient.get(c.id);
                const color = clientColor(idx);
                const head = (
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <span className="h-6 w-1.5 shrink-0" style={{ background: color }} />
                      <span className="min-w-0">
                        <span className="mono block text-[11px] text-dock-ink/50">{c.code}</span>
                        <span className="block font-semibold leading-tight">{c.name}</span>
                      </span>
                    </span>
                  </td>
                );
                if (!c.tariff) {
                  return (
                    <tr key={c.id} className="bg-dock-yellow">
                      {head}
                      <td colSpan={7} className="px-2 py-2.5">
                        <span className="flex items-center gap-2 font-semibold">
                          <AlertTriangle size={15} /> No tariff
                        </span>
                        <span className="text-xs">There are no prices for this customer, so nothing can be priced.</span>
                      </td>
                      <td className="cond px-4 py-2.5 text-xs">Can&apos;t bill</td>
                    </tr>
                  );
                }
                const rule = c.tariff.partialPallets;
                const sum = inv ? summarize(readLines(inv.lines)) : null;
                const stale = inv && inv.status === "DRAFT" && inv.partialPallets !== rule;
                return (
                  <tr key={c.id} className="align-top">
                    {head}
                    {inv && sum ? (
                      <>
                        <td className="mono px-2 py-2.5 text-right">{num(sum.inPallets)}</td>
                        <td className="mono px-2 py-2.5 text-right">{num(sum.outPallets)}</td>
                        <td className="mono px-2 py-2.5 text-right font-semibold">{num(sum.palletDays)}</td>
                        <td className="mono px-2 py-2.5 text-right">{sum.handling ? num(sum.handling) : "—"}</td>
                        <td className="mono px-2 py-2.5 text-right">{eur(inv.baseCents)}</td>
                        <td className="mono px-2 py-2.5 text-right font-semibold">{eur(inv.totalCents)}</td>
                      </>
                    ) : (
                      <td colSpan={6} className="px-2 py-2.5 text-xs text-dock-ink/45">Not prepared yet, or no movements in this month.</td>
                    )}
                    <td className="px-2 py-2">
                      {inv?.status === "APPROVED" ? (
                        <span className="cond text-xs" title="Frozen with the pre-invoice">{RULE_LABEL[inv.partialPallets]} · frozen</span>
                      ) : (
                        <>
                          <PartialRule clientId={c.id} value={rule} compact />
                          {stale && <span className="mt-1 block text-[11px] text-dock-red">Draft used {RULE_LABEL[inv.partialPallets]}: prepare again</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {inv ? (
                        <Link href={`/office/billing/${inv.id}`} className="cond flex items-center gap-1.5 text-xs underline underline-offset-2 hover:text-dock-ink/70">
                          {inv.status === "APPROVED" ? (
                            <>
                              <Lock size={13} /> Approved
                            </>
                          ) : (
                            "Draft · open"
                          )}
                        </Link>
                      ) : (
                        <span className="cond text-xs text-dock-ink/40">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="dock-card mt-4 bg-white p-4">
          <h3 className="cond text-xs text-dock-ink/55">How loose pallets are charged</h3>
          <dl className="mt-2 grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
            {(["FRACTION", "FULL"] as const).map((m) => (
              <div key={m}>
                <dt className="cond text-xs font-semibold">{RULE_LABEL[m]}</dt>
                <dd className="text-dock-ink/70">{RULE_HELP[m]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 border-t border-dock-line pt-2 text-xs text-dock-ink/60">
            Changing a rule applies to the next <b>Prepare</b>. An approved pre-invoice is frozen: it keeps the rule it was made with.
          </p>
        </div>
      </section>
    </main>
  );
}
