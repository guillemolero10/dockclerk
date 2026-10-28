// Checks for the billing engine (src/lib/billing). Pure: no database, no keys, no network.
//
//   npx tsx scripts/billing-check.ts
//
// Exit code 1 if any case fails, so it can run before recording the video.

import { billPeriod, type BillResult, type HandlingInput, type TariffInput } from "../src/lib/billing/compute";
import { dayNumber, dayOfYmd, period } from "../src/lib/billing/calendar";
import { buildStays, type PalletKind, type Stay } from "../src/lib/billing/stays";

const PER_PALLET = 40;

const tariff = (over: Partial<TariffInput> = {}): TariffInput => ({
  inPerPallet: 1, outPerPallet: 1, storagePrice: 0.1, storageByType: { AMERICAN: 0.2 },
  factorPct: 100, vatPct: 21, partialPallets: "FRACTION", ...over,
});

let inboundSeq = 0;
/** `n` stays of `units` each, all from one delivery note. out = day each leaves (null = still inside). */
function rows(n: number, o: { sku?: string; type?: PalletKind; inYmd: string; outYmd?: string | null; units?: number; inbound?: number }): Stay[] {
  const inbound = o.inbound ?? ++inboundSeq;
  return Array.from({ length: n }, () => ({
    inboundId: `in${inbound}`, inboundNumber: inbound, docRef: null, itemId: o.sku ?? "SKU", sku: o.sku ?? "SKU", lot: "L1",
    palletType: o.type ?? "EURO", units: o.units ?? PER_PALLET, perPallet: PER_PALLET,
    inDay: dayOfYmd(o.inYmd), inKnown: true, outDay: o.outYmd ? dayOfYmd(o.outYmd) : null, outboundNumber: o.outYmd ? 900 : null,
  }));
}

const bill = (stays: Stay[], ymd: string, t = tariff(), handling: HandlingInput[] = []) =>
  billPeriod({ stays, handling, tariff: t, period: period(ymd), });
const line = (r: BillResult, concept: string, labelPart = "") => r.lines.find((l) => l.concept === concept && l.label.includes(labelPart));
const eur = (cents: number) => (cents / 100).toFixed(2);

/** The same storage counted the slow way: day by day, how many pallets were inside. */
function byDays(stays: Stay[], ymd: string) {
  const p = period(ymd);
  let total = 0;
  for (let d = p.start; d < p.end; d++) for (const s of stays) if (s.inDay <= d && (s.outDay === null || d < s.outDay)) total += s.units / s.perPallet;
  return total;
}

type Case = { name: string; run: () => string | null };
const junePallets = () => [...rows(6, { sku: "A", inYmd: "2026-05-15", inbound: 1 }), ...rows(4, { sku: "A", inYmd: "2026-05-15", outYmd: "2026-06-21", inbound: 1 }), ...rows(5, { sku: "B", type: "AMERICAN", inYmd: "2026-06-11", inbound: 2 })];
const day21: HandlingInput = { day: dayOfYmd("2026-06-21"), pallets: 2, unitPrice: 10, replacesExit: true };

// B9: one pallet of 40 inside before the month, 20 boxes leave on day 10 and 20 stay (a loose pallet).
const pico = () => [...rows(1, { inYmd: "2026-05-01", units: 20, inbound: 9 }), ...rows(1, { inYmd: "2026-05-01", units: 20, outYmd: "2026-06-10", inbound: 9 })];

