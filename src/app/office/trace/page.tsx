import Link from "next/link";
import { ArrowDownToLine, ArrowRight, ArrowUpFromLine, CheckCircle2, FileText, Search, TriangleAlert, Warehouse } from "lucide-react";
import { CopyNotice } from "@/components/alerts/copy-notice";
import { firstName, fmtDate, fmtNumber } from "@/lib/format";
import { findLots, findUntrackedItems, lotsAtRisk, traceLot, type LotOption, type LotTrace, type UntrackedItem } from "@/lib/trace";
import { getT } from "@/lib/i18n/server";
import { requireRole } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function TracePage({ searchParams }: PageProps<"/office/trace">) {
  await requireRole("office");
  const { t } = await getT();
  const { lot, q } = await searchParams;
  const query = typeof q === "string" ? q.trim() : "";
  const lotCode = typeof lot === "string" ? lot : null;

  let trace = lotCode ? await traceLot(lotCode) : null;
  let options: LotOption[] = [];
  let untracked: UntrackedItem[] = [];
  if (!trace && query) {
    [options, untracked] = await Promise.all([findLots(query), findUntrackedItems(query)]);
    // One exact match: go straight to it.
    const exact = options.find((o) => o.lot.toLowerCase() === query.toLowerCase());
    if (exact || options.length === 1) trace = await traceLot((exact ?? options[0]).lot);
  }
  const suggestions = !trace && !query ? await lotsAtRisk() : [];

  return (
    <main className="mx-auto max-w-6xl px-8 py-8">
      <header>
        <p className="cond text-sm text-dock-ink/50">{t("tr.kicker")}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">{t("tr.title")}</h1>
      </header>

      <form className="mt-6 flex max-w-xl gap-2">
        <label className="dock-card flex flex-1 items-center gap-2 bg-white px-3">
          <Search size={16} className="text-dock-ink/40" />
          <input name="q" defaultValue={trace?.lot ?? query} placeholder={t("tr.placeholder")} aria-label={t("tr.placeholder")} className="h-10 flex-1 bg-transparent text-sm outline-none" />
        </label>
        <button className="cond bg-dock-ink px-5 text-sm text-dock-yellow">{t("tr.trace")}</button>
      </form>

      {!trace && lotCode && !query && <p className="mt-6 text-sm text-dock-ink/60">{t("tr.noLot", { lot: lotCode })}</p>}
      {!trace && query && options.length === 0 && untracked.length === 0 && <p className="mt-6 text-sm text-dock-ink/60">{t("tr.noMatch", { q: query })}</p>}
      {!trace && untracked.length > 0 && <UntrackedNote items={untracked} lotMatches={options.length} />}
      {!trace && options.length > 1 && (
        <LotList title={t("tr.lotsMatch", { n: options.length, q: query, more: options.length > 24 ? t("tr.first24") : "" })} lots={options.slice(0, 24)} />
      )}
      {suggestions.length > 0 && <LotList title={t("tr.recall")} lots={suggestions} />}
      {trace && <Trail t={trace} />}
    </main>
  );
}

/** The search hit an article that has no lot: say so plainly instead of "no lot matches", and point to where its stock lives. */
async function UntrackedNote({ items, lotMatches }: { items: UntrackedItem[]; lotMatches: number }) {
  const { t } = await getT();
  return (
    <section className="mt-6 space-y-2" aria-label={t("tr.untrackedAria")}>
      {items.map((i) => (
        <p key={`${i.clientCode}-${i.sku}`} className="dock-card border-l-4 border-l-dock-yellow bg-white px-4 py-3 text-sm">
          <span className="mono font-semibold">{i.sku}</span> {t("tr.untracked")}{lotMatches === 0 ? "" : t("tr.untrackedList")}{t("tr.untrackedSee")}{" "}
          <Link href={`/office/clients/${i.clientCode}`} className="cond font-semibold underline">
            {t("tr.customerCard", { client: i.client })} <ArrowRight size={13} className="inline" aria-hidden />
          </Link>
        </p>
      ))}
    </section>
  );
}

