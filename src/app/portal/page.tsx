import Link from "next/link";
import { ArrowRight, FileText, Sparkles } from "lucide-react";
import { db } from "@/lib/db";
import { madridHm } from "@/lib/format";
import { LOCALE } from "@/lib/i18n/core";
import { getT } from "@/lib/i18n/server";
import { requireCustomer } from "@/lib/portal";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
const day = (d: Date, lang: "en" | "es") => d.toLocaleDateString(LOCALE[lang], { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Madrid" });

export default async function PortalHome() {
  const client = await requireCustomer();
  const { t, lang } = await getT();
  const now = new Date();
  const [byWarehouse, warehouses, open, shipped, inbounds, expiring] = await Promise.all([
    db.stock.groupBy({ by: ["warehouseId"], where: { clientId: client.id }, _sum: { pallets: true } }),
    db.warehouse.findMany(),
    db.outbound.findMany({
      where: { clientId: client.id, status: { in: ["REQUESTED", "PREPARED"] } },
      include: { consignee: true, appointment: true, lines: true, _count: { select: { picked: true } } },
      orderBy: { deadline: "asc" },
    }),
    db.outbound.findMany({
      where: { clientId: client.id, status: { in: ["SHIPPED", "CLOSED"] }, date: { gte: new Date(now.getTime() - 7 * DAY) } },
      include: { consignee: true, lines: true },
      orderBy: { date: "desc" },
      take: 4,
    }),
    db.inbound.findMany({
      where: { clientId: client.id, status: { in: ["RECEIVED", "CLOSED"] } },
      include: { receipt: { select: { id: true } } },
      orderBy: { date: "desc" },
      take: 4,
    }),
    db.stock.groupBy({
      by: ["itemId", "lot", "expiresAt"],
      where: { clientId: client.id, expiresAt: { lt: new Date(now.getTime() + 90 * DAY) } },
      _sum: { pallets: true },
      orderBy: { expiresAt: "asc" },
    }),
  ]);
  const items = await db.item.findMany({ where: { id: { in: expiring.map((e) => e.itemId) } } });
  const total = byWarehouse.reduce((sum, w) => sum + (w._sum.pallets ?? 0), 0);

  return (
    <main className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="cond text-sm text-dock-ink/50">{client.contact ? t("pt.helloName", { name: client.contact.split(" ")[0] }) : t("pt.hello")}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t("pt.live")}</h1>
        </div>
        <Link href="/portal/ask" className="cond flex items-center gap-2 bg-dock-yellow px-4 py-2 text-sm font-semibold ring-[1.5px] ring-dock-ink">
          <Sparkles size={15} /> {t("pt.askBtn")}
        </Link>
      </header>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="dock-card bg-white p-5">
          <p className="cond text-[11px] text-dock-ink/50">{t("pt.inStorage")}</p>
          <p className="mono mt-1 text-4xl font-semibold">{total}</p>
          <p className="mt-1 text-xs text-dock-ink/55">
            {byWarehouse.map((w) => `${warehouses.find((x) => x.id === w.warehouseId)?.name.split(" · ")[0]}: ${w._sum.pallets}`).join(" · ")}
          </p>
        </div>
        <div className="dock-card bg-white p-5">
          <p className="cond text-[11px] text-dock-ink/50">{t("pt.inProgress")}</p>
          <p className="mono mt-1 text-4xl font-semibold">{open.length}</p>
          <p className="mt-1 text-xs text-dock-ink/55">{t("pt.readyN", { n: open.filter((o) => o.status === "PREPARED").length })}</p>
        </div>
        <div className={`dock-card p-5 ${expiring.length ? "bg-dock-yellow" : "bg-white"}`}>
          <p className="cond text-[11px] text-dock-ink/60">{t("pt.expiring90")}</p>
          <p className="mono mt-1 text-4xl font-semibold">{expiring.length}</p>
          <p className="mt-1 text-xs text-dock-ink/60">{expiring.length ? t("pt.seeBelow") : t("pt.nothingClose")}</p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="min-w-0">
          <h2 className="cond mb-2 text-sm">{t("pt.onItsWay")}</h2>
          <ul className="dock-card divide-y divide-dock-line bg-white">
            {open.length === 0 && <li className="px-4 py-3 text-sm text-dock-ink/50">{t("pt.noOutbounds")}</li>}
            {open.map((o) => {
              const pallets = o.lines.reduce((sum, l) => sum + l.pallets, 0);
              const status =
                o.status === "PREPARED" ? t("pt.readyToLoad") : o._count.picked > 0 ? t("pt.beingPicked", { a: o._count.picked, b: pallets }) : t("pt.requested");
              return (
                <li key={o.id} className="flex items-center gap-3 px-4 py-3 text-sm">
                  <span className="mono w-14 text-xs font-semibold">Nº {o.number}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">→ {o.consignee?.name ?? "—"}</span>
                    <span className="block text-xs text-dock-ink/55">
                      {t("pt.palletsDeliver_p", { n: pallets })} · {t("pt.deliverBy", { when: o.deadline ? `${day(o.deadline, lang)} ${madridHm(o.deadline)}` : "—" })}
                      {o.appointment && ` · ${t("pt.truck", { when: `${day(o.appointment.startsAt, lang)} ${madridHm(o.appointment.startsAt)}` })}`}
                    </span>
                  </span>
                  <span className={`cond shrink-0 px-2 py-0.5 text-[11px] ${o.status === "PREPARED" ? "bg-dock-ink text-dock-yellow" : "bg-dock-concrete-2"}`}>{status}</span>
                </li>
              );
            })}
            {shipped.map((o) => (
              <li key={o.id} className="flex items-center gap-3 px-4 py-3 text-sm text-dock-ink/55">
                <span className="mono w-14 text-xs">Nº {o.number}</span>
                <span className="min-w-0 flex-1 truncate">→ {o.consignee?.name ?? "—"} · {t("pt.palletsDeliver_p", { n: o.lines.reduce((s, l) => s + l.pallets, 0) })}</span>
                <span className="cond shrink-0 text-[11px]">{t("pt.shippedOn", { day: day(o.date, lang) })}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0 space-y-6">
          {expiring.length > 0 && (
            <div>
              <h2 className="cond mb-2 text-sm">{t("pt.expiringSoon")}</h2>
              <ul className="dock-card divide-y divide-dock-line bg-white">
                {expiring.map((e) => {
                  const days = Math.ceil((e.expiresAt!.getTime() - now.getTime()) / DAY);
                  return (
                    <li key={`${e.itemId}${e.lot}`} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <span className="mono font-semibold">{items.find((i) => i.id === e.itemId)?.sku}</span>
                      <span className="mono text-xs text-dock-ink/55">{t("pt.lotN", { lot: e.lot ?? "" })}</span>
                      <span className="mono ml-auto text-xs">{t("pt.plt", { n: e._sum.pallets ?? 0 })}</span>
                      <span className={`cond px-2 py-0.5 text-[11px] ${days < 30 ? "bg-dock-red text-white" : "bg-dock-yellow"}`}>{t("pt.days", { n: days })}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div>
            <h2 className="cond mb-2 flex items-center justify-between text-sm">
              {t("pt.lastDeliveries")}
              <Link href="/portal/movements" className="flex items-center gap-1 text-[11px] text-dock-ink/50">
                {t("pt.allMovements")} <ArrowRight size={12} />
              </Link>
            </h2>
            <ul className="dock-card divide-y divide-dock-line bg-white">
              {inbounds.map((i) => (
                <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="mono w-14 text-xs font-semibold">Nº {i.number}</span>
                  <span className="flex-1">{day(i.date, lang)} · {t("pt.palletsDeliver_p", { n: i.receivedPallets ?? 0 })}</span>
                  {i.receipt && (
                    <Link href={`/receipts/${i.id}`} className="cond flex items-center gap-1 text-[11px] underline">
                      <FileText size={12} /> {t("pt.receipt")}
                    </Link>
                  )}
                  {i.incident && <span className="cond bg-dock-red px-1.5 text-[10px] text-white">{t("pt.incident")}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
