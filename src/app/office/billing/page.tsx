import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Lock } from "lucide-react";
import { PartialRule } from "@/components/billing/partial-rule";
import { PrepareBox } from "@/components/billing/prepare-box";
import { dateOfDay, period } from "@/lib/billing/calendar";
import { eur, monthLabel, num, pickMonth, readLines, readSteps, shiftMonth, summarize } from "@/lib/billing/view";
import { db } from "@/lib/db";
import { madridYmd } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { requireRole } from "@/lib/session";
import { clientColor } from "@/lib/warehouse/palette";

export const dynamic = "force-dynamic";
// The server actions of this page (prepare / pick) run under this limit; a transaction may take up to 20 s.
export const maxDuration = 60;

export default async function BillingPage({ searchParams }: PageProps<"/office/billing">) {
  await requireRole("office");
  const { t, lang } = await getT();
  const { month: asked } = await searchParams;
  const today = madridYmd();
  const month = pickMonth(typeof asked === "string" ? asked : undefined, today);
  const p = period(month);
  const label = monthLabel(month, lang);
  const ruleLabel = (m: "FRACTION" | "FULL") => t(`bi.rule.${m}` as "bi.rule.FULL");
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
          <p className="cond text-sm text-dock-ink/50">{t("bi.kicker")}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t("bi.title")}</h1>
        </div>
        <nav aria-label={t("bi.monthNav")} className="dock-card flex items-stretch bg-white">
          <Link href={`/office/billing?month=${shiftMonth(month, -1)}`} aria-label={t("bi.prevMonth")} className="grid w-10 place-items-center hover:bg-dock-yellow">
            <ChevronLeft size={18} />
          </Link>
          <span className="cond grid min-w-40 place-items-center border-x-[1.5px] border-dock-ink px-3 py-2 text-sm font-semibold">{label}</span>
          {isCurrent ? (
            <span aria-disabled="true" aria-label={t("bi.nextNotYet")} className="grid w-10 cursor-not-allowed place-items-center text-dock-ink/25">
              <ChevronRight size={18} />
            </span>
          ) : (
            <Link href={`/office/billing?month=${next}`} aria-label={t("bi.nextMonth")} className="grid w-10 place-items-center hover:bg-dock-yellow">
              <ChevronRight size={18} />
            </Link>
          )}
        </nav>
      </header>

      {isCurrent && <p className="mt-3 bg-dock-yellow/60 px-3 py-2 text-sm">{t("bi.running")}</p>}

      <div className="mt-6">
        <PrepareBox key={month} month={month} label={label} steps={steps} hasApproved={approved > 0} />
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="cond text-sm text-dock-ink/60">{t("bi.preInvoices", { label })}</h2>
          {invoices.length > 0 && (
            <p className="mono text-xs text-dock-ink/60">
              {t("bi.totals", { n: invoices.length, a: approved, total: eur(totalCents, lang) })}
            </p>
          )}
        </div>

        <div className="dock-card overflow-x-auto bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="cond border-b-[1.5px] border-dock-ink text-left text-[11px] text-dock-ink/55">
                <th className="px-4 py-2">{t("bi.col.customer")}</th>
                <th className="px-2 py-2 text-right">{t("bi.col.in")}</th>
                <th className="px-2 py-2 text-right">{t("bi.col.out")}</th>
                <th className="px-2 py-2 text-right">{t("bi.col.days")}</th>
                <th className="px-2 py-2 text-right">{t("bi.col.handling")}</th>
                <th className="px-2 py-2 text-right">{t("bi.col.base")}</th>
                <th className="px-2 py-2 text-right">{t("bi.col.total")}</th>
                <th className="px-2 py-2">{t("bi.col.loose")}</th>
                <th className="px-4 py-2">{t("bi.col.status")}</th>
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
                          <AlertTriangle size={15} /> {t("bi.noTariff")}
                        </span>
                        <span className="text-xs">{t("bi.noTariffText")}</span>
                      </td>
                      <td className="cond px-4 py-2.5 text-xs">{t("bi.cantBill")}</td>
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
                        <td className="mono px-2 py-2.5 text-right">{num(sum.inPallets, lang)}</td>
                        <td className="mono px-2 py-2.5 text-right">{num(sum.outPallets, lang)}</td>
                        <td className="mono px-2 py-2.5 text-right font-semibold">{num(sum.palletDays, lang)}</td>
                        <td className="mono px-2 py-2.5 text-right">{sum.handling ? num(sum.handling, lang) : "—"}</td>
                        <td className="mono px-2 py-2.5 text-right">{eur(inv.baseCents, lang)}</td>
                        <td className="mono px-2 py-2.5 text-right font-semibold">{eur(inv.totalCents, lang)}</td>
                      </>
                    ) : (
                      <td colSpan={6} className="px-2 py-2.5 text-xs text-dock-ink/45">{t("bi.notPrepared")}</td>
                    )}
                    <td className="px-2 py-2">
                      {inv?.status === "APPROVED" ? (
                        <span className="cond text-xs" title={t("bi.frozenTitle")}>{t("bi.frozen", { rule: ruleLabel(inv.partialPallets) })}</span>
                      ) : (
                        <>
                          <PartialRule clientId={c.id} value={rule} compact />
                          {stale && <span className="mt-1 block text-[11px] text-dock-red">{t("bi.stale", { rule: ruleLabel(inv.partialPallets) })}</span>}
                        </>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {inv ? (
                        <Link href={`/office/billing/${inv.id}`} className="cond flex items-center gap-1.5 text-xs underline underline-offset-2 hover:text-dock-ink/70">
                          {inv.status === "APPROVED" ? (
                            <>
                              <Lock size={13} /> {t("bi.approved")}
                            </>
                          ) : (
                            t("bi.draftOpen")
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
          <h3 className="cond text-xs text-dock-ink/55">{t("bi.howLoose")}</h3>
          <dl className="mt-2 grid gap-x-8 gap-y-2 text-sm md:grid-cols-2">
            {(["FRACTION", "FULL"] as const).map((m) => (
              <div key={m}>
                <dt className="cond text-xs font-semibold">{ruleLabel(m)}</dt>
                <dd className="text-dock-ink/70">{t(`bi.help.${m}` as "bi.help.FULL")}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 border-t border-dock-line pt-2 text-xs text-dock-ink/60">
            {t("bi.changing", { prepare: t("bi.prepareWord") })}
          </p>
        </div>
      </section>
    </main>
  );
}