async function LotList({ title, lots }: { title: string; lots: LotOption[] }) {
  const { t } = await getT();
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
                {l.client} · {t("tr.in", { date: fmtDate(l.date) })}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Trail({ t }: { t: LotTrace }) {
  const { t: tr } = await getT();
  const first = firstName(t.contact);
  const notice = [
    `Hola${first ? ` ${first}` : ""}, os pasamos la trazabilidad del lote ${t.lot} de ${t.sku} (${t.description}).`,
    `Entrada: ${t.came.map((c) => `${c.text} el ${fmtDate(c.date)} (entrada Nº ${c.number}${c.docRef ? `, albarán ${c.docRef}` : ""})`).join("; ") || "sin registro"}.`,
    t.went.length
      ? `Salidas: ${t.went.map((w) => `${w.text} el ${fmtDate(w.date)} a ${w.consignee}${w.city ? ` (${w.city})` : ""}, salida Nº ${w.number}`).join("; ")}.`
      : "No ha salido ningún palé de este lote.",
    t.totals.here ? `Quedan ${t.totals.hereText} en nuestro almacén; si hay que retirarlos, los apartamos hoy mismo.` : "No queda ningún palé en el almacén.",
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
            {t.expiresAt && tr("tr.bestBefore", { date: fmtDate(t.expiresAt) })}
          </span>
        </span>
        <span className={`cond ml-auto flex items-center gap-1.5 text-sm ${t.balanced ? "text-dock-yellow" : "text-dock-red"}`}>
          {t.balanced ? <CheckCircle2 size={16} /> : <TriangleAlert size={16} />}
          {tr("tr.balance", { in: t.totals.in, out: t.totals.out, here: t.totals.here })}{t.balanced ? "" : tr("tr.noAdd")}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
        <Column icon={ArrowDownToLine} title={tr("tr.cameIn")} count={t.totals.pallets.in}>
          {t.came.map((c) => (
            <Card key={c.inboundId}>
              <p className="flex items-center justify-between">
                <span className="mono text-xs font-semibold">Nº {c.number}</span>
                <span className="mono text-xs text-dock-ink/55">{fmtDate(c.date)}</span>
              </p>
              <p className="mt-1 font-semibold">{tr("tr.palletsUnits", { p: c.pallets, u: fmtNumber(c.units) })}</p>
              <p className="text-xs text-dock-ink/60">
                {c.supplier ?? "—"}
                {c.docRef && tr("tr.note", { ref: c.docRef })}
              </p>
              <p className="text-xs text-dock-ink/60">
                {[c.carrier, c.plate, c.warehouse && tr("tr.unloadedAt", { wh: c.warehouse })].filter(Boolean).join(" · ")}
              </p>
              {c.codes.length > 0 && <Codes list={c.codes.map((code) => ({ code, from: null }))} />}
              {c.incident && <p className="mt-1 bg-dock-red px-1.5 text-xs text-white">{c.incident}</p>}
              {c.receipt && (
                <Link href={`/receipts/${c.inboundId}`} className="cond mt-2 inline-flex items-center gap-1 text-[11px] underline">
                  <FileText size={12} /> {tr("tr.receipt")}
                </Link>
              )}
            </Card>
          ))}
        </Column>
        <Arrow />
        <Column icon={Warehouse} title={tr("tr.inBuilding")} count={t.totals.pallets.here}>
          {t.here.length === 0 && <p className="text-sm text-dock-ink/50">{tr("tr.nothingLeft")}</p>}
          {t.here.map((h) => (
            <Card key={`${h.warehouse}-${h.area}-${h.outbound}`}>
              <p className="font-semibold">
                {tr("tr.palletsAt", { n: h.pallets, area: tr(`tr.area.${h.area}` as "tr.area.rack"), wh: h.warehouse })}
              </p>
              {h.outbound && <p className="text-xs text-dock-ink/60">{tr("tr.pickedFor", { n: h.outbound })}</p>}
              <p className="mono mt-1 text-[11px] leading-relaxed text-dock-ink/60">{h.locations.join(" · ")}</p>
              {h.codes.length > 0 && <Codes list={h.codes} />}
              <Link href={`/office/warehouse?w=${h.warehouse}&color=expiry`} className="cond mt-2 inline-flex items-center gap-1 text-[11px] underline">
                {tr("tr.see3d")}
              </Link>
            </Card>
          ))}
        </Column>
        <Arrow />
        <Column icon={ArrowUpFromLine} title={tr("tr.wentOut")} count={t.totals.pallets.out}>
          {t.went.length === 0 && <p className="text-sm text-dock-ink/50">{tr("tr.noneOut")}</p>}
          {t.went.map((w) => (
            <Card key={w.outboundId}>
              <p className="flex items-center justify-between">
                <span className="mono text-xs font-semibold">Nº {w.number}</span>
                <span className="mono text-xs text-dock-ink/55">{fmtDate(w.date)}</span>
              </p>
              <p className="mt-1 font-semibold">{w.consignee}</p>
              <p className="text-xs text-dock-ink/60">
                {tr("tr.palletsUnits", { p: w.pallets, u: fmtNumber(w.units) })}{w.city && ` · ${w.city}`}
              </p>
              <p className="text-xs text-dock-ink/60">{[w.carrier, w.docRef && tr("tr.order", { ref: w.docRef })].filter(Boolean).join(" · ")}</p>
              {w.codes.length > 0 && <Codes list={w.codes} />}
            </Card>
          ))}
        </Column>
      </div>

      <div className="dock-card bg-white p-4">
        <p className="cond text-xs text-dock-ink/55">{tr("tr.forCustomer")}</p>
        <p className="mt-1 text-sm text-dock-ink/70">{tr("tr.forCustomerText")}</p>
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

/** Pallet IDs; one that was made up from boxes taken off another pallet says where they came from. */
async function Codes({ list }: { list: { code: string; from: string | null }[] }) {
  const { t } = await getT();
  return (
    <ul className="mono mt-1 space-y-0.5 text-[11px] text-dock-ink/70" aria-label={t("tr.ids")}>
      {list.slice(0, 12).map((c) => (
        <li key={c.code}>
          <span className="font-semibold text-dock-ink">{c.code}</span>
          {c.from && <span className="text-dock-ink/55">{t("tr.fromPallet", { code: c.from })}</span>}
        </li>
      ))}
      {list.length > 12 && <li className="text-dock-ink/50">{t("tr.andMore", { n: list.length - 12 })}</li>}
    </ul>
  );
}
