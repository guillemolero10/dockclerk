// The month-end arithmetic. Pure: no database, no clock, no AI. Same inputs, same cents, always.
// Money is whole cents: every line is rounded once, the base is the sum of the rounded lines, VAT is rounded once.
import { daysInside, ymdOfDay, type Period } from "./calendar";
import { chargedPallets, type PalletKind, type PartialRule, type Stay } from "./stays";

export type TariffInput = {
  inPerPallet: number;
  outPerPallet: number;
  /** General storage price per pallet and day. */
  storagePrice: number | null;
  /** Own prices by pallet type, e.g. { AMERICAN: 0.2 }. A type without one uses the general price (never any other price). */
  storageByType: Partial<Record<PalletKind, number>>;
  /** Multiplies every line, in percent. */
  factorPct: number;
  vatPct: number;
  partialPallets: PartialRule;
};

export type HandlingInput = { day: number; pallets: number; unitPrice: number; replacesExit: boolean };

export type BillLine = {
  concept: "in" | "out" | "storage" | "handling";
  label: string;
  quantity: number;
  unit: string;
  price: number;
  cents: number;
};

export type DetailRow = {
  inboundNumber: number | null;
  docRef: string | null;
  sku: string;
  lot: string | null;
  inDate: string;
  concept: "in" | "out" | "storage";
  pallets: number;
  days: number | null;
  /** "2026-11-08" for goods that leave (or left) on that day; null for goods that are still inside. */
  exitDate: string | null;
  outboundNumber: number | null;
  palletDays: number | null;
  price: number;
  cents: number;
  note?: string;
};

export type BillResult = {
  rule: PartialRule;
  lines: BillLine[];
  detail: DetailRow[];
  baseCents: number;
  vatPct: number;
  vatCents: number;
  totalCents: number;
  palletDays: number;
  inPallets: number;
  outPallets: number;
  handlingPallets: number;
  checks: {
    detailMatches: boolean;
    palletDaysSummary: number;
    palletDaysDetail: number;
    centsSummary: number;
    centsDetail: number;
    warnings: string[];
  };
};

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
/** Cents of one line: quantity × price × factor %, rounded once. */
const cents = (quantity: number, price: number, factorPct: number) => Math.round(Number((quantity * price * factorPct).toFixed(6)));

/** Splits `total` cents over rows in proportion to `weights` so that the parts add up to exactly `total`. */
function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / sum);
  const parts = exact.map(Math.floor);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

const priceOf = (tariff: TariffInput, type: PalletKind) => tariff.storageByType[type] ?? tariff.storagePrice ?? 0;

