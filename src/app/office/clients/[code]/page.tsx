import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, FileText } from "lucide-react";
import { PartialRule } from "@/components/billing/partial-rule";
import { customerDetail, ROTATION_DAYS } from "@/lib/clients";
import { db } from "@/lib/db";
import { fmtDate, fmtNumber } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import type { Translate } from "@/lib/i18n/core";
import { clientColor } from "@/lib/warehouse/palette";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
const daysLeft = (d: Date) => Math.ceil((d.getTime() - Date.now()) / DAY);

/** How long the free stock lasts at last month's pace. */
function cover(weeks: number | null, free: number, t: Translate) {
  if (free === 0) return { text: t("cd.noneFree"), tone: "text-dock-red" };
  if (weeks === null) return { text: t("cd.noMovement"), tone: "text-dock-ink/45" };
  if (weeks < 1) return { text: t("cd.days", { n: Math.round(weeks * 7) }), tone: "text-dock-red font-semibold" };
  return { text: t("cd.weeks", { n: weeks < 10 ? weeks.toFixed(1) : Math.round(weeks) }), tone: weeks > 12 ? "text-dock-ink/45" : "" };
}

export default async function ClientPage({ params }: PageProps<"/office/clients/[code]">) {
  await requireRole("office");
  const { t, lang } = await getT();
  const unitWord = (u: string) => t(`cd.unit.${u}` as "cd.unit.BOX");
  const { code } = await params;
  const [detail, codes] = await Promise.all([customerDetail(code), db.client.findMany({ orderBy: { code: "asc" }, select: { code: true } })]);
  if (!detail) notFound();
  const tariff = await db.tariff.findUnique({ where: { clientId: detail.client.id }, select: { partialPallets: true } });
  const { client, items, movements } = detail;
  const color = clientColor(codes.findIndex((c) => c.code === code));
  const total = (f: (i: (typeof items)[number]) => number) => items.reduce((sum, i) => sum + f(i), 0);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
      <Link href="/office/clients" className="cond flex items-center gap-1 text-xs text-dock-ink/50 hover:text-dock-ink">
        <ArrowLeft size={13} /> {t("cd.customers")}
      </Link>
      <header className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
        <span className="h-10 w-2" style={{ background: color }} />
        <div>
          <p className="mono text-xs text-dock-ink/50">{client.code}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-dock-ink/60">{[client.contact, client.email, client.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-3 sm:ml-auto">
          <Stat value={total((i) => i.fullPallets)} note={total((i) => i.picos) > 0 ? `+ ${t("td.pico_p", { n: total((i) => i.picos) })}` : undefined} label={t("cd.palletsStored")} lang={lang} />
          <Stat value={total((i) => i.free)} label={t("cd.free")} lang={lang} />
          <Stat value={total((i) => i.reserved + i.picked)} label={t("cd.promised")} lang={lang} />
          <Stat value={total((i) => i.out30)} label={t("cd.outIn", { d: ROTATION_DAYS })} lang={lang} />
        </div>
      </header>

      <section className="dock-card mt-6 overflow-x-auto bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="cond border-b-[1.5px] border-dock-ink text-left text-[11px] text-dock-ink/55">
              <th className="px-4 py-2">{t("cd.col.item")}</th>
              <th className="px-2 py-2 text-right">{t("cd.col.pallets")}</th>
              <th className="px-2 py-2 text-right">{t("cd.col.free")}</th>
              <th className="px-2 py-2 text-right">{t("cd.col.promised")}</th>
              <th className="px-2 py-2 text-right">{t("cd.col.out", { d: ROTATION_DAYS })}</th>
              <th className="px-2 py-2">{t("cd.col.lasts")}</th>
              <th className="px-2 py-2">{t("cd.col.lots")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dock-line">
            {items.map((i) => {
              const c = cover(i.weeksCover, i.free, t);
              return (
                <tr key={i.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <span className="mono block font-semibold">{i.sku}</span>
                    <span className="block text-xs text-dock-ink/60">
                      {i.description} · {t("cd.perPallet", { n: i.unitsPerPallet, unit: unitWord(i.unit) })}
                      {i.warehouses.length > 0 && ` · ${i.warehouses.join(", ")}`}
                    </span>
                  </td>
                  <td className="mono px-2 py-2.5 text-right">
                    {i.fullPallets}
                    {i.picos > 0 && <Pico text={t("cd.pico", { n: fmtNumber(i.looseUnits, lang), unit: unitWord(i.unit) })} />}
                  </td>
                  <td className="mono px-2 py-2.5 text-right font-semibold">
                    {i.freeFull}
                    {i.freeLoose > 0 && <Pico text={t("cd.pico", { n: fmtNumber(i.freeLoose, lang), unit: unitWord(i.unit) })} />}
                  </td>
                  <td className="mono px-2 py-2.5 text-right text-dock-ink/60">{i.reserved + i.picked || "—"}</td>
                  <td className="mono px-2 py-2.5 text-right text-dock-ink/60">{i.out30 || "—"}</td>
                  <td className={`px-2 py-2.5 text-xs ${c.tone}`}>{c.text}</td>
                  <td className="px-2 py-2.5">
                    {i.lots.length === 0 ? (
                      <span className="text-xs text-dock-ink/40">{i.tracksLot ? t("cd.noneInStock") : t("cd.noLotTracking")}</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {i.lots.map((l) => {
                          const d = l.expiresAt ? daysLeft(l.expiresAt) : null;
                          return (
                            <Link
                              key={l.lot}
                              href={`/office/trace?lot=${encodeURIComponent(l.lot)}`}
                              title={l.expiresAt ? t("cd.bestBefore", { date: fmtDate(l.expiresAt) }) : t("cd.traceLot")}
                              className={`mono border px-1.5 text-[11px] hover:bg-dock-yellow ${d !== null && d <= 30 ? "border-dock-red bg-dock-red text-white" : "border-dock-line"}`}
                            >
                              {l.lot} · {l.pallets}
                              {d !== null && d <= 90 && ` · ${d} d`}
                            </Link>
                          );
                        })}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {tariff && (
        <section className="dock-card mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 bg-white p-4">
          <div className="min-w-0 flex-1 basis-72">
            <h2 className="cond text-xs text-dock-ink/55">{t("cd.billingTitle")}</h2>
            <p className="mt-1 text-sm text-dock-ink/70">{t(`bi.help.${tariff.partialPallets}` as "bi.help.FULL")}</p>
            <p className="mt-1 text-xs text-dock-ink/55">
              {t("cd.billingNote")}{" "}
              <Link href="/office/billing" className="underline underline-offset-2">{t("bi.title")}</Link>
            </p>
          </div>
          <PartialRule clientId={client.id} value={tariff.partialPallets} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="cond mb-3 text-sm text-dock-ink/60">{t("cd.latest")}</h2>
        <ul className="dock-card divide-y divide-dock-line bg-white">
          {movements.map((m) => (
            <li key={m.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
              {m.kind === "in" ? <ArrowDownToLine size={15} className="text-dock-ink/50" /> : <ArrowUpFromLine size={15} className="text-dock-ink/50" />}
              <span className="mono w-24 text-xs text-dock-ink/55">{fmtDate(m.date)}</span>
              <span className="mono w-14 text-xs font-semibold">Nº {m.number}</span>
              <span className="min-w-0 flex-1 truncate">
                {m.what} <span className="text-dock-ink/50">· {m.kind === "in" ? t("cd.from") : t("cd.to")} {m.who}</span>
              </span>
              <span className="cond text-[11px] text-dock-ink/60">
                {m.kind === "in" ? t(`st.in.${m.status}` as "st.in.CLOSED") : t(`st.out.${m.status}` as "st.out.CLOSED")}
              </span>
              {m.receipt && (
                <Link href={`/receipts/${m.receipt}`} className="cond flex items-center gap-1 text-[11px] underline">
                  <FileText size={12} /> {t("cd.receipt")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

/** The loose part of a stock figure: "+ pico 12 boxes". */
function Pico({ text }: { text: string }) {
  return <span className="block whitespace-nowrap text-[11px] font-normal text-dock-ink/55">{text}</span>;
}

function Stat({ value, label, note, lang }: { value: number; label: string; note?: string; lang: "en" | "es" }) {
  return (
    <span className="dock-card bg-white px-4 py-2">
      <span className="mono block text-2xl font-semibold leading-none">
        {fmtNumber(value, lang)}
        {note && <span className="ml-1.5 text-xs font-normal text-dock-ink/55">{note}</span>}
      </span>
      <span className="cond block text-[10px] text-dock-ink/50">{label}</span>
    </span>
  );
}
