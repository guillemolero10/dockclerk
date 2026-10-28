import Link from "next/link";
import { AlertTriangle, ArrowRight, Boxes, CalendarClock, Clock, Forklift, PackageX, Snail, Truck } from "lucide-react";
import { AutoRefresh } from "@/components/auto-refresh";
import { CopyNotice } from "@/components/alerts/copy-notice";
import { getAlerts, type AlertKind, type AlertLevel } from "@/lib/alerts";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const KIND: Record<AlertKind, { label: string; icon: typeof Truck }> = {
  dock: { label: "Dock", icon: Truck },
  stock: { label: "Stock", icon: PackageX },
  expiry: { label: "Expiry", icon: CalendarClock },
  space: { label: "Space", icon: Boxes },
  floor: { label: "Floor", icon: Forklift },
  incident: { label: "Incident", icon: AlertTriangle },
  slow: { label: "Slow stock", icon: Snail },
};

const LEVELS: { level: AlertLevel; title: string; note: string; bar: string }[] = [
  { level: "red", title: "Act now", note: "Something is late, missing or about to go wrong.", bar: "bg-dock-red" },
  { level: "amber", title: "Today", note: "Needs doing before the end of the shift.", bar: "bg-dock-yellow" },
  { level: "grey", title: "Keep an eye on", note: "Nothing urgent, worth knowing.", bar: "bg-dock-line" },
];

export default async function AlertsPage() {
  await requireRole("office");
  const alerts = await getAlerts();
  const count = (level: AlertLevel) => alerts.filter((a) => a.level === level).length;

  return (
    <main className="mx-auto max-w-5xl px-8 py-8">
      <AutoRefresh seconds={30} />
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="cond text-sm text-dock-ink/50">Checked against the live software every 30 seconds</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">Alerts</h1>
        </div>
        <div className="flex gap-2">
          {LEVELS.map(({ level, title, bar }) => (
            <span key={level} className="dock-card flex items-center gap-2 bg-white px-3 py-1.5 text-sm">
              <span className={`h-3 w-3 ${bar}`} />
              <span className="cond">{title}</span>
              <span className="mono font-semibold">{count(level)}</span>
            </span>
          ))}
        </div>
      </header>

      {alerts.length === 0 && (
        <div className="dock-card mt-8 bg-white p-10 text-center">
          <p className="text-lg font-semibold">All clear.</p>
          <p className="mt-1 text-sm text-dock-ink/60">No late trucks, no short orders, nothing about to expire.</p>
        </div>
      )}

      {LEVELS.filter(({ level }) => count(level) > 0).map(({ level, title, note, bar }) => (
        <section key={level} className="mt-8">
          <div className="mb-3 flex items-baseline gap-3">
            <h2 className="cond text-lg font-semibold">{title}</h2>
            <p className="text-sm text-dock-ink/50">{note}</p>
          </div>
          <ul className="space-y-3">
            {alerts
              .filter((a) => a.level === level)
              .map((a) => {
                const { label, icon: Icon } = KIND[a.kind];
                return (
                  <li key={a.id} className="dock-card flex overflow-hidden bg-white">
                    <span className={`w-2 shrink-0 ${bar}`} />
                    <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-2 p-4">
                      <span className="cond flex w-24 shrink-0 items-center gap-1.5 pt-0.5 text-[11px] text-dock-ink/55">
                        <Icon size={15} /> {label}
                      </span>
                      <div className="min-w-[12rem] flex-1 space-y-1.5">
                        <p className="font-semibold">{a.title}</p>
                        <p className="text-sm text-dock-ink/70">{a.detail}</p>
                        {a.notice && <CopyNotice text={a.notice} />}
                      </div>
                      <Link href={a.href} className="cond flex shrink-0 items-center gap-1.5 border-[1.5px] border-dock-ink px-3 py-1.5 text-xs hover:bg-dock-yellow">
                        {a.action} <ArrowRight size={13} />
                      </Link>
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}

      <p className="mt-10 flex items-center gap-2 text-xs text-dock-ink/45">
        <Clock size={13} /> Every alert is a plain query on the warehouse software, no model guessing: it is never wrong and never slow.
      </p>
    </main>
  );
}
