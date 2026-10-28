import Link from "next/link";
import { ArrowRight, BellRing, Boxes, Inbox, Mail, MessageCircle, Mic, Package, Sparkles, Truck, UserRound } from "lucide-react";
import type { Channel } from "@prisma/client";
import { getAlerts } from "@/lib/alerts";
import { db } from "@/lib/db";
import { fmtNumber, madridDayRange, madridHm } from "@/lib/format";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const CHANNEL: Record<Channel, { label: string; icon: typeof Mail }> = {
  EMAIL: { label: "Email", icon: Mail },
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle },
  PORTAL: { label: "Portal", icon: UserRound },
  FLOOR: { label: "Floor", icon: Mic },
};

function timeAgo(date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

/** Booked truck more than 15 minutes past its slot. */
function isLate(slot: { status: string; startsAt: Date }) {
  return slot.status === "BOOKED" && Date.now() > slot.startsAt.getTime() + 15 * 60000;
}

function dayLabel(date: Date) {
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" });
}

export default async function OfficeToday() {
  await requireRole("office");
  const { start: startOfToday, end: endOfToday } = madridDayRange();

  const [newMessages, latestMessages, trucksToday, nextShipments, stockTotals, stockByClient, clients, alerts] = await Promise.all([
    db.message.count({ where: { status: "NEW" } }),
    db.message.findMany({ where: { status: "NEW" }, orderBy: { receivedAt: "desc" }, take: 6, include: { client: true } }),
    db.dockAppointment.findMany({
      where: { startsAt: { gte: startOfToday, lt: endOfToday }, status: { not: "NO_SHOW" } },
      orderBy: { startsAt: "asc" },
      include: { warehouse: true, inbound: { include: { client: true } }, outbound: { include: { client: true } } },
    }),
    db.outbound.findMany({
      where: { status: "REQUESTED" },
      orderBy: [{ date: "asc" }, { deadline: "asc" }],
      take: 6,
      include: { client: true, consignee: true, lines: true },
    }),
    db.stock.aggregate({ _sum: { pallets: true } }),
    db.stock.groupBy({ by: ["clientId"], _sum: { pallets: true }, orderBy: { _sum: { pallets: "desc" } } }),
    db.client.findMany({ select: { id: true, name: true } }),
    // Same as the sidebar badge: the day view does not go down with the alerts.
    getAlerts().catch((error) => {
      console.error("Alerts failed", error);
      return [];
    }),
  ]);
  const urgent = alerts.filter((a) => a.level === "red");

  const upcoming = trucksToday.filter((t) => t.status === "BOOKED" || t.status === "ARRIVED");
  const totalPallets = stockTotals._sum.pallets ?? 0;
  const maxClientPallets = Math.max(...stockByClient.map((s) => s._sum.pallets ?? 0), 1);
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name ?? "";
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Madrid" });
  const hour = Number(new Date().toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Europe/Madrid" }));
  const greeting = hour < 13 ? "Good morning" : hour < 20 ? "Good afternoon" : "Good evening";

  return (
    <main className="mx-auto max-w-6xl px-8 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="cond text-sm text-dock-ink/50">{today}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-dock-ink">{greeting}, office.</h1>
        </div>
        <div className="flex items-center gap-2 border border-dock-ink bg-white px-3 py-1.5 text-xs">
          <span className="dock-live h-2 w-2 rounded-full bg-dock-red" />
          <span className="cond">AI clerk on standby · {newMessages} messages waiting</span>
        </div>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Inbox} label="Messages to handle" value={newMessages} note="email · WhatsApp · portal" accent />
        <Kpi icon={Truck} label="Trucks at the docks today" value={trucksToday.length} note={`${trucksToday.filter((t) => t.status === "DONE").length} done · ${trucksToday.filter((t) => t.status === "ARRIVED").length} at the dock`} />
        <Kpi icon={Package} label="Shipments to prepare" value={nextShipments.length} note="next 48 hours" />
        <Kpi icon={Boxes} label="Pallets in storage" value={totalPallets} note={`${stockByClient.length} customers`} />
      </section>

      {urgent.length > 0 && (
        <Link href="/office/alerts" className="dock-card group mt-6 flex items-stretch overflow-hidden bg-white hover:bg-dock-concrete-2">
          <span className="grid w-14 shrink-0 place-items-center bg-dock-red text-white">
            <BellRing size={20} />
          </span>
          <span className="min-w-0 flex-1 px-4 py-3">
            <span className="cond block text-[11px] text-dock-red">
              {urgent.length} {urgent.length === 1 ? "alert" : "alerts"} to act on now
            </span>
            {urgent.slice(0, 3).map((a) => (
              <span key={a.id} className="block truncate text-sm font-medium">
                {a.title}
              </span>
            ))}
          </span>
          <span className="cond flex items-center gap-1.5 px-4 text-sm">
            All alerts <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
          </span>
        </Link>
      )}

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="dock-console min-w-0 p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="cond text-xs text-white/50">AI clerk · activity log</h2>
            <Link href="/office/inbox" className="cond group flex items-center gap-1.5 bg-dock-yellow px-3 py-1.5 text-sm font-semibold text-dock-ink transition hover:brightness-95">
              <Sparkles size={15} /> Let the clerk handle it
              <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
            </Link>
          </div>
          <ul className="mono mt-4 space-y-2 text-[13px] leading-relaxed">
            {latestMessages.map((m) => {
              const ch = CHANNEL[m.channel];
              return (
                <li key={m.id} className="flex items-start gap-3">
                  <span className="t shrink-0 text-[11px]">{timeAgo(m.receivedAt)}</span>
                  <ch.icon size={13} className="mt-0.5 shrink-0 text-white/40" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="tool">{m.client?.name ?? m.fromName}</span>
                    <span className="text-white/40"> — {m.body}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="dock-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="cond text-xs text-dock-ink/50">Dock today</h2>
              <Link href="/office/dock" className="cond flex items-center gap-1 text-[11px] text-dock-ink/50 hover:text-dock-ink">
                Open dock <ArrowRight size={12} />
              </Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="mt-3 text-sm text-dock-ink/50">No more trucks today.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {upcoming.slice(0, 4).map((t) => {
                  const late = isLate(t);
                  return (
                    <li key={t.id} className="flex items-center gap-3 border border-dock-line bg-white p-3">
                      <span className="mono w-11 text-sm font-semibold">{madridHm(t.startsAt)}</span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{(t.inbound ?? t.outbound)!.client.name}</p>
                        <p className="mono text-[11px] text-dock-ink/50">
                          {t.inboundId ? "Unloading" : "Loading"} · {t.warehouse.code} dock {t.dock}
                        </p>
                      </div>
                      <span
                        className={`cond px-2 py-0.5 text-[11px] ${t.status === "ARRIVED" ? "bg-dock-ink text-dock-yellow" : late ? "bg-dock-red text-white" : "bg-dock-yellow text-dock-ink"}`}
                      >
                        {t.status === "ARRIVED" ? "At dock" : late ? "Late" : "Booked"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="dock-card p-5">
            <h2 className="cond text-xs text-dock-ink/50">Next shipments</h2>
            <ul className="mt-3 space-y-2.5">
              {nextShipments.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{o.consignee?.name}</p>
                    <p className="truncate text-xs text-dock-ink/50">{o.client.name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="mono">{o.lines.reduce((s, l) => s + l.pallets, 0)} plt</p>
                    <p className="cond text-[11px] text-dock-ink/50">{dayLabel(o.date)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="dock-card mt-4 p-5">
        <h2 className="cond text-xs text-dock-ink/50">Stock by customer</h2>
        <ul className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
          {stockByClient.map((s) => {
            const pallets = s._sum.pallets ?? 0;
            return (
              <li key={s.clientId}>
                <div className="flex justify-between text-xs">
                  <span className="text-dock-ink/60">{clientName(s.clientId)}</span>
                  <span className="mono">{fmtNumber(pallets)} plt</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden border border-dock-ink/20 bg-white">
                  <div className="h-full bg-dock-yellow" style={{ width: `${(pallets / maxClientPallets) * 100}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}

function Kpi({ icon: Icon, label, value, note, accent }: { icon: typeof Mail; label: string; value: number; note: string; accent?: boolean }) {
  return (
    <div className={`dock-card p-5 ${accent ? "bg-dock-yellow" : ""}`}>
      <div className="flex items-center justify-between">
        <p className="cond text-[11px] text-dock-ink/60">{label}</p>
        <Icon size={16} className="text-dock-ink/50" />
      </div>
      <p className="mono mt-3 text-4xl font-bold tabular-nums tracking-tight text-dock-ink">{fmtNumber(value)}</p>
      <p className="cond mt-1 text-[11px] text-dock-ink/50">{note}</p>
    </div>
  );
}
