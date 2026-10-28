// Checks for billing against the seeded database. READ-ONLY: it never writes anything.
//
//   npx tsx --env-file=.env scripts/billing-seed-check.ts
//
// Needs the database (mobile data on the UMH wifi) and a fresh `npm run db:seed`.
// The "this month" cases follow the planted case: 23 pallets of PUZZLE-500 of C001 came in on the 20th of last month,
// 2 left on the 2nd of this month (PED-7001/7002). Exit code 1 if any case fails.

import { db } from "../src/lib/db";
import { dateOfDay, dayNumber, period, ymdOfDay } from "../src/lib/billing/calendar";
import { loadBilling, todayDay, type LoadedBilling } from "../src/lib/billing/load";
import { buildStays } from "../src/lib/billing/stays";

const today = todayDay();
const monthOf = (day: number) => ymdOfDay(day).slice(0, 7);
const thisMonth = monthOf(today);
const prevMonth = monthOf(period(thisMonth).start - 1);
const nextMonth = monthOf(period(thisMonth).end);

const cache = new Map<string, LoadedBilling>();
async function bill(code: string, month: string) {
  const key = `${code}|${month}`;
  if (!cache.has(key)) {
    const client = await db.client.findUniqueOrThrow({ where: { code }, select: { id: true } });
    cache.set(key, await loadBilling(client.id, period(month)));
  }
  return cache.get(key)!;
}

type Case = { name: string; run: () => Promise<string | null> };

