import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, CheckCircle2, FileText, Search, TriangleAlert, Warehouse } from "lucide-react";
import { CopyNotice } from "@/components/alerts/copy-notice";
import { fmtDate, fmtNumber } from "@/lib/format";
import { findLots, lotsAtRisk, traceLot, type LotOption, type LotTrace } from "@/lib/trace";

export const dynamic = "force-dynamic";

const AREA = { rack: "in the racks", receiving: "in the receiving lane", dispatch: "in the dispatch lane" };

export default async function TracePage({ searchParams }: PageProps<"/office/trace">) {
  const { lot, q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  const lotCode = typeof lot === "string" ? lot : null;

  let trace = lotCode ? await traceLot(lotCode) : null;
  let options: LotOption[] = [];
  if (!trace && query) {
    options = await findLots(query);
    // One exact match: go straight to it.
    const exact = options.find((o) => o.lot.toLowerCase() === query.trim().toLowerCase());
    if (exact || options.length === 1) trace = await traceLot((exact ?? options[0]).lot);
  }
  const suggestions = !trace && !query ? await lotsAtRisk() : [];

  return (
    <main className="mx-auto max-w-6xl px-8 py-8">
      <header>
        <p className="cond text-sm text-dock-ink/50">Recall-ready: every pallet, from the truck that brought it to the truck that took it</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Lot trace</h1>
      </header>

      <form className="mt-6 flex max-w-xl gap-2">
        <label className="dock-card flex flex-1 items-center gap-2 bg-white px-3">
          <Search size={16} className="text-dock-ink/40" />
          <input name="q" defaultValue={trace?.lot ?? query} placeholder="Lot code or SKU, e.g. L2634 or HORCH-1L" className="h-10 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <button className="cond bg-dock-ink px-5 text-sm text-dock-yellow">Trace</button>
      </form>

      {!trace && query && options.length === 0 && <p className="mt-6 text-sm text-dock-ink/60">No lot matches “{query}”.</p>}
      {!trace && options.length > 1 && <LotList title={`${options.length} lots match “${query}”`} lots={options} />}
      {suggestions.length > 0 && <LotList title="Lots a recall would hit first (soonest to expire, still in the building)" lots={suggestions} />}
      {trace && <Trail t={trace} />}
    </main>
  );
}

function LotList({ title, lots }: { title: string; lots: LotOption[] }) {
  return (
    <section className="mt-8">
      <h2 className="cond mb-3 text-sm text-dock-ink/60">{title}</h2>
      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {lots.map((l) => (
          <li key={l.lot}>
            <Link href={`/office/trace?lot=${encodeURIComponent(l.lot)}`} className="dock-card block bg-white px-4 py-3 hover:bg-dock-yellow">
              <span className="mono block text-sm font-semibold">{l.lot}</span>
              <span className="block truncate text-sm">
                {l.sku} · {l.description}
              </span>
              <span className="block text-xs text-dock-ink/55">
                {l.client} · in {fmtDate(l.date)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Trail({ t }: { t: LotTrace }) {
  const first = t.contact?.split(" ")[0];
  const notice = [
    `Hola${first ? ` ${first}` : ""}, os pasamos la trazabilidad del lote ${t.lot} de ${t.sku} (${t.description}).`,
    `Entrada: ${t.came.map((c) => `${c.pallets} palés el ${fmtDate(c.date)} (entrada Nº ${c.number}${c.docRef ? `, albarán ${c.docRef}` : ""})`).join("; ") || "sin registro"}.`,
    t.went.length
      ? `Salidas: ${t.went.map((w) => `${w.pallets} palés el ${fmtDate(w.date)} a ${w.consignee}${w.city ? ` (${w.city})` : ""}, salida Nº ${w.number}`).join("; ")}.`
      : "No ha salido ningún palé de este lote.",
    t.totals.here ? `Quedan ${t.totals.here} palés en nuestro almacén; si hay que retirarlos, los apartamos hoy mismo.` : "No queda ningún palé en el almacén.",
    "Un saludo.",
  ].join(" ");

  return (
    <section className="mt-8 space-y-5">
      <div className="dock-card flex flex-wrap items-center gap-x-6 gap-y-2 bg-dock-ink px-5 py-4 text-white">
        <span className="mono text-2xl font-semibold text-dock-yellow">{t.lot}</span>
        <span>
          <span className="block font-semibold">
            {t.sku} · {t.description}
          </span>
          <span className="block text-sm text-white/60">
            {t.client}
            {t.expiresAt && ` · best before ${fmtDate(t.expiresAt)}`}
          </span>
        </span>
        <span className={`cond ml-auto flex items-center gap-1.5 text-sm ${t.balanced ? "text-dock-yellow" : "text-dock-red"}`}>
          {t.balanced ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
          {t.totals.in} in = {t.totals.out} out + {t.totals.here} here{t.balanced ? "" : " · does not add up"}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <Column icon={ArrowDownToLine} title="Came in" count={t.totals.in}>
          {t.came.map((c) => (
            <Card key={c.inboundId}>
              <p className="flex items-center justify-between">
                <span className="mono text-xs font-semibold">Nº {c.number}</span>
                <span className="mono text-xs text-dock-ink/55">{fmtDate(c.date)}</span>
              </p>
              <p className="mt-1 font-semibold">{c.pallets} pallets · {fmtNumber(c.units)} units</p>
              <p className="text-xs text-dock-ink/60">
                {c.supplier ?? "—"}
                {c.docRef && ` · note ${c.docRef}`}
              </p>
              <p className="text-xs text-dock-ink/60">
                {[c.carrier, c.plate, c.warehouse && `unloaded at ${c.warehouse}`].filter(Boolean).join(" · ")}
              </p>
              {c.incident && <p className="mt-1 bg-dock-red px-1.5 text-xs text-white">{c.incident}</p>}
              {c.receipt && (
                <Link href={`/receipts/${c.inboundId}`} className="cond mt-2 inline-flex items-center gap-1 text-[11px] underline">
                  <FileText size={12} /> Dock receipt
                </Link>
              )}
            </Card>
          ))}
        </Column>
        <Arrow />
        <Column icon={Warehouse} title="In the building" count={t.totals.here}>
          {t.here.length === 0 && <p className="text-sm text-dock-ink/50">Nothing left.</p>}
          {t.here.map((h) => (
            <Card key={`${h.warehouse}-${h.area}-${h.outbound}`}>
              <p className="font-semibold">
                {h.pallets} pallets {AREA[h.area]} of {h.warehouse}
              </p>
              {h.outbound && <p className="text-xs text-dock-ink/60">Picked for outbound Nº {h.outbound}</p>}
              <p className="mono mt-1 text-[11px] leading-relaxed text-dock-ink/60">{h.locations.join(" · ")}</p>
              <Link href={`/office/warehouse?w=${h.warehouse}&color=expiry`} className="cond mt-2 inline-flex items-center gap-1 text-[11px] underline">
                See them in 3D
              </Link>
            </Card>
          ))}
        </Column>
        <Arrow />
        <Column icon={ArrowUpFromLine} title="Went out" count={t.totals.out}>
          {t.went.length === 0 && <p className="text-sm text-dock-ink/50">No pallet of this lot has left yet.</p>}
          {t.went.map((w) => (
            <Card key={w.outboundId}>
              <p className="flex items-center justify-between">
                <span className="mono text-xs font-semibold">Nº {w.number}</span>
                <span className="mono text-xs text-dock-ink/55">{fmtDate(w.date)}</span>
              </p>
              <p className="mt-1 font-semibold">{w.consignee}</p>
              <p className="text-xs text-dock-ink/60">
                {w.pallets} pallets · {fmtNumber(w.units)} units{w.city && ` · ${w.city}`}
              </p>
              <p className="text-xs text-dock-ink/60">{[w.carrier, w.docRef && `order ${w.docRef}`].filter(Boolean).join(" · ")}</p>
            </Card>
          ))}
        </Column>
      </div>

      <div className="dock-card bg-white p-4">
        <p className="cond text-xs text-dock-ink/55">For the customer</p>
        <p className="mt-1 text-sm text-dock-ink/70">The full trail in one message, ready to send if they ask, or if there is a recall.</p>
        <div className="mt-2">
          <CopyNotice text={notice} />
        </div>
      </div>
    </section>
  );
}

function Column({ icon: Icon, title, count, children }: { icon: typeof Warehouse; title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-3">
      <h2 className="cond flex items-center gap-2 text-sm">
        <Icon size={16} /> {title}
        <span className="mono ml-auto bg-dock-ink px-2 text-xs text-dock-yellow">{count}</span>
      </h2>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="dock-card bg-white p-3 text-sm">{children}</div>;
}

function Arrow() {
  return (
    <div className="hidden items-center lg:flex">
      <ArrowRight size={22} className="text-dock-ink/30" />
    </div>
  );
}
