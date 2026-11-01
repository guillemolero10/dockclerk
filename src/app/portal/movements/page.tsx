import Link from "next/link";
import { ArrowDownToLine, ArrowUpFromLine, FileText } from "lucide-react";
import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { requireCustomer } from "@/lib/portal";

export const dynamic = "force-dynamic";

const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

export default async function PortalMovements() {
  const client = await requireCustomer();
  const { t } = await getT();
  const since = daysAgo(35);
  const [inbounds, outbounds] = await Promise.all([
    db.inbound.findMany({ where: { clientId: client.id, date: { gte: since } }, include: { lines: { include: { item: true } }, receipt: { select: { id: true } } } }),
    db.outbound.findMany({ where: { clientId: client.id, date: { gte: since } }, include: { lines: { include: { item: true } }, consignee: true } }),
  ]);
  const rows = [
    ...inbounds.map((i) => ({
      key: i.id,
      kind: "in" as const,
      date: i.date,
      number: i.number,
      what: i.lines.map((l) => `${l.pallets} × ${l.item.sku}${l.lot ? ` (${l.lot})` : ""}`).join(", ") || (i.expectedPallets !== null ? t("pt.palletsDeliver_p", { n: i.expectedPallets }) : t("pt.notAnnounced")),
      who: i.supplier ?? "—",
      status: t(`pt.in.${i.status}` as "pt.in.CLOSED"),
      receipt: i.receipt ? i.id : null,
      incident: i.incident,
    })),
    ...outbounds.map((o) => ({
      key: o.id,
      kind: "out" as const,
      date: o.date,
      number: o.number,
      what: o.lines.map((l) => `${l.pallets} × ${l.item.sku}`).join(", "),
      who: o.consignee?.name ?? "—",
      status: t(`pt.out.${o.status}` as "pt.out.CLOSED"),
      receipt: null,
      incident: null,
    })),
  ].sort((a, b) => b.date.getTime() - a.date.getTime());

  return (
    <main className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">{t("pt.movTitle")}</h1>
      <p className="text-sm text-dock-ink/60">{t("pt.movIntro")}</p>
      <ul className="dock-card divide-y divide-dock-line bg-white">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
            {r.kind === "in" ? <ArrowDownToLine size={16} className="text-dock-ink/50" /> : <ArrowUpFromLine size={16} className="text-dock-ink/50" />}
            <span className="mono w-24 text-xs text-dock-ink/55">{fmtDate(r.date)}</span>
            <span className="mono w-14 text-xs font-semibold">Nº {r.number}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">{r.what}</span>
              <span className="block truncate text-xs text-dock-ink/55">
                {r.kind === "in" ? t("pt.from", { who: r.who }) : t("pt.to", { who: r.who })}
              </span>
            </span>
            {r.incident && <span className="cond bg-dock-red px-1.5 text-[10px] text-white">{t("pt.incident")}</span>}
            <span className="cond text-[11px] text-dock-ink/60">{r.status}</span>
            {r.receipt && (
              <Link href={`/receipts/${r.receipt}`} className="cond flex items-center gap-1 text-[11px] underline">
                <FileText size={12} /> {t("pt.receipt")}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
