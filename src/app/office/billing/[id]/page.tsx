import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Archive, Lock } from "lucide-react";
import { ApproveButton } from "@/components/billing/approve-button";
import { PrintButton } from "@/components/print-button";
import { dayOfYmd } from "@/lib/billing/calendar";
import type { DetailRow } from "@/lib/billing/compute";
import { ddmm, dmy, eur, groupMovements, num, periodText, readDetail, readLines } from "@/lib/billing/view";
import type { BillLine } from "@/lib/billing/compute";
import { db } from "@/lib/db";
import { LOCALE, type Lang, type Translate } from "@/lib/i18n/core";
import { getT } from "@/lib/i18n/server";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const when = (d: Date, lang: Lang) => d.toLocaleString(LOCALE[lang], { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

export default async function PreInvoicePage({ params }: PageProps<"/office/billing/[id]">) {
  await requireRole("office");
  const { t, lang } = await getT();
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
  const ruleLabel = t(`bi.rule.${inv.partialPallets}` as "bi.rule.FULL");
  const e = (c: number) => eur(c, lang);
  const n = (x: number) => num(x, lang);
  // A pre-invoice whose detail does not add up to its summary must never be approved.
  const broken = !checks || !checks.detailMatches;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-8 sm:py-8 print:max-w-none print:p-0">
      <Link href={`/office/billing?month=${first.slice(0, 7)}`} className="cond flex items-center gap-1 text-xs text-dock-ink/50 hover:text-dock-ink print:hidden">
        <ArrowLeft size={13} /> {t("bx.back")}
      </Link>

      <p className="cond mt-3 border-[1.5px] border-dock-ink bg-dock-yellow px-3 py-1.5 text-center text-sm font-bold tracking-wide print:border-dock-ink">
        {t("bx.banner")}
      </p>

      {broken && (
        <div role="alert" className="mt-3 flex items-start gap-2 bg-dock-red px-4 py-3 text-sm font-medium text-white">
          <AlertTriangle size={17} className="mt-0.5 shrink-0" />
          <span>
            {t("bx.broken")}
            {checks ? t("bx.brokenNums", { a: n(checks.palletDaysSummary), b: n(checks.palletDaysDetail), c: checks.centsSummary, d: checks.centsDetail }) : t("bx.brokenNone")}{t("bx.brokenTail")}
          </span>
        </div>
      )}

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mono text-xs text-dock-ink/50">
            {t("bx.preNo", { code: inv.client.code, n: inv.number })}
          </p>
          <h1 className="text-3xl font-semibold leading-tight tracking-tight">{inv.client.name}</h1>
          <p className="mt-1 text-[15px] font-medium">
            {periodText(first, last, lang)} <span className="text-dock-ink/55">{t("bx.daysIncl", { n: days })}</span>
          </p>
        </div>
        <div className="flex flex-col items-start gap-2 sm:items-end">
          {approved ? (
            <span className="cond flex items-center gap-1.5 bg-dock-ink px-3 py-1.5 text-sm text-dock-yellow">
              <Lock size={14} /> {t("bx.approvedBadge")}
            </span>
          ) : (
            <span className="cond border-[1.5px] border-dock-ink bg-white px-3 py-1.5 text-sm">{t("bx.draft")}</span>
          )}
          {approved && inv.approvedAt && (
            <span className="text-xs text-dock-ink/55">
              {when(inv.approvedAt, lang)}
              {inv.approvedBy ? ` · ${inv.approvedBy}` : ""}
            </span>
          )}
        </div>
      </header>

      <p className="mt-3 border-l-4 border-dock-ink bg-white px-3 py-2 text-sm">
        <span className="cond text-xs font-semibold">{t("bx.loose", { rule: ruleLabel })}</span>
        <span className="block text-dock-ink/65">{t(`bi.help.${inv.partialPallets}` as "bi.help.FULL")}</span>
      </p>

      <section className="dock-card mt-5 bg-white">
        {/* Phone: one block per line (concept, amount, then quantity × price), so nothing needs sliding. */}
        <div className="sm:hidden print:hidden">
          <ul className="divide-y divide-dock-line">
            {lines.map((l, i) => (
              <li key={i} className="px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 font-medium">{lineLabel(l, t)}</span>
                  <span className="mono shrink-0">{e(l.cents)}</span>
                </div>
                <p className="mono mt-0.5 text-xs text-dock-ink/60">
                  {n(l.quantity)} {lineUnit(l, t)} × {n(l.price)} €
                </p>
              </li>
            ))}
          </ul>
          <dl className="space-y-1 border-t-[1.5px] border-dock-ink px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="cond text-xs text-dock-ink/60">{t("bx.base")}</dt>
              <dd className="mono">{e(inv.baseCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="cond text-xs text-dock-ink/60">{t("bx.vat", { p: n(inv.vatPct) })}</dt>
              <dd className="mono">{e(inv.vatCents)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-1">
              <dt className="cond text-sm font-semibold">{t("bx.total")}</dt>
              <dd className="mono text-lg font-semibold">{e(inv.totalCents)}</dd>
            </div>
          </dl>
        </div>
        <div className="hidden overflow-x-auto sm:block print:block">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="cond border-b-[1.5px] border-dock-ink text-left text-[11px] text-dock-ink/55">
                <th className="px-4 py-2">{t("bx.concept")}</th>
                <th className="px-2 py-2 text-right">{t("bx.quantity")}</th>
                <th className="px-2 py-2 text-right">{t("bx.price")}</th>
                <th className="px-4 py-2 text-right">{t("bx.amount")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-dock-line">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="px-4 py-2.5 font-medium">{lineLabel(l, t)}</td>
                  <td className="mono px-2 py-2.5 text-right">
                    {n(l.quantity)} <span className="text-xs text-dock-ink/50">{lineUnit(l, t)}</span>
                  </td>
                  <td className="mono px-2 py-2.5 text-right">{n(l.price)} €</td>
                  <td className="mono px-4 py-2.5 text-right">{e(l.cents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-[1.5px] border-dock-ink">
              <tr>
                <td colSpan={3} className="cond px-4 pt-2 text-right text-xs text-dock-ink/60">{t("bx.base")}</td>
                <td className="mono px-4 pt-2 text-right">{e(inv.baseCents)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="cond px-4 text-right text-xs text-dock-ink/60">{t("bx.vat", { p: n(inv.vatPct) })}</td>
                <td className="mono px-4 text-right">{e(inv.vatCents)}</td>
              </tr>
              <tr>
                <td colSpan={3} className="cond px-4 pb-3 pt-1 text-right text-sm font-semibold">{t("bx.total")}</td>
                <td className="mono px-4 pb-3 pt-1 text-right text-lg font-semibold">{e(inv.totalCents)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="cond text-sm text-dock-ink/60">{t("bx.movements")}</h2>
        <p className="mb-3 text-xs text-dock-ink/55">{t("bx.movementsHelp")}</p>
        {groups.length === 0 ? (
          <p className="dock-card bg-white p-5 text-sm text-dock-ink/60">{t("bx.noMovements")}</p>
        ) : (
          <ul className="space-y-4">
            {groups.map((g) => (
              <li key={g.key} className={`dock-card overflow-hidden bg-white ${g.split ? "ring-[3px] ring-dock-yellow" : ""} print:break-inside-avoid`}>
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b-[1.5px] border-dock-ink bg-dock-concrete-2 px-4 py-2">
                  <span className="cond text-xs font-semibold">Nº {g.inboundNumber ?? "—"}</span>
                  <span className="mono text-sm font-semibold">{g.sku}</span>
                  {g.lot && <span className="mono text-xs text-dock-ink/55">{t("bx.lot", { lot: g.lot })}</span>}
                  <span className="text-xs text-dock-ink/55">
                    {t("bx.entered", { date: dmy(g.inDate) })}
                    {g.docRef ? ` · ${g.docRef}` : ""}
                  </span>
                  <span className="mono ml-auto text-xs font-semibold">{e(g.cents)}</span>
                </div>
                {g.split && (
                  <p className="bg-dock-yellow px-4 py-2 text-[15px] font-bold leading-snug">{t("bx.split", { total: n(g.split.total), stay: n(g.split.stay), leaving: g.split.leaving.map((l) => t("bx.leave", { n: n(l.pallets), date: ddmm(l.exitDate) })).join(" · ") })}</p>
                )}
                <ul className="divide-y divide-dock-line sm:hidden print:hidden">
                  {g.rows.map((r, i) => (
                    <MovementCard key={i} row={r} periodLast={last} t={t} lang={lang} />
                  ))}
                </ul>
                <div className="hidden overflow-x-auto sm:block print:block">
                  <table className="w-full min-w-[520px] text-sm">
                    <tbody className="divide-y divide-dock-line">
                      {g.rows.map((r, i) => (
                        <MovementRow key={i} row={r} periodLast={last} t={t} lang={lang} />
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
          {t("bx.check", { a: n(checks.palletDaysDetail), b: n(checks.palletDaysSummary), c: e(checks.centsDetail), d: e(checks.centsSummary) })}
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
            <Lock size={14} /> {t("bx.approvedFrozen")}
          </span>
        ) : (
          <ApproveButton id={inv.id} disabled={broken} reason={t("bx.brokenReason")} />
        )}
      </div>
    </main>
  );
}

function lineLabel(l: BillLine, t: Translate) {
  if (l.concept === "in") return t("bx.line.in");
  if (l.concept === "out") return l.label.includes("deducted") ? t("bx.line.outDeducted") : t("bx.line.out");
  if (l.concept === "storage") return l.label.includes("euro") ? t("bx.line.euro") : t("bx.line.american");
  if (l.concept === "handling") return t("bx.line.handling");
  return l.label;
}

function lineUnit(l: BillLine, t: Translate) {
  return l.unit === "pallets" ? t("bx.unit.pallets") : l.unit === "pallet·day" ? t("bx.unit.palletDay") : l.unit;
}

function describeRow(r: DetailRow, periodLast: string, t: Translate) {
  const leaving = r.exitDate !== null;
  const gone = leaving && r.exitDate! <= periodLast;
  const exitText = r.exitDate === null ? t("bx.noExit") : t(gone ? "bx.left" : "bx.leaves", { date: ddmm(r.exitDate) });
  const Icon = r.concept === "in" ? ArrowDownToLine : r.concept === "out" ? ArrowUpFromLine : Archive;
  const kind = r.concept === "in" ? t("bx.entry") : r.concept === "out" ? t("bx.exit") : t("bx.storage");
  return { leaving, exitText, Icon, kind };
}

/** The same movement as MovementRow, stacked for a phone: kind and amount on top, the pallets below, exit and price last. */
function MovementCard({ row: r, periodLast, t, lang }: { row: DetailRow; periodLast: string; t: Translate; lang: Lang }) {
  const { leaving, exitText, Icon, kind } = describeRow(r, periodLast, t);
  const n = (x: number) => num(x, lang);
  return (
    <li className="px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="cond flex items-center gap-1.5 text-xs text-dock-ink/60">
          <Icon size={13} aria-hidden /> {kind}
        </span>
        <span className="mono shrink-0">{eur(r.cents, lang)}</span>
      </div>
      <p className="mt-0.5">
        <span className="mono text-[15px] font-semibold">{n(r.pallets)}</span> <span className="text-xs text-dock-ink/55">{t("bx.pallets")}</span>
        {r.concept === "storage" && (
          <span className="mono text-xs text-dock-ink/65">
            {" "}{t("bx.days", { d: r.days ?? 0, pd: n(r.palletDays ?? 0) })}
          </span>
        )}
        {r.concept === "out" && (
          <span className="mono text-xs text-dock-ink/65">
            {" "}{t("bx.on", { date: r.exitDate ? ddmm(r.exitDate) : "" })}
            {r.outboundNumber ? ` · Nº ${r.outboundNumber}` : ""}
          </span>
        )}
      </p>
      {r.note && <p className="text-[11px] text-dock-ink/50">{r.note}</p>}
      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
        {r.concept === "storage" && (
          <span className={`cond whitespace-nowrap px-2 py-0.5 text-xs font-semibold ${leaving ? "bg-dock-ink text-dock-yellow" : "border-[1.5px] border-dock-ink"}`}>{exitText}</span>
        )}
        <span className="mono text-xs text-dock-ink/55">{t("bx.at", { price: n(r.price) })}</span>
      </p>
    </li>
  );
}

function MovementRow({ row: r, periodLast, t, lang }: { row: DetailRow; periodLast: string; t: Translate; lang: Lang }) {
  const { leaving, exitText, Icon, kind } = describeRow(r, periodLast, t);
  const n = (x: number) => num(x, lang);
  return (
    <tr className="align-baseline">
      <td className="w-28 whitespace-nowrap px-4 py-2">
        <span className="cond flex items-center gap-1.5 text-xs text-dock-ink/60">
          <Icon size={13} /> {kind}
        </span>
      </td>
      <td className="px-2 py-2">
        <span className="mono text-[15px] font-semibold">{n(r.pallets)}</span> <span className="text-xs text-dock-ink/55">{t("bx.pallets")}</span>
        {r.concept === "storage" && (
          <span className="mono text-xs text-dock-ink/65">
            {" "}{t("bx.days", { d: r.days ?? 0, pd: n(r.palletDays ?? 0) })}
          </span>
        )}
        {r.concept === "out" && (
          <span className="mono text-xs text-dock-ink/65">
            {" "}{t("bx.on", { date: r.exitDate ? ddmm(r.exitDate) : "" })}
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
      <td className="mono whitespace-nowrap px-2 py-2 text-right text-xs text-dock-ink/55">{n(r.price)} €</td>
      <td className="mono whitespace-nowrap px-4 py-2 text-right">{eur(r.cents, lang)}</td>
    </tr>
  );
}