const CASES: Case[] = [
  {
    name: "B1 full month (June)",
    run() {
      const r = bill(junePallets(), "2026-06");
      const eu = line(r, "storage", "euro"); const am = line(r, "storage", "american");
      const bad = [
        line(r, "in")?.quantity !== 5 || line(r, "in")?.cents !== 500 ? "inbound" : "",
        line(r, "out")?.quantity !== 4 || line(r, "out")?.cents !== 400 ? "outbound" : "",
        eu?.quantity !== 260 || eu.cents !== 2600 ? `euro ${eu?.quantity}` : "",
        am?.quantity !== 100 || am.cents !== 2000 ? `american ${am?.quantity}` : "",
        r.lines.filter((l) => l.concept === "storage").length !== 2 ? "not 2 storage lines" : "",
        r.baseCents !== 5500 || r.vatCents !== 1155 || r.totalCents !== 6655 ? `totals ${r.baseCents}/${r.vatCents}/${r.totalCents}` : "",
        !r.checks.detailMatches ? "detail" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B2 handling instead of exit",
    run() {
      const r = bill(junePallets(), "2026-06", tariff(), [day21]);
      const bad = [
        line(r, "out")?.quantity !== 2 || line(r, "out")?.cents !== 200 ? `outbound ${line(r, "out")?.quantity}` : "",
        line(r, "handling")?.cents !== 2000 ? "handling" : "",
        r.baseCents !== 7300 || r.vatCents !== 1533 || r.totalCents !== 8833 ? `totals ${eur(r.baseCents)}/${eur(r.vatCents)}/${eur(r.totalCents)}` : "",
        !r.checks.detailMatches ? "detail" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  { name: "B3 without VAT", run() { const r = bill(junePallets(), "2026-06", tariff({ vatPct: 0 })); return r.totalCents === r.baseCents && r.baseCents === 5500 ? null : `total ${r.totalCents} base ${r.baseCents}`; } },
  {
    name: "B4 partial exits (24 pallets, 2 leave on 5 days)",
    run() {
      const stays = [...rows(14, { inYmd: "2026-06-02", inbound: 4 }), ...["2026-06-08", "2026-06-11", "2026-06-15", "2026-06-18", "2026-06-22"].flatMap((d) => rows(2, { inYmd: "2026-06-02", outYmd: d, inbound: 4 }))];
      const r = bill(stays, "2026-06");
      const slow = byDays(stays, "2026-06");
      const bad = [
        stays.filter((s) => s.outDay === null).length !== 14 ? "not 14 left" : "",
        r.palletDays !== 534 || slow !== 534 ? `pallet-days ${r.palletDays} (by days ${slow})` : "",
        line(r, "storage")?.cents !== 5340 ? "storage 53.40" : "",
        line(r, "in")?.quantity !== 24 || line(r, "out")?.quantity !== 10 ? "in/out" : "",
        !r.checks.detailMatches ? "detail" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B5 23 pallets: 21 with no exit + 2 leaving on 08/06 (May)",
    run() {
      const stays = [...rows(21, { inYmd: "2026-05-20", inbound: 1043 }), ...rows(2, { inYmd: "2026-05-20", outYmd: "2026-06-08", inbound: 1043 })];
      const r = bill(stays, "2026-05");
      const open = r.detail.find((d) => d.concept === "storage" && d.exitDate === null);
      const leaving = r.detail.find((d) => d.concept === "storage" && d.exitDate === "2026-06-08");
      console.log(`      B5: ${r.palletDays} pallet-days, ${eur(line(r, "storage")!.cents)} EUR; rows: ${open?.pallets} x ${open?.days} no exit | ${leaving?.pallets} x ${leaving?.days} leave ${leaving?.exitDate}; outbound ${line(r, "out")?.quantity}; total ${eur(r.totalCents)}`);
      const bad = [
        r.palletDays !== 276 || line(r, "storage")?.cents !== 2760 ? `pallet-days ${r.palletDays}` : "",
        open?.pallets !== 21 || open.days !== 12 ? "row 21 x 12" : "",
        leaving?.pallets !== 2 || leaving.days !== 12 ? "row 2 x 12" : "",
        line(r, "out")?.quantity !== 0 ? "outbound is not 0" : "",
        line(r, "in")?.quantity !== 23 ? "inbound" : "",
        !r.checks.detailMatches ? "detail" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B6 the same 23 pallets in June",
    run() {
      const stays = [...rows(21, { inYmd: "2026-05-20", inbound: 1043 }), ...rows(2, { inYmd: "2026-05-20", outYmd: "2026-06-08", inbound: 1043 })];
      const r = bill(stays, "2026-06");
      const bad = [
        r.palletDays !== 644 || line(r, "storage")?.cents !== 6440 ? `pallet-days ${r.palletDays}` : "",
        line(r, "out")?.quantity !== 2 ? "outbound" : "",
        !r.checks.detailMatches ? "detail" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B7 last day, and same-day in and out",
    run() {
      const stays = [...rows(1, { sku: "L", inYmd: "2026-10-31", inbound: 1 }), ...rows(1, { sku: "S", inYmd: "2026-10-15", outYmd: "2026-10-15", inbound: 2 })];
      const r = bill(stays, "2026-10");
      const long = r.detail.filter((d) => d.concept === "storage" && d.sku === "L").reduce((a, d) => a + (d.palletDays ?? 0), 0);
      const same = r.detail.filter((d) => d.concept === "storage" && d.sku === "S").length;
      const bad = [
        long !== 1 ? `last-day pallet-days ${long}` : "",
        same !== 0 ? "same-day pallet should have no storage" : "",
        r.palletDays !== 1 ? `total ${r.palletDays}` : "",
        line(r, "in")?.quantity !== 2 || line(r, "out")?.quantity !== 1 ? "in/out charged" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B8 clock change (10 pallets all October)",
    run() {
      const r = bill(rows(10, { inYmd: "2026-09-01" }), "2026-10");
      console.log(`      B8: ${r.palletDays} pallet-days in a ${period("2026-10").days}-day period`);
      return r.palletDays === 310 && Number.isInteger(r.palletDays) && period("2026-10").days === 31 ? null : `got ${r.palletDays}`;
    },
  },
  {
    name: "B9 loose pallet, FRACTION (20 of 40 boxes leave on day 10)",
    run() {
      const r = bill(pico(), "2026-06");
      return r.palletDays === 19.5 && line(r, "out")?.quantity === 0.5 && r.checks.detailMatches ? null : `pallet-days ${r.palletDays}, out ${line(r, "out")?.quantity}`;
    },
  },
  {
    name: "B9-FULL loose pallet charged as a whole pallet",
    run() {
      const r = bill(pico(), "2026-06", tariff({ partialPallets: "FULL" }));
      console.log(`      B9-FULL: ${r.palletDays} pallet-days (30 days, one pallet), outbound ${line(r, "out")?.quantity}`);
      return r.palletDays === 30 && line(r, "out")?.quantity === 0.5 && r.checks.detailMatches ? null : `pallet-days ${r.palletDays}, out ${line(r, "out")?.quantity}`;
    },
  },
  {
    name: "B10 price: only the general one, never another",
    run() {
      const none = bill(rows(2, { type: "AMERICAN", inYmd: "2026-05-01" }), "2026-06", tariff({ storagePrice: null, storageByType: { EURO: 0.5 } }));
      const general = bill(rows(2, { type: "AMERICAN", inYmd: "2026-05-01" }), "2026-06", tariff({ storagePrice: 0.12, storageByType: { EURO: 0.5 } }));
      const own = bill(rows(2, { type: "AMERICAN", inYmd: "2026-05-01" }), "2026-06", tariff({ storagePrice: 0.12, storageByType: { AMERICAN: 0.3 } }));
      const bad = [
        line(none, "storage")?.cents !== 0 || line(none, "storage")?.price !== 0 ? "should be 0.00" : "",
        line(general, "storage")?.price !== 0.12 ? "general price not used" : "",
        line(own, "storage")?.price !== 0.3 ? "own price not used" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B11 same stock, two rules, two amounts, both add up",
    run() {
      // A whole pallet, a loose pallet of 12 boxes inside, and 28 boxes that left on day 10.
      const stays = [...rows(1, { inYmd: "2026-05-01", inbound: 7 }), ...rows(1, { inYmd: "2026-05-01", units: 12, inbound: 8 }), ...rows(1, { inYmd: "2026-05-01", units: 28, outYmd: "2026-06-10", inbound: 8 })];
      const a = bill(stays, "2026-06", tariff({ partialPallets: "FRACTION" }));
      const b = bill(stays, "2026-06", tariff({ partialPallets: "FULL" }));
      console.log(`      B11: FRACTION ${a.palletDays} pd = ${eur(a.totalCents)} EUR | FULL ${b.palletDays} pd = ${eur(b.totalCents)} EUR`);
      const bad = [
        a.rule !== "FRACTION" || b.rule !== "FULL" ? "rule not reported" : "",
        a.totalCents === b.totalCents ? "same amount in both modes" : "",
        !a.checks.detailMatches || !b.checks.detailMatches ? "a mode does not add up" : "",
        a.detail.reduce((s, d) => s + d.cents, 0) !== a.lines.reduce((s, l) => s + l.cents, 0) ? "FRACTION detail cents" : "",
        b.detail.reduce((s, d) => s + d.cents, 0) !== b.lines.reduce((s, l) => s + l.cents, 0) ? "FULL detail cents" : "",
        a.palletDays !== 30 + 0.3 * 30 + 0.7 * 9 ? `FRACTION pd ${a.palletDays}` : "",
        b.palletDays !== 60 ? `FULL pd ${b.palletDays}` : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B12 madrid calendar (periods and time zone)",
    run() {
      const bad = [
        period("2026-02").days !== 28 || period("2028-02").days !== 29 ? "february" : "",
        period("2026-12").last !== "2026-12-31" ? "december" : "",
        period("2026-06-05", "2026-06-05").days !== 1 ? "one-day period" : "",
        dayNumber(new Date("2026-10-31T23:30:00Z")) !== dayOfYmd("2026-11-01") ? "UTC night is already 1 Nov in Madrid" : "",
        dayNumber(new Date("2026-07-31T22:30:00Z")) !== dayOfYmd("2026-08-01") ? "summer night" : "",
        dayNumber(new Date("2026-10-25T00:30:00Z")) - dayNumber(new Date("2026-10-24T00:30:00Z")) !== 1 ? "clock change day" : "",
        (() => { try { period("2026-13"); return "month 13"; } catch { return ""; } })(),
        (() => { try { period("2026-06-10", "2026-06-09"); return "backwards"; } catch { return ""; } })(),
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B13 stays from documents (live, shipped, not shipped, unknown entry)",
    run() {
      const items = [{ id: "i1", sku: "X", unitsPerPallet: 40, palletType: "EURO" as const }];
      const inbounds = [{ id: "n1", number: 5, clientDocRef: "ALB-5", date: new Date("2026-06-03T09:00:00Z"), receivedAt: new Date("2026-06-04T09:00:00Z") }];
      const stays = buildStays({
        items, inbounds, periodStart: dayOfYmd("2026-06-01"),
        stock: [{ itemId: "i1", lot: "L", units: 40, inboundId: "n1" }, { itemId: "i1", lot: "L", units: 40, inboundId: null }],
        outbounds: [
          { number: 1, status: "SHIPPED", date: new Date("2026-06-09T09:00:00Z"), shippedAt: new Date("2026-06-10T09:00:00Z"), shipped: [{ itemId: "i1", lot: "L", units: 40, inboundId: "n1" }, { itemId: "nope", units: 5 }, "junk"] },
          { number: 2, status: "PREPARED", date: new Date("2026-06-12T09:00:00Z"), shippedAt: null, shipped: [{ itemId: "i1", lot: "L", units: 40, inboundId: "n1" }] },
        ],
      });
      const bad = [
        stays.length !== 3 ? `${stays.length} stays` : "",
        stays[0]?.inDay !== dayOfYmd("2026-06-04") ? "receivedAt not used" : "",
        stays[1]?.inKnown !== false || stays[1]?.inDay !== dayOfYmd("2026-06-01") ? "unknown entry" : "",
        stays[2]?.outDay !== dayOfYmd("2026-06-10") ? "shippedAt not used" : "",
      ].filter(Boolean);
      if (bad.length) return bad.join("; ");
      const r = bill(stays, "2026-06");
      return r.checks.warnings.length === 1 && r.checks.detailMatches ? null : `warnings ${JSON.stringify(r.checks.warnings)}`;
    },
  },
  {
    name: "B14 factor and rounding (each line rounded, base = sum of lines)",
    run() {
      // 3 pallets x 31 days = 93 pallet-days x 0.0333 = 3.0969 -> 3.10 ; entry 3 x 1.1111 = 3.3333 -> 3.33 ; factor 150 %
      const t = tariff({ storagePrice: 0.0333, inPerPallet: 1.1111, outPerPallet: 0, vatPct: 21, factorPct: 150 });
      const r = bill(rows(3, { inYmd: "2026-10-01", inbound: 3 }), "2026-10", t);
      const bad = [
        line(r, "storage")?.cents !== 465 ? `storage ${line(r, "storage")?.cents}` : "", // 4.6454 -> 4.65
        line(r, "in")?.cents !== 500 ? `inbound ${line(r, "in")?.cents}` : "", // 5.0 (3.3333 x 1.5)
        r.baseCents !== r.lines.reduce((a, l) => a + l.cents, 0) ? "base is not the sum of the lines" : "",
        r.vatCents !== Math.round((r.baseCents * 21) / 100) ? "vat" : "",
        r.totalCents !== r.baseCents + r.vatCents ? "total" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "B15 300 random months: detail always adds up, in both rules",
    run() {
      let seed = 12345;
      const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
      const start = dayOfYmd("2026-04-01");
      for (let t = 0; t < 300; t++) {
        const stays: Stay[] = [];
        for (let n = 0; n < 1 + Math.floor(rnd() * 6); n++) {
          const inDay = start + Math.floor(rnd() * 120);
          const units = 1 + Math.floor(rnd() * PER_PALLET);
          const out = rnd() < 0.5 ? null : inDay + Math.floor(rnd() * 90);
          stays.push({
            inboundId: `n${n % 3}`, inboundNumber: n % 3, docRef: null, itemId: "S", sku: "S", lot: "L", palletType: rnd() < 0.3 ? "AMERICAN" : "EURO",
            units, perPallet: PER_PALLET, inDay, inKnown: true, outDay: out, outboundNumber: out === null ? null : 1,
          });
        }
        for (const rule of ["FRACTION", "FULL"] as const) {
          const r = billPeriod({ stays, handling: [], tariff: tariff({ partialPallets: rule, storagePrice: 0.0713, inPerPallet: 1.37 }), period: period("2026-06") });
          if (!r.checks.detailMatches) return `trial ${t} ${rule}: ${JSON.stringify(r.checks)}`;
          if (r.totalCents !== r.baseCents + r.vatCents) return `trial ${t}: total`;
        }
      }
      return null;
    },
  },
];

let failed = 0;
for (const c of CASES) {
  let problem: string | null;
  try {
    problem = c.run();
  } catch (error) {
    problem = `threw: ${(error as Error).message}`;
  }
  if (problem) failed++;
  console.log(`${problem ? "FAIL" : "ok  "}  ${c.name}${problem ? `\n      -> ${problem}` : ""}`);
}
console.log(`\n${CASES.length - failed}/${CASES.length} pass`);
process.exit(failed ? 1 : 0);