const CASES: Case[] = [
  {
    name: `C001 ${prevMonth}: the detail adds up to the summary`,
    async run() {
      const b = await bill("C001", prevMonth);
      return b.hasTariff && b.hasMovements && b.result.checks.detailMatches ? null : `tariff ${b.hasTariff}, movements ${b.hasMovements}, ${JSON.stringify(b.result.checks)}`;
    },
  },
  {
    name: `all 8 customers add up in ${prevMonth} (detail = summary, base + VAT = total, a tariff each)`,
    async run() {
      const clients = await db.client.findMany({ select: { code: true }, orderBy: { code: "asc" } });
      if (clients.length !== 8) return `${clients.length} customers, expected 8`;
      const bad: string[] = [];
      for (const { code } of clients) {
        const b = await bill(code, prevMonth);
        const r = b.result;
        if (!b.hasTariff) bad.push(`${code}: no tariff`);
        if (!b.hasMovements) bad.push(`${code}: no movements`);
        if (!r.checks.detailMatches) bad.push(`${code}: detail`);
        if (r.totalCents !== r.baseCents + r.vatCents) bad.push(`${code}: total`);
        if (r.baseCents !== r.lines.reduce((a, l) => a + l.cents, 0)) bad.push(`${code}: base`);
        if (r.checks.warnings.length) bad.push(`${code}: ${r.checks.warnings.join(" / ")}`);
        if (r.baseCents <= 0) bad.push(`${code}: base is ${r.baseCents}`);
      }
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: "C005 (Textil Biar) uses FULL, the other seven FRACTION, and the bill says which rule it used",
    async run() {
      const tariffs = await db.tariff.findMany({ select: { partialPallets: true, client: { select: { code: true } } } });
      const bad: string[] = [];
      if (tariffs.length !== 8) bad.push(`${tariffs.length} tariffs`);
      for (const t of tariffs) {
        const want = t.client.code === "C005" ? "FULL" : "FRACTION";
        if (t.partialPallets !== want) bad.push(`${t.client.code} is ${t.partialPallets}`);
        const b = await bill(t.client.code, prevMonth);
        if (b.result.rule !== want) bad.push(`${t.client.code} bill used ${b.result.rule}`);
      }
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: `C001 ${prevMonth}: 21 pallets with no exit and 2 that leave on PED-7001/7002 (planted case)`,
    async run() {
      const b = await bill("C001", prevMonth);
      const rows = b.result.detail.filter((d) => d.concept === "storage" && d.sku === "PUZZLE-500" && d.inDate === `${prevMonth}-20`);
      const open = rows.find((d) => d.exitDate === null);
      const leaving = rows.find((d) => d.exitDate !== null);
      const peds = await db.outbound.findMany({ where: { client: { code: "C001" }, number: { in: leaving?.outboundNumber ? [leaving.outboundNumber] : [] } }, select: { number: true, clientDocRef: true, status: true } });
      const bad = [
        rows.length !== 2 ? `${rows.length} storage rows for the 23-pallet delivery` : "",
        open?.pallets !== 21 ? `open row has ${open?.pallets} pallets` : "",
        leaving?.pallets !== 2 ? `leaving row has ${leaving?.pallets} pallets` : "",
        open && leaving && open.days !== leaving.days ? "both rows should have the same days (same entry, same period)" : "",
        leaving && leaving.exitDate !== `${thisMonth}-02` && today >= period(thisMonth).start + 1 ? `exit on ${leaving.exitDate}, expected ${thisMonth}-02` : "",
        peds.length !== 1 || !["SHIPPED", "CLOSED"].includes(peds[0].status) ? "the leaving row does not point to a shipped outbound" : "",
        peds.length === 1 && !/^PED-700[12]$/.test(peds[0].clientDocRef ?? "") ? `outbound reference ${peds[0].clientDocRef}, expected PED-7001/7002` : "",
        open && leaving && open.days !== null && open.palletDays !== 21 * open.days ? "open pallet-days" : "",
        leaving && leaving.days !== null && leaving.palletDays !== 2 * leaving.days ? "leaving pallet-days" : "",
        b.result.detail.some((d) => d.concept === "out" && d.inDate === `${prevMonth}-20` && d.sku === "PUZZLE-500") ? "the 2 pallets must not be charged as an exit in " + prevMonth : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
  {
    name: `C001 ${thisMonth}: those 2 pallets are charged as an exit in the month they leave`,
    async run() {
      if (today < period(thisMonth).start + 1) return null; // the 1st: they leave today, covered by the case above
      const b = await bill("C001", thisMonth);
      const out = b.result.detail.find((d) => d.concept === "out" && d.sku === "PUZZLE-500" && d.inDate === `${prevMonth}-20` && d.exitDate === `${thisMonth}-02`);
      return out && out.pallets === 2 && b.result.checks.detailMatches ? null : `exit row ${JSON.stringify(out)}, detail ${b.result.checks.detailMatches}`;
    },
  },
  {
    name: "every delivery: units of its stays (inside + shipped) = units received (nothing lost when splitting)",
    async run() {
      const clients = await db.client.findMany({
        select: {
          code: true,
          items: { select: { id: true, sku: true, unitsPerPallet: true, palletType: true } },
          inbounds: { select: { id: true, number: true, clientDocRef: true, date: true, receivedAt: true, status: true, lines: { select: { units: true } } } },
          outbounds: { where: { status: { in: ["SHIPPED", "CLOSED"] } }, select: { number: true, status: true, date: true, shippedAt: true, shipped: true } },
          stock: { select: { itemId: true, lot: true, units: true, inboundId: true } },
        },
      });
      const bad: string[] = [];
      let checked = 0;
      let orphans = 0;
      for (const c of clients) {
        const stays = buildStays({ items: c.items, inbounds: c.inbounds, outbounds: c.outbounds, stock: c.stock, periodStart: dayNumber(new Date()) });
        orphans += stays.filter((s) => !s.inKnown).length;
        for (const inb of c.inbounds) {
          if (inb.status === "EXPECTED") continue;
          const received = inb.lines.reduce((a, l) => a + l.units, 0);
          const inStays = stays.filter((s) => s.inboundId === inb.id).reduce((a, s) => a + s.units, 0);
          checked++;
          if (received !== inStays) bad.push(`${c.code} entry #${inb.number}: received ${received}, stays ${inStays}`);
        }
      }
      if (checked === 0) return "no deliveries checked";
      if (orphans) bad.push(`${orphans} stays without a known entry`);
      return bad.length ? `${bad.length} problems, first: ${bad.slice(0, 5).join(" | ")}` : null;
    },
  },
  {
    name: "a future month is not billable and a bad month is rejected (period / today)",
    async run() {
      const start = period(nextMonth).start;
      const bad = [
        start > today ? "" : `${nextMonth} should start after today`,
        (() => { try { period("2026-13"); return "accepted month 13"; } catch { return ""; } })(),
        (() => { try { period("26-1"); return "accepted 26-1"; } catch { return ""; } })(),
        dateOfDay(period(nextMonth).start) > new Date(Date.now() + 40 * 86400000) ? "next month starts too far away" : "",
      ].filter(Boolean);
      return bad.length ? bad.join("; ") : null;
    },
  },
];

(async () => {
  let failed = 0;
  for (const c of CASES) {
    let problem: string | null;
    try {
      problem = await c.run();
    } catch (error) {
      problem = `threw: ${(error as Error).message.split("\n").pop()}`;
    }
    if (problem) failed++;
    console.log(`${problem ? "FAIL" : "ok  "}  ${c.name}${problem ? `\n      -> ${problem}` : ""}`);
  }
  console.log(`\n${CASES.length - failed}/${CASES.length} pass`);
  await db.$disconnect();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e instanceof Error ? e.message.split("\n").pop() : e);
  process.exit(1);
});
