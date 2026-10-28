// How a stored pre-invoice is read and shown. Pure: no database, no clock.
// The figures were computed and saved by compute.ts; here they are only grouped and formatted.
import type { BillLine, DetailRow } from "./compute";
import type { PartialRule } from "./stays";

/** 67566 -> "675,66 €". */
export const eur = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

/** 252 -> "252"; 0.5 -> "0,5"; never more than 2 decimals. */
export const num = (n: number) => n.toLocaleString("es-ES", { maximumFractionDigits: 2 });

/** "2026-10-02" -> "02/10". */
export const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;

/** "2026-10-02" -> "02/10/2026". */
export const dmy = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09" -> "September 2026". */
export const monthLabel = (month: string) => `${MONTHS_LONG[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

/** "2026-09" -> "September". */
export const monthName = (month: string) => MONTHS_LONG[Number(month.slice(5, 7)) - 1];

/** ("2026-09-01", "2026-09-30") -> "1–30 Sep 2026". */
export function periodText(first: string, last: string) {
  const [fd, fm, fy] = [Number(first.slice(8, 10)), Number(first.slice(5, 7)), first.slice(0, 4)];
  const [ld, lm, ly] = [Number(last.slice(8, 10)), Number(last.slice(5, 7)), last.slice(0, 4)];
  if (fm === lm && fy === ly) return `${fd}–${ld} ${MONTHS[lm - 1]} ${ly}`;
  return `${fd} ${MONTHS[fm - 1]} ${fy} – ${ld} ${MONTHS[lm - 1]} ${ly}`;
}

/** Month before / after a "YYYY-MM". */
export function shiftMonth(month: string, by: number) {
  const index = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5, 7)) - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
}

/** Which month the page shows: the one asked for, or last month. A month that has not started is never shown. */
export function pickMonth(asked: string | undefined, today: string) {
  const current = today.slice(0, 7);
  if (asked && /^\d{4}-(0[1-9]|1[0-2])$/.test(asked) && asked >= "2000-01") return asked > current ? current : asked;
  return shiftMonth(current, -1);
}

export const RULE_LABEL: Record<PartialRule, string> = { FRACTION: "Fraction", FULL: "Full pallet" };
export const RULE_HELP: Record<PartialRule, string> = {
  FRACTION: "A loose pallet (pico) counts its share: 12 boxes of a 40-box pallet are 0,3 pallets.",
  FULL: "Every pallet with goods in it counts whole while it is inside. If some boxes leave a pallet, the exit counts 1 pallet.",
};

// ---------- what is stored in the database ----------

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function readLines(value: unknown): BillLine[] {
  if (!Array.isArray(value)) return [];
  return value.filter((l): l is BillLine => isObject(l) && typeof l.cents === "number" && typeof l.concept === "string");
}

export type StoredChecks = { detailMatches: boolean; palletDaysSummary: number; palletDaysDetail: number; centsSummary: number; centsDetail: number; warnings: string[] };

export function readDetail(value: unknown): { rows: DetailRow[]; checks: StoredChecks | null } {
  if (!isObject(value)) return { rows: [], checks: null };
  const rows = Array.isArray(value.rows) ? value.rows.filter((r): r is DetailRow => isObject(r) && typeof r.concept === "string") : [];
  const c = value.checks;
  const checks = isObject(c) && typeof c.detailMatches === "boolean" ? ({ warnings: [], ...c } as unknown as StoredChecks) : null;
  return { rows, checks };
}

export function readSteps(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((s): s is string => typeof s === "string") : [];
}

/** The numbers of one row of the month table. */
export function summarize(lines: BillLine[]) {
  const sum = (concept: BillLine["concept"]) => lines.filter((l) => l.concept === concept).reduce((a, l) => a + l.quantity, 0);
  return { inPallets: sum("in"), outPallets: sum("out"), palletDays: sum("storage"), handling: sum("handling") };
}

// ---------- "Warehouse movements": the detail grouped by delivery note ----------

export type MovementGroup = {
  key: string;
  inboundNumber: number | null;
  docRef: string | null;
  sku: string;
  lot: string | null;
  inDate: string;
  /** Entry row first, then storage (goods still inside first, then the ones that leave), then exits. */
  rows: DetailRow[];
  cents: number;
  /** Goods of one entry that stay and leave at different times: the line worth reading at a glance. */
  split: { total: number; stay: number; leaving: { exitDate: string; pallets: number }[] } | null;
};

const ORDER = { in: 0, storage: 1, out: 2 } as const;

export function groupMovements(rows: DetailRow[]): MovementGroup[] {
  const groups = new Map<string, MovementGroup>();
  for (const r of rows) {
    if (r.concept !== "in" && r.concept !== "out" && r.concept !== "storage") continue;
    const key = `${r.inboundNumber ?? ""}|${r.docRef ?? ""}|${r.sku}|${r.lot ?? ""}|${r.inDate}`;
    const g = groups.get(key) ?? { key, inboundNumber: r.inboundNumber, docRef: r.docRef, sku: r.sku, lot: r.lot, inDate: r.inDate, rows: [], cents: 0, split: null };
    g.rows.push(r);
    g.cents += r.cents;
    groups.set(key, g);
  }
  const out = [...groups.values()];
  for (const g of out) {
    g.rows.sort((a, b) => {
      if (a.concept !== b.concept) return ORDER[a.concept as keyof typeof ORDER] - ORDER[b.concept as keyof typeof ORDER];
      return (a.exitDate ?? "9999").localeCompare(b.exitDate ?? "9999");
    });
    const storage = g.rows.filter((r) => r.concept === "storage");
    const stay = storage.filter((r) => r.exitDate === null);
    const leaving = storage.filter((r) => r.exitDate !== null);
    if (stay.length > 0 && leaving.length > 0) {
      const stays = stay.reduce((a, r) => a + r.pallets, 0);
      const goes = leaving.map((r) => ({ exitDate: r.exitDate as string, pallets: r.pallets }));
      g.split = { total: stays + goes.reduce((a, l) => a + l.pallets, 0), stay: stays, leaving: goes };
    }
  }
  return out;
}

/** "23 pallets: 21 no exit · 2 leave 02/10" */
export function splitText(s: NonNullable<MovementGroup["split"]>) {
  return `${num(s.total)} pallets: ${num(s.stay)} no exit · ${s.leaving.map((l) => `${num(l.pallets)} leave ${ddmm(l.exitDate)}`).join(" · ")}`;
}
