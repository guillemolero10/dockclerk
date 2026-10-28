// Checks for how a stored pre-invoice is read and grouped for the screen (src/lib/billing/view.ts).
// Pure: no database, no keys.   npx tsx scripts/billing-view-check.ts
import type { DetailRow } from "../src/lib/billing/compute";
import { ddmm, eur, groupMovements, monthLabel, periodText, pickMonth, shiftMonth, splitText } from "../src/lib/billing/view";

const fails: string[] = [];
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) fails.push(`${name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
};

const row = (o: Partial<DetailRow>): DetailRow => ({
  inboundNumber: 1043, docRef: "ALB-1", sku: "PUZZLE-500", lot: null, inDate: "2026-09-20", concept: "storage", pallets: 0,
  days: null, exitDate: null, outboundNumber: null, palletDays: null, price: 0.1, cents: 0, ...o,
});

const groups = groupMovements([
  row({ concept: "out", pallets: 2, exitDate: "2026-10-02", outboundNumber: 7001, cents: 200 }),
  row({ concept: "storage", pallets: 2, days: 11, palletDays: 22, exitDate: "2026-10-02", cents: 220 }),
  row({ concept: "storage", pallets: 21, days: 11, palletDays: 231, exitDate: null, cents: 2310 }),
  row({ concept: "in", pallets: 23, cents: 2300 }),
  row({ inboundNumber: 1044, concept: "storage", pallets: 5, days: 30, palletDays: 150, cents: 1500, inDate: "2026-09-01" }),
]);
eq("two groups", groups.length, 2);
eq("order in/storage/out", groups[0].rows.map((r) => r.concept + (r.exitDate ?? "")), ["in", "storage", "storage2026-10-02", "out2026-10-02"]);
eq("no-exit first", groups[0].rows[1].pallets, 21);
eq("cents add up", groups[0].cents, 2300 + 220 + 2310 + 200);
eq("split text", groups[0].split && splitText(groups[0].split), "23 pallets: 21 no exit · 2 leave 02/10");
eq("no split when all stays", groups[1].split, null);

eq("eur", eur(67566).replace(/\s/g, " "), "675,66 €");
eq("ddmm", ddmm("2026-10-02"), "02/10");
eq("period", periodText("2026-09-01", "2026-09-30"), "1–30 Sep 2026");
eq("month label", monthLabel("2026-09"), "September 2026");
eq("shift", [shiftMonth("2026-01", -1), shiftMonth("2026-12", 1)], ["2025-12", "2027-01"]);
eq("default is last month", pickMonth(undefined, "2026-11-01"), "2026-10");
eq("january default", pickMonth(undefined, "2026-01-15"), "2025-12");
eq("future clamps to current", pickMonth("2027-05", "2026-11-01"), "2026-11");
eq("garbage falls back", pickMonth("2026-13", "2026-11-01"), "2026-10");

console.log(fails.length ? fails.join("\n") : "billing-view-check: all pass");
process.exit(fails.length ? 1 : 0);
