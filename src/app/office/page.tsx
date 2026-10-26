import Link from "next/link";
import { ArrowRight, Boxes, Inbox, Mail, MessageCircle, Package, Sparkles, Truck, UserRound } from "lucide-react";
import type { Channel } from "@prisma/client";
import { db } from "@/lib/db";
import { fmtNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

const CHANNEL: Record<Channel, { label: string; icon: typeof Mail; tone: string }> = {
  EMAIL: { label: "Email", icon: Mail, tone: "text-sky-300 bg-sky-400/10 ring-sky-400/20" },
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle, tone: "text-emerald-300 bg-emerald-400/10 ring-emerald-400/20" },
  PORTAL: { label: "Portal", icon: UserRound, tone: "text-violet-300 bg-violet-400/10 ring-violet-400/20" },
};

function timeAgo(date: Date) {
  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function dayLabel(date: Date) {
  return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" });
}

export default async function OfficeToday() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000);

  const [newMessages, latestMessages, trucksToday, nextShipments, stockTotals, stockByClient, clients] = await Promise.all([
    db.message.count({ where: { status: "NEW" } }),
    db.message.findMany({ where: { status: "NEW" }, orderBy: { receivedAt: "desc" }, take: 6, include: { client: true } }),
    db.inbound.findMany({
      where: { date: { gte: startOfToday, lt: endOfToday }, status: { in: ["EXPECTED", "RECEIVING"] } },
      include: { client: true, carrier: true },
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
  ]);

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
          <p className="text-sm text-zinc-500">{today}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-white">{greeting}, office.</h1>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-dock-line bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-400">
          <span className="dock-live h-2 w-2 rounded-full bg-dock-amber" />
          AI clerk on standby · {newMessages} messages waiting
        </div>
      </header>

      <section className="mt-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi icon={Inbox} label="Messages to handle" value={newMessages} note="email · WhatsApp · portal" accent />
        <Kpi icon={Truck} label="Trucks expected today" value={trucksToday.length} note="dock receiving" />
        <Kpi icon={Package} label="Shipments to prepare" value={nextShipments.length} note="next 48 hours" />
        <Kpi icon={Boxes} label="Pallets in storage" value={totalPallets} note={`${stockByClient.length} customers`} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="dock-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-300">Waiting in the inbox</h2>
            <Link href="/office/inbox" className="group flex items-center gap-1.5 rounded-lg bg-dock-amber px-3 py-1.5 text-sm font-medium text-black transition hover:brightness-110">
              <Sparkles size={15} /> Let the clerk handle it
              <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
            </Link>
          </div>
          <ul className="mt-4 divide-y divide-dock-line">
            {latestMessages.map((m) => {
              const ch = CHANNEL[m.channel];
              return (
                <li key={m.id} className="flex items-start gap-3 py-3">
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ring-1 ${ch.tone}`}>
                    <ch.icon size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="truncate text-sm font-medium text-zinc-200">{m.client?.name ?? m.fromName}</p>
                      <span className="shrink-0 font-mono text-[11px] text-zinc-500">{timeAgo(m.receivedAt)}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-zinc-500">{m.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="dock-card p-5">
            <h2 className="text-sm font-medium text-zinc-300">Dock today</h2>
            {trucksToday.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-500">No trucks expected.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {trucksToday.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 rounded-xl border border-dock-line bg-black/20 p-3">
                    <Truck size={18} className="text-dock-amber" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-zinc-200">{t.client.name}</p>
                      <p className="font-mono text-[11px] text-zinc-500">{t.plate} · {t.carrier?.name}</p>
                    </div>
                    <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-300 ring-1 ring-amber-400/20">Expected</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="dock-card p-5">
            <h2 className="text-sm font-medium text-zinc-300">Next shipments</h2>
            <ul className="mt-3 space-y-2.5">
              {nextShipments.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate text-zinc-200">{o.consignee?.name}</p>
                    <p className="truncate text-xs text-zinc-500">{o.client.name}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-mono text-zinc-200">{o.lines.reduce((s, l) => s + l.pallets, 0)} plt</p>
                    <p className="text-[11px] text-zinc-500">{dayLabel(o.date)}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="dock-card mt-4 p-5">
        <h2 className="text-sm font-medium text-zinc-300">Stock by customer</h2>
        <ul className="mt-4 grid gap-x-8 gap-y-3 md:grid-cols-2">
          {stockByClient.map((s) => {
            const pallets = s._sum.pallets ?? 0;
            return (
              <li key={s.clientId}>
                <div className="flex justify-between text-xs">
                  <span className="text-zinc-400">{clientName(s.clientId)}</span>
                  <span className="font-mono text-zinc-300">{fmtNumber(pallets)} plt</span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                  <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-dock-amber" style={{ width: `${(pallets / maxClientPallets) * 100}%` }} />
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
    <div className={`dock-card relative overflow-hidden p-5 ${accent ? "ring-1 ring-dock-amber/30" : ""}`}>
      {accent && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-dock-amber to-transparent" />}
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">{label}</p>
        <Icon size={16} className={accent ? "text-dock-amber" : "text-zinc-600"} />
      </div>
      <p className={`mt-3 font-mono text-4xl font-semibold tabular-nums tracking-tight ${accent ? "text-dock-amber" : "text-white"}`}>{fmtNumber(value)}</p>
      <p className="mt-1 text-xs text-zinc-600">{note}</p>
    </div>
  );
}
