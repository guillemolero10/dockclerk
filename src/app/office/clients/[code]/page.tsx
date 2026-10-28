import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, FileText } from "lucide-react";
import { PartialRule } from "@/components/billing/partial-rule";
import { RULE_HELP } from "@/lib/billing/view";
import { customerDetail, ROTATION_DAYS } from "@/lib/clients";
import { db } from "@/lib/db";
import { fmtDate, fmtNumber } from "@/lib/format";
import { INBOUND_STATUS, OUTBOUND_STATUS } from "@/lib/labels";
import { clientColor } from "@/lib/warehouse/palette";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

const DAY = 24 * 60 * 60 * 1000;
const UNIT: Record<string, string> = { BOX: "boxes", BAG: "bags", PALLET: "units" };
const daysLeft = (d: Date) => Math.ceil((d.getTime() - Date.now()) / DAY);

/** How long the free stock lasts at last month's pace. */
function cover(weeks: number | null, free: number) {
  if (free === 0) return { text: "none free", tone: "text-dock-red" };
  if (weeks === null) return { text: "no movement", tone: "text-dock-ink/45" };
  if (weeks < 1) return { text: `${Math.round(weeks * 7)} days`, tone: "text-dock-red font-semibold" };
  return { text: `${weeks < 10 ? weeks.toFixed(1) : Math.round(weeks)} weeks`, tone: weeks > 12 ? "text-dock-ink/45" : "" };
}

export default async function ClientPage({ params }: PageProps<"/office/clients/[code]">) {
  await requireRole("office");
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
        <ArrowLeft size={13} /> Customers
      </Link>
      <header className="mt-2 flex flex-wrap items-end gap-x-6 gap-y-3">
        <span className="h-10 w-2" style={{ background: color }} />
        <div>
          <p className="mono text-xs text-dock-ink/50">{client.code}</p>
          <h1 className="text-3xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-dock-ink/60">{[client.contact, client.email, client.phone].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="flex flex-wrap gap-3 sm:ml-auto">
          <Stat value={total((i) => i.fullPallets)} note={total((i) => i.picos) > 0 ? `+ ${total((i) => i.picos)} pico${total((i) => i.picos) === 1 ? "" : "s"}` : undefined} label="pallets stored" />
          <Stat value={total((i) => i.free)} label="free to ship" />
          <Stat value={total((i) => i.reserved + i.picked)} label="promised" />
          <Stat value={total((i) => i.out30)} label={`out in ${ROTATION_DAYS} days`} />
        </div>
      </header>

      <section className="dock-card mt-6 overflow-x-auto bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="cond border-b-[1.5px] border-dock-ink text-left text-[11px] text-dock-ink/55">
              <th className="px-4 py-2">Item</th>
              <th className="px-2 py-2 text-right">Pallets</th>
              <th className="px-2 py-2 text-right">Free</th>
              <th className="px-2 py-2 text-right">Promised</th>
              <th className="px-2 py-2 text-right">Out · {ROTATION_DAYS} d</th>
              <th className="px-2 py-2">Lasts</th>
              <th className="px-2 py-2">Lots (first to expire first)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-dock-line">
            {items.map((i) => {
              const c = cover(i.weeksCover, i.free);
              return (
                <tr key={i.id} className="align-top">
                  <td className="px-4 py-2.5">
                    <span className="mono block font-semibold">{i.sku}</span>
                    <span className="block text-xs text-dock-ink/60">
                      {i.description} · {i.unitsPerPallet} {UNIT[i.unit]}/pallet
                      {i.warehouses.length > 0 && ` · ${i.warehouses.join(", ")}`}
                    </span>
                  </td>
                  <td className="mono px-2 py-2.5 text-right">
                    {i.fullPallets}
                    {i.picos > 0 && <Pico units={i.looseUnits} unit={UNIT[i.unit]} />}
                  </td>
                  <td className="mono px-2 py-2.5 text-right font-semibold">
                    {i.freeFull}
                    {i.freeLoose > 0 && <Pico units={i.freeLoose} unit={UNIT[i.unit]} />}
                  </td>
                  <td className="mono px-2 py-2.5 text-right text-dock-ink/60">{i.reserved + i.picked || "—"}</td>
                  <td className="mono px-2 py-2.5 text-right text-dock-ink/60">{i.out30 || "—"}</td>
                  <td className={`px-2 py-2.5 text-xs ${c.tone}`}>{c.text}</td>
                  <td className="px-2 py-2.5">
                    {i.lots.length === 0 ? (
                      <span className="text-xs text-dock-ink/40">{i.tracksLot ? "none in stock" : "no lot tracking"}</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {i.lots.map((l) => {
                          const d = l.expiresAt ? daysLeft(l.expiresAt) : null;
                          return (
                            <Link
                              key={l.lot}
                              href={`/office/trace?lot=${encodeURIComponent(l.lot)}`}
                              title={l.expiresAt ? `Best before ${fmtDate(l.expiresAt)}` : "Trace this lot"}
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
            <h2 className="cond text-xs text-dock-ink/55">Month-end billing · how loose pallets are charged</h2>
            <p className="mt-1 text-sm text-dock-ink/70">{RULE_HELP[tariff.partialPallets]}</p>
            <p className="mt-1 text-xs text-dock-ink/55">
              Applies to the next pre-invoice you prepare. Approved ones keep the rule they were made with.{" "}
              <Link href="/office/billing" className="underline underline-offset-2">Billing</Link>
            </p>
          </div>
          <PartialRule clientId={client.id} value={tariff.partialPallets} />
        </section>
      )}

      <section className="mt-8">
        <h2 className="cond mb-3 text-sm text-dock-ink/60">Latest movements</h2>
        <ul className="dock-card divide-y divide-dock-line bg-white">
          {movements.map((m) => (
            <li key={m.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-2.5 text-sm">
              {m.kind === "in" ? <ArrowDownToLine size={15} className="text-dock-ink/50" /> : <ArrowUpFromLine size={15} className="text-dock-ink/50" />}
              <span className="mono w-24 text-xs text-dock-ink/55">{fmtDate(m.date)}</span>
              <span className="mono w-14 text-xs font-semibold">Nº {m.number}</span>
              <span className="min-w-0 flex-1 truncate">
                {m.what} <span className="text-dock-ink/50">· {m.kind === "in" ? "from" : "to"} {m.who}</span>
              </span>
              <span className="cond text-[11px] text-dock-ink/60">
                {m.kind === "in" ? INBOUND_STATUS[m.status as keyof typeof INBOUND_STATUS].label : OUTBOUND_STATUS[m.status as keyof typeof OUTBOUND_STATUS].label}
              </span>
              {m.receipt && (
                <Link href={`/receipts/${m.receipt}`} className="cond flex items-center gap-1 text-[11px] underline">
                  <FileText size={12} /> Receipt
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
function Pico({ units, unit }: { units: number; unit: string }) {
  return <span className="block whitespace-nowrap text-[11px] font-normal text-dock-ink/55">+ pico {fmtNumber(units)} {unit}</span>;
}

function Stat({ value, label, note }: { value: number; label: string; note?: string }) {
  return (
    <span className="dock-card bg-white px-4 py-2">
      <span className="mono block text-2xl font-semibold leading-none">
        {fmtNumber(value)}
        {note && <span className="ml-1.5 text-xs font-normal text-dock-ink/55">{note}</span>}
      </span>
      <span className="cond block text-[10px] text-dock-ink/50">{label}</span>
    </span>
  );
}
