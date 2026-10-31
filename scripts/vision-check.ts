// Checks for the photo helpers in src/lib/ai (reading order of the boxes SAM finds).
// Pure: no database, no keys, no network.
//
//   npx tsx scripts/vision-check.ts
//
// Exit code 1 if any case fails.

import { cleanPalletCodes } from "../src/lib/ai/note-codes";
import { readingOrder } from "../src/lib/ai/reading-order";

type Case = { name: string; check: () => string | null };

const same = (got: unknown, want: unknown) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  return g === w ? null : `got ${g}, expected ${w}`;
};

const box = (id: string, x: number, y: number, w = 0.15, h = 0.18) => ({ id, x, y, w, h });
const ids = (boxes: { id: string }[]) => boxes.map((b) => b.id).join(" ");

const cases: Case[] = [
  {
    name: "V1 3 x 4 grid given by score comes back row by row, left to right",
    check: () => {
      const grid = [0.3, 0.5, 0.7].flatMap((y, r) => [0.2, 0.36, 0.52, 0.68].map((x, c) => box(`${r}${c}`, x, y)));
      const shuffled = [5, 0, 11, 3, 8, 1, 10, 6, 2, 9, 4, 7].map((i) => grid[i]);
      return same(ids(readingOrder(shuffled)), "00 01 02 03 10 11 12 13 20 21 22 23");
    },
  },
  {
    name: "V2 a box a little higher or lower (photo not straight) stays in its row",
    check: () => same(ids(readingOrder([box("b", 0.4, 0.3), box("a", 0.2, 0.33), box("d", 0.4, 0.49), box("c", 0.2, 0.52)])), "a b c d"),
  },
  {
    name: "V3 a small box on top of a tall one is a row of its own",
    check: () => same(ids(readingOrder([box("tall", 0.2, 0.4, 0.2, 0.4), box("top", 0.25, 0.25, 0.1, 0.12)])), "top tall"),
  },
  { name: "V4 empty and single", check: () => same([readingOrder([]).length, ids(readingOrder([box("a", 0.5, 0.5)]))], [0, "a"]) },
  {
    name: "V5 does not change the boxes it gets",
    check: () => {
      const input = [box("b", 0.6, 0.3), box("a", 0.2, 0.3)];
      readingOrder(input);
      return same(ids(input), "b a");
    },
  },
  {
    name: "V6 pallet IDs: invalid, repeated, lot/doc copies and surplus are dropped; nothing is invented; mixed repeats across lines stay",
    check: () => {
      const line = { pallets: 3, lot: "L2610A" };
      const got = [
        cleanPalletCodes(["(00) 3401 2345 6789", "x", "gmv-0581", "GMV-0581", "L2610A", "ALB-77", "GMV-0582", "GMV-0583"], line, "ALB-77"),
        cleanPalletCodes(["a b", 12, null, {}], { pallets: 2, lot: null }, null),
        cleanPalletCodes(null, line, null),
        cleanPalletCodes([], line, null),
        cleanPalletCodes(["OBR-JIJ-0042"], { pallets: 1, lot: null }, null),
        cleanPalletCodes(["OBR-JIJ-0042"], { pallets: 1, lot: "L9" }, null),
      ];
      return same(got, [["340123456789", "GMV-0581", "GMV-0582"], null, null, null, ["OBR-JIJ-0042"], ["OBR-JIJ-0042"]]);
    },
  },
];

let failed = 0;
for (const c of cases) {
  const problem = c.check();
  if (problem) failed++;
  console.log(`${problem ? "FAIL" : "ok  "} ${c.name}${problem ? `\n     ${problem}` : ""}`);
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
