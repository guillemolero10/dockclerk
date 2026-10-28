import Link from "next/link";
import { ArrowRight, Bot, Boxes, CalendarClock, Gauge, HelpCircle, PackageX, ShieldAlert, Truck, Users, type LucideIcon } from "lucide-react";
import { CopyNotice } from "@/components/alerts/copy-notice";
import { AnalyzeForm } from "@/components/analyst/analyze-form";
import { FindingChart } from "@/components/analyst/charts";
import { RuleButton } from "@/components/analyst/rule-button";
import { getReport } from "@/lib/analyst";
import type { Finding, FindingKind } from "@/lib/analyst/types";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const KIND: Record<FindingKind, { label: string; icon: LucideIcon }> = {
  stockout: { label: "Stock-out", icon: PackageX },
  space: { label: "Space", icon: Boxes },
  slotting: { label: "Slotting", icon: Gauge },
  carrier: { label: "Carriers", icon: Truck },
  dock: { label: "Dock", icon: CalendarClock },
  quality: { label: "Quality", icon: ShieldAlert },
  customer: { label: "Customers", icon: Users },
};

const CONFIDENCE = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" };

const when = (d: Date) =>
  d.toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" });

export default async function AnalystPage({ searchParams }: PageProps<"/office/analyst">) {
  await requireRole("office");
  const { r } = await searchParams;
  const [report, history, warehouses] = await Promise.all([
    getReport(typeof r === "string" ? r : undefined),
    db.analystReport.findMany({ orderBy: { createdAt: "desc" }, take: 8, select: { id: true, createdAt: true, days: true, trigger: true, headline: true } }),
    db.warehouse.findMany({ select: { id: true, putaway: true } }),
  ]);
  const ruleOn = new Map(warehouses.map((w) => [w.id, w.putaway === "velocity"]));

  return (
    <main className="mx-auto max-w-6xl px-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="cond text-sm text-dock-ink/50">Studies your warehouse&apos;s history every Monday at 07:00</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Analyst</h1>
        </div>
        <AnalyzeForm initial={report?.days ?? 182} />
      </header>

      {!report ? (
        <div className="dock-card mt-8 bg-white p-10 text-center">
          <p className="text-lg font-semibold">No report yet.</p>
          <p className="mt-1 text-sm text-dock-ink/60">Press Analyze now: it reads six months of movements and takes a few seconds.</p>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_260px]">
          <div className="min-w-0 space-y-5">
            <section className="dock-card bg-dock-ink p-6 text-white">
              <p className="cond flex flex-wrap items-center gap-x-3 text-[11px] text-white/50">
                <span>{when(report.createdAt)}</span>
                <span>· {report.days} days studied</span>
                <span>· {report.trigger === "cron" ? "Monday report" : "run by the office"}</span>
                <span className="flex items-center gap-1 text-dock-yellow">
                  <Bot size={12} /> {report.brain === "rules" ? "written from a template (no model key)" : `priorities by ${report.brain}`}
                </span>
              </p>
              <h2 className="mt-3 text-2xl font-semibold leading-snug tracking-tight">{report.headline}</h2>
              <p className="mt-2 max-w-3xl text-[15px] leading-relaxed text-white/75">{report.summary}</p>
            </section>

            {report.findings.length === 0 && (
              <p className="dock-card bg-white p-6 text-sm text-dock-ink/60">Nothing in the data needs action. That is a good report.</p>
            )}

            <ol className="space-y-5">
              {report.findings.map((f, i) => (
                <FindingCard key={f.id} finding={f} rank={i + 1} ruleOn={ruleOn} />
              ))}
            </ol>

            {report.gaps.length > 0 && (
              <section className="dock-card bg-white p-5">
                <h2 className="cond flex items-center gap-2 text-sm">
                  <HelpCircle size={16} /> What I can&apos;t tell you yet
                </h2>
                <p className="mt-1 text-sm text-dock-ink/60">An analyst who guesses is worse than none. These need more history before they can be answered honestly:</p>
                <ul className="mt-3 space-y-2">
                  {report.gaps.map((g) => (
                    <li key={g.topic} className="border-l-4 border-dock-line pl-3 text-sm">
                      <span className="font-semibold">{g.topic}.</span> {g.text}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="dock-console p-5">
              <h2 className="cond text-xs text-white/50">Analyst · how this report was made</h2>
              <ul className="mono mt-3 space-y-1.5 text-[12.5px] leading-relaxed">
                {report.steps.map((s, i) => (
                  <li key={i} className={s.kind === "ok" ? "ok" : s.kind === "ask" ? "ask" : s.kind === "tool" ? "tool" : "text-white/60"}>
                    → {s.text}
                  </li>
                ))}
              </ul>
            </section>
          </div>

          <aside className="space-y-5">
            <section className="dock-card bg-white p-4">
              <h2 className="cond text-xs text-dock-ink/55">How it works</h2>
              <ol className="mt-2 space-y-2 text-sm text-dock-ink/75">
                <li><b>Code does the maths.</b> Forecasts, trends and tests run on the warehouse&apos;s own movements, with the method written under each finding.</li>
                <li><b>The model decides what matters.</b> Muse Spark Open reads the findings, sets the priorities and writes the summary.</li>
                <li><b>A guard checks every figure.</b> A number the data does not contain never reaches the report.</li>
                <li><b>It says when it doesn&apos;t know.</b> Thin data gives a gap, not a guess.</li>
              </ol>
            </section>
            <section className="dock-card bg-white p-4">
              <h2 className="cond text-xs text-dock-ink/55">Earlier reports</h2>
              <ul className="mt-2 space-y-1">
                {history.map((h) => (
                  <li key={h.id}>
                    <Link
                      href={`/office/analyst?r=${h.id}`}
                      className={`block px-2 py-1.5 text-sm hover:bg-dock-concrete-2 ${h.id === report.id ? "bg-dock-yellow" : ""}`}
                    >
                      <span className="cond block text-[10px] text-dock-ink/50">
                        {when(h.createdAt)} · {h.days} d · {h.trigger === "cron" ? "Monday" : "office"}
                      </span>
                      <span className="line-clamp-2">{h.headline}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      )}
    </main>
  );
}

function FindingCard({ finding: f, rank, ruleOn }: { finding: Finding; rank: number; ruleOn: Map<string, boolean> }) {
  const { label, icon: Icon } = KIND[f.kind];
  return (
    <li className="dock-card overflow-hidden bg-white">
      <div className="flex items-start gap-4 p-5 pb-3">
        <span className="cond grid h-9 w-9 shrink-0 place-items-center bg-dock-ink text-sm font-bold text-dock-yellow">{rank}</span>
        <div className="min-w-0 flex-1">
          <p className="cond flex flex-wrap items-center gap-x-3 text-[11px] text-dock-ink/55">
            <span className="flex items-center gap-1">
              <Icon size={13} /> {label}
            </span>
            <span className={f.confidence === "high" ? "text-dock-ink" : f.confidence === "low" ? "text-dock-red" : ""}>{CONFIDENCE[f.confidence]}</span>
          </p>
          <h3 className="mt-0.5 text-lg font-semibold leading-snug">{f.title}</h3>
        </div>
      </div>
      <div className="space-y-4 px-5 pb-5 pl-[4.25rem]">
        {f.note && (
          <p className="flex gap-2 border-l-4 border-dock-yellow bg-dock-concrete-2 px-3 py-2 text-sm">
            <Bot size={15} className="mt-0.5 shrink-0" /> <span>{f.note}</span>
          </p>
        )}
        <p className="text-sm leading-relaxed text-dock-ink/80">{f.body}</p>
        <FindingChart chart={f.chart} />
        <dl className="flex flex-wrap gap-2">
          {f.evidence.map((e) => (
            <div key={e.label} className="border-[1.5px] border-dock-line px-2.5 py-1">
              <dt className="cond text-[10px] text-dock-ink/50">{e.label}</dt>
              <dd className="mono text-sm font-semibold">{e.value}</dd>
            </div>
          ))}
        </dl>
        <details className="text-xs text-dock-ink/65">
          <summary className="cond cursor-pointer text-[11px] text-dock-ink/55">How I worked it out</summary>
          <p className="mono mt-1.5 leading-relaxed">{f.method}</p>
        </details>
        {f.actions.length > 0 && (
          <div className="flex flex-wrap items-start gap-3 border-t-[1.5px] border-dock-line pt-3">
            {f.actions.map((a) =>
              a.kind === "notice" ? (
                <CopyNotice key={a.label} text={a.text} label={a.label} />
              ) : a.kind === "rule" ? (
                <RuleButton key={a.label} warehouseId={a.warehouseId} label={a.label} active={ruleOn.get(a.warehouseId) ?? false} />
              ) : (
                <Link key={a.label} href={a.href} className="cond flex items-center gap-1.5 border-[1.5px] border-dock-ink px-3 py-1.5 text-xs hover:bg-dock-yellow">
                  {a.label} <ArrowRight size={13} />
                </Link>
              ),
            )}
          </div>
        )}
      </div>
    </li>
  );
}