export function billPeriod(input: { stays: Stay[]; handling: HandlingInput[]; tariff: TariffInput; period: Period }): BillResult {
  const { tariff, period: p } = input;
  const rule = tariff.partialPallets;
  const warnings: string[] = [];
  const stays = input.stays;
  const weights = chargedPallets(stays, rule);
  const enters = (s: Stay) => s.inKnown && s.inDay >= p.start && s.inDay < p.end;
  const leaves = (s: Stay) => s.outDay !== null && s.outDay >= p.start && s.outDay < p.end;
  // FULL: loose boxes always travel on a pallet of their own, so entries and exits count whole pallets.
  // Storage still uses `weights`: a pallet is never charged twice on the same day.
  const palletsOf = (units: number, perPallet: number) => (rule === "FULL" ? Math.ceil(units / perPallet) : units / perPallet);
  const groupKey = (s: Stay) => `${s.inboundNumber ?? 1e9}|${s.inboundId ?? ""}|${s.sku}|${s.lot ?? ""}|${s.inDay}`;
  /** Pallets received, per delivery note, item and lot: a pallet split later is still one pallet in. */
  const entered = (indexes: number[]) => (indexes.length ? palletsOf(indexes.reduce((a, i) => a + stays[i].units, 0), stays[indexes[0]].perPallet) : 0);
  /** Pallets on the truck: each shipped piece is one row, a loose one included. */
  const exited = (s: Stay) => palletsOf(s.units, s.perPallet);

  // ---- Summary lines ----
  const enteringByGroup = new Map<string, number[]>();
  stays.forEach((s, i) => {
    if (enters(s)) enteringByGroup.set(groupKey(s), [...(enteringByGroup.get(groupKey(s)) ?? []), i]);
  });
  const inPallets = r6([...enteringByGroup.values()].reduce((a, indexes) => a + entered(indexes), 0));
  const exitPallets = stays.filter(leaves).reduce((a, s) => a + exited(s), 0);
  const handlingIn = input.handling.filter((h) => h.day >= p.start && h.day < p.end && h.pallets > 0);
  const replaced = handlingIn.filter((h) => h.replacesExit).reduce((a, h) => a + h.pallets, 0);
  const outPallets = r6(Math.max(0, exitPallets - replaced));

  const lines: BillLine[] = [
    { concept: "in", label: "Inbound", quantity: inPallets, unit: "pallets", price: tariff.inPerPallet, cents: cents(inPallets, tariff.inPerPallet, tariff.factorPct) },
    { concept: "out", label: replaced > 0 ? "Outbound (handled pallets deducted)" : "Outbound", quantity: outPallets, unit: "pallets", price: tariff.outPerPallet, cents: cents(outPallets, tariff.outPerPallet, tariff.factorPct) },
  ];

  const palletDaysByType = new Map<PalletKind, number>();
  stays.forEach((s, i) => {
    const pd = weights[i] * daysInside(s.inDay, s.outDay, p);
    if (pd > 0) palletDaysByType.set(s.palletType, (palletDaysByType.get(s.palletType) ?? 0) + pd);
  });
  for (const type of ["EURO", "AMERICAN"] as PalletKind[]) {
    const pd = r6(palletDaysByType.get(type) ?? 0);
    if (pd <= 0) continue;
    const price = priceOf(tariff, type);
    lines.push({ concept: "storage", label: `Storage, ${type === "EURO" ? "euro" : "american"} pallets`, quantity: pd, unit: "pallet·day", price, cents: cents(pd, price, tariff.factorPct) });
  }

  const handlingPrices = [...new Set(handlingIn.map((h) => h.unitPrice))].sort((a, b) => a - b);
  let handlingPallets = 0;
  for (const price of handlingPrices) {
    const qty = r6(handlingIn.filter((h) => h.unitPrice === price).reduce((a, h) => a + h.pallets, 0));
    handlingPallets += qty;
    lines.push({ concept: "handling", label: "Handling", quantity: qty, unit: "pallets", price, cents: cents(qty, price, tariff.factorPct) });
  }

  const baseCents = lines.reduce((a, l) => a + l.cents, 0);
  const vatCents = Math.round(Number(((baseCents * tariff.vatPct) / 100).toFixed(6)));

  // ---- Detail: "warehouse movements" per delivery note, summing exactly to the lines above ----
  type Group = { indexes: number[] };
  const groups = new Map<string, Group>();
  stays.forEach((s, i) => {
    const key = groupKey(s);
    const g = groups.get(key) ?? { indexes: [] };
    g.indexes.push(i);
    groups.set(key, g);
  });

  type Draft = Omit<DetailRow, "cents"> & { weight: number; type: PalletKind };
  const drafts: Draft[] = [];
  for (const g of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })).map(([, v]) => v)) {
    const first = stays[g.indexes[0]];
    const base = { inboundNumber: first.inboundNumber, docRef: first.docRef, sku: first.sku, lot: first.lot, inDate: ymdOfDay(first.inDay), type: first.palletType };

    const entering = g.indexes.filter((i) => enters(stays[i]));
    if (entering.length) {
      const pallets = r6(entered(entering));
      drafts.push({ ...base, concept: "in", pallets, days: null, exitDate: null, outboundNumber: null, palletDays: null, price: tariff.inPerPallet, weight: pallets });
    }

    const leavingDays = [...new Set(g.indexes.filter((i) => leaves(stays[i])).map((i) => stays[i].outDay as number))].sort((a, b) => a - b);
    for (const day of leavingDays) {
      const here = g.indexes.filter((i) => stays[i].outDay === day && leaves(stays[i]));
      const pallets = r6(here.reduce((a, i) => a + exited(stays[i]), 0));
      drafts.push({ ...base, concept: "out", pallets, days: null, exitDate: ymdOfDay(day), outboundNumber: stays[here[0]].outboundNumber, palletDays: null, price: tariff.outPerPallet, weight: pallets });
    }

    // One storage row per exit date (null = still inside, last). Goods that will leave after the period are split here.
    const exitKeys = [...new Set(g.indexes.map((i) => stays[i].outDay))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
    for (const day of exitKeys) {
      const here = g.indexes.filter((i) => stays[i].outDay === day);
      const days = daysInside(first.inDay, day, p);
      const pallets = r6(here.reduce((a, i) => a + weights[i], 0));
      const palletDays = r6(pallets * days);
      if (palletDays <= 0) continue;
      drafts.push({
        ...base, concept: "storage", pallets, days, exitDate: day === null ? null : ymdOfDay(day), outboundNumber: day === null ? null : stays[here[0]].outboundNumber,
        palletDays, price: priceOf(tariff, first.palletType), weight: palletDays,
        ...(first.inKnown ? {} : { note: "No entry date: counted from the start of the period." }),
      });
    }
  }
  if (stays.some((s) => !s.inKnown && daysInside(s.inDay, s.outDay, p) > 0)) warnings.push("Some goods have no known entry date; they are charged storage from the start of the period and no entry.");

  // Spread each summary line's cents over its detail rows (largest remainder), so the detail adds up to the cent.
  const detail: DetailRow[] = [];
  const lineFor = (d: Draft) => lines.find((l) => l.concept === d.concept && (d.concept !== "storage" || l.label.includes(d.type === "EURO" ? "euro" : "american")));
  const shares = new Map<Draft, number>();
  for (const line of lines) {
    if (line.concept === "handling") continue;
    const mine = drafts.filter((d) => lineFor(d) === line);
    const parts = allocate(line.cents, mine.map((d) => d.weight));
    mine.forEach((d, i) => shares.set(d, parts[i]));
  }
  for (const d of drafts) {
    const { weight: _w, type: _t, ...row } = d;
    void _w; void _t;
    detail.push({ ...row, cents: shares.get(d) ?? 0 });
  }

  const palletDays = r6([...palletDaysByType.values()].reduce((a, b) => a + b, 0));
  const palletDaysDetail = r6(detail.filter((d) => d.concept === "storage").reduce((a, d) => a + (d.palletDays ?? 0), 0));
  const centsSummary = lines.filter((l) => l.concept !== "handling").reduce((a, l) => a + l.cents, 0);
  const centsDetail = detail.reduce((a, d) => a + d.cents, 0);
  const detailMatches = Math.abs(palletDays - palletDaysDetail) < 1e-4 && centsSummary === centsDetail;
  if (!detailMatches) warnings.push("The detail does not add up to the summary.");

  return {
    rule, lines, detail, baseCents, vatPct: tariff.vatPct, vatCents, totalCents: baseCents + vatCents,
    palletDays, inPallets, outPallets, handlingPallets: r6(handlingPallets),
    checks: { detailMatches, palletDaysSummary: palletDays, palletDaysDetail, centsSummary, centsDetail, warnings },
  };
}
