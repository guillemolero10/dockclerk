// The analyses. Each one answers a question a warehouse manager asks, with a method a
// data scientist would sign: it says how sure it is, and stays quiet when the data is too thin.

import { firstName } from "@/lib/format";
import { makeLayout, parseLocation } from "@/lib/warehouse/layout";
import { abcClasses, LIFT_MPS, slotSeconds, TRAVEL_MPS } from "@/lib/warehouse/velocity";
import type { AnalystData } from "./data";
import { backtestTotal, benjaminiHochberg, fisherGreater, holtDamped, mean, ols, sd, sum, wilson } from "./stats";
import type { Action, Analysis, Finding, Gap, IntervalRow, Step } from "./types";

const DAY = 24 * 60 * 60 * 1000;

// The warehouse runs on Madrid time, the server on UTC.
const ymdFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
const wdFmt = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Madrid", weekday: "short" });
const hourFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", hourCycle: "h23" });
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", day: "numeric", month: "short" });
const esFmt = new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", day: "numeric", month: "long" });
const ymd = (d: Date) => ymdFmt.format(d);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const weekday = (d: Date) => WEEKDAYS.indexOf(wdFmt.format(d));
const hour = (d: Date) => Number(hourFmt.format(d));
const pct = (x: number) => `${Math.round(x * 100)}%`;
const qText = (q: number) => (q < 0.001 ? "q < 0.001" : `q = ${q.toFixed(3)}`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const hola = (contact: string | null) => `Hola${firstName(contact) ? ` ${firstName(contact)}` : ""},`;
const ES_WEEKDAYS = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

const LATE_MIN = 15;

/** Days of the window, oldest first, ending yesterday (today is not over yet). */
function windowDays(now: Date, days: number) {
  const keys: string[] = [];
  for (let i = days; i >= 1; i--) keys.push(ymd(new Date(now.getTime() - i * DAY)));
  return keys;
}

export function analyze(data: AnalystData): Analysis {
  const findings: Finding[] = [];
  const gaps: Gap[] = [];
  const steps: Step[] = [];
  const keys = windowDays(data.now, data.days);
  const index = new Map(keys.map((k, i) => [k, i]));
  const itemById = new Map(data.items.map((i) => [i.id, i]));
  const clientById = new Map(data.clients.map((c) => [c.id, c]));
  const shipped = data.outbounds.filter((o) => o.status === "SHIPPED" || o.status === "CLOSED" || o.status === "PREPARED");

  steps.push({
    kind: "read",
    text: `read ${data.days} days: ${shipped.length} outbounds, ${data.inbounds.length} inbounds, ${data.slots.length} dock arrivals, ${sum(data.stock.map((s) => s.pallets))} pallets in stock`,
  });

  stockouts(data, keys, index, shipped, findings, gaps, steps, itemById, clientById);
  space(data, keys, index, shipped, findings, gaps, steps);
  slotting(data, shipped, findings, gaps, steps);
  carriers(data, findings, gaps, steps);
  dockPeaks(data, findings, steps);
  quality(data, findings, gaps, steps, clientById);
  customers(data, keys, index, shipped, findings, gaps, steps);

  findings.sort((a, b) => b.score - a.score);
  return { findings, gaps, steps };
}

// ─── 1. Who runs out of stock ───────────────────────────────────────────────────────────────
function stockouts(
  data: AnalystData,
  keys: string[],
  index: Map<string, number>,
  shipped: AnalystData["outbounds"],
  findings: Finding[],
  gaps: Gap[],
  steps: Step[],
  itemById: Map<string, AnalystData["items"][number]>,
  clientById: Map<string, AnalystData["clients"][number]>,
) {
  if (keys.length < 56) {
    gaps.push({
      topic: "Stock-out forecasts",
      text: `A demand forecast needs at least 8 weeks: two to learn the weekly pattern, four to test itself against what really happened. ${keys.length} days is not enough, so no forecast is shown.`,
    });
    return;
  }
  // Free stock: on the shelves, not picked, not promised to an open order.
  const open = new Set(data.outbounds.filter((o) => o.status === "REQUESTED").map((o) => o.id));
  const free = new Map<string, number>();
  for (const s of data.stock) if (!s.outboundId) free.set(s.itemId, (free.get(s.itemId) ?? 0) + s.pallets);
  for (const o of data.outbounds.filter((x) => x.status === "REQUESTED")) {
    for (const l of o.lines) free.set(l.itemId, (free.get(l.itemId) ?? 0) - l.pallets);
  }
  for (const s of data.stock) if (s.outboundId && open.has(s.outboundId)) free.set(s.itemId, (free.get(s.itemId) ?? 0) + s.pallets);

  let fitted = 0;
  let beat = 0;
  const gains: number[] = [];
  const atRisk: Finding[] = [];
  const weeks = Math.floor(keys.length / 7);
  const offset = keys.length - weeks * 7; // drop the incomplete oldest week
  for (const item of data.items) {
    const daily = new Array<number>(keys.length).fill(0);
    for (const o of shipped) {
      const i = index.get(ymd(o.date));
      if (i === undefined) continue;
      for (const l of o.lines) if (l.itemId === item.id) daily[i] += l.pallets;
    }
    if (sum(daily) < 10) continue;
    const weekly = Array.from({ length: weeks }, (_, w) => sum(daily.slice(offset + w * 7, offset + w * 7 + 7)));
    const holt = holtDamped(weekly);
    if (!holt) continue;
    const test = backtestTotal(weekly);
    fitted++;
    // Keep, for each item, whichever method predicted its past best: the trend model, or the plain 4-week average.
    const useHolt = !test || test.model <= test.naive;
    if (useHolt) beat++;
    if (test && test.naive > 0) gains.push(1 - Math.min(test.model, test.naive) / test.naive);
    const level4 = mean(weekly.slice(-4));
    const model = useHolt ? holt : { sigma: sd(weekly.slice(-12)), forecast: (h: number) => new Array<number>(h).fill(level4) };
    const error = test ? Math.min(test.model, test.naive) : null;

    // Spread each forecast week over the days the way this item usually ships (Mondays heavier, Sundays nothing).
    const byWeekday = new Array<number>(7).fill(0);
    keys.forEach((k, i) => (byWeekday[weekday(new Date(`${k}T12:00:00Z`))] += daily[i]));
    const share = byWeekday.map((v) => v / Math.max(1, sum(byWeekday)));
    const horizon = 28;
    const perWeek = model.forecast(horizon / 7);
    const stockFree = Math.max(0, free.get(item.id) ?? 0);
    const mid: number[] = [];
    const lo: number[] = [];
    const hi: number[] = [];
    let cum = 0;
    for (let h = 1; h <= horizon; h++) {
      const day = new Date(data.now.getTime() + h * DAY);
      cum += perWeek[Math.floor((h - 1) / 7)] * share[weekday(day)];
      const band = 1.96 * model.sigma * Math.sqrt(h / 7);
      mid.push(stockFree - cum);
      lo.push(stockFree - cum - band); // demand on the high side
      hi.push(stockFree - cum + band); // demand on the low side
    }
    const out = (line: number[]) => {
      const h = line.findIndex((v) => v <= 0);
      return h === -1 ? null : h + 1;
    };
    const days = out(mid);
    const earliest = out(lo);
    const latest = out(hi);
    if (days === null || days > 21) continue;

    const client = clientById.get(item.clientId)!;
    const last4 = sum(weekly.slice(-4));
    const prev4 = sum(weekly.slice(-8, -4));
    const change = prev4 ? last4 / prev4 - 1 : 0;
    const perDay = sum(perWeek) / horizon;
    const order = Math.max(1, Math.ceil(sum(perWeek) - stockFree + perWeek[0])); // four weeks of demand plus a week of safety
    const when = (h: number | null) => (h === null ? "after 4 weeks" : dayFmt.format(new Date(data.now.getTime() + h * DAY)));
    const sendBy = new Date(data.now.getTime() + Math.max(1, (earliest ?? days) - 2) * DAY);
    const relError = error !== null && last4 ? error / last4 : null;

    atRisk.push({
      id: `stockout-${item.sku}`,
      kind: "stockout",
      score: Math.min(98, 95 - days * 2),
      title: `${item.sku} runs out in about ${plural(days, "day")}`,
      body:
        `${client.name} has ${plural(stockFree, "free pallet")} of ${item.sku} (${item.description}). ` +
        `${change > 0.15 ? `Demand is up ${pct(change)} on the previous four weeks. ` : change < -0.15 ? `Demand is down ${pct(-change)} on the previous four weeks. ` : ""}` +
        `At the forecast pace of ${perDay.toFixed(1)} pallets a day it runs out around ${when(days)} (95% range: ${when(earliest)} to ${when(latest)}). ` +
        `About ${plural(order, "pallet")} should arrive before ${dayFmt.format(sendBy)}.`,
      method:
        `Weekly demand over ${weeks} weeks, spread over the days with this item's weekday pattern. Two methods back-tested from ${test?.origins ?? 0} past starting points on the 4-week total: ` +
        `Holt's damped trend (α=${holt.alpha}, β=${holt.beta}, φ=${holt.phi}) off by ${test ? test.model.toFixed(1) : "?"} pallets, the 4-week average off by ${test ? test.naive.toFixed(1) : "?"}. ` +
        `Using ${useHolt ? "Holt" : "the 4-week average"}.`,
      confidence: relError === null ? "low" : relError < 0.25 ? "high" : relError < 0.5 ? "medium" : "low",
      evidence: [
        { label: "Free pallets", value: String(stockFree) },
        { label: "Forecast", value: `${perDay.toFixed(1)} / day` },
        { label: "Last 4 weeks", value: `${last4} pallets` },
        { label: "Runs out", value: `${when(days)} (${when(earliest)} – ${when(latest)})` },
      ],
      chart: { type: "stockout", weekly: weekly.slice(-12), free: stockFree, mid, lo, hi },
      actions: [
        {
          kind: "notice",
          label: `Warn ${client.name.split(",")[0]}`,
          to: client.name,
          text:
            `${hola(client.contact)} al ritmo de salidas de las últimas semanas, el stock de ${item.sku} (${item.description}) se os acaba hacia el ${esFmt.format(new Date(data.now.getTime() + days * DAY))}. ` +
            `Os quedan ${stockFree} palés libres. Para no quedaros sin servicio, os recomendamos mandar unos ${order} palés antes del ${esFmt.format(sendBy)}. Un saludo.`,
        },
      ],
    });
  }
  findings.push(...atRisk.sort((a, b) => b.score - a.score).slice(0, 3));
  const avgGain = gains.length ? mean(gains) : 0;
  steps.push({
    kind: "tool",
    text: `forecast: ${fitted} items, Holt (damped trend) vs 4-week average back-tested per item; Holt kept for ${beat}; 4-week error ${pct(avgGain)} lower than the plain average; ${atRisk.length} run out within 3 weeks`,
  });
}

// ─── 2. When each building fills up ─────────────────────────────────────────────────────────
function space(
  data: AnalystData,
  keys: string[],
  index: Map<string, number>,
  shipped: AnalystData["outbounds"],
  findings: Finding[],
  gaps: Gap[],
  steps: Step[],
) {
  const fitDays = Math.min(56, keys.length);
  if (fitDays < 42) {
    gaps.push({
      topic: "Space forecast",
      text: `Stock goes up with every truck and down with every order, so a real trend only shows over at least six weeks of daily levels; ${keys.length} days would mistake a few big deliveries for growth.`,
    });
    return;
  }
  // Free rack slots right now, as the 3D shows them: pallets still on a dock lane (REC-n, EXP-n) are not in a rack.
  const rackFree = new Map(
    data.warehouses.map((w) => [
      w.id,
      makeLayout(w.dims).capacity - sum(data.stock.filter((s) => s.warehouseId === w.id && !/^(REC|EXP)-/.test(s.location)).map((s) => s.pallets)),
    ]),
  );
  for (const w of data.warehouses) {
    const capacity = makeLayout(w.dims).capacity;
    const series = dailyLevels(data, keys, index, shipped, (wid) => wid === w.id);
    const now = series[series.length - 1];
    const recent = series.slice(-fitDays);
    const fit = ols(recent.map((_, i) => i), recent);
    const growing = fit.slope - 1.96 * fit.seSlope > 0;
    steps.push({ kind: "tool", text: `space ${w.code}: ${now}/${capacity} pallets, trend ${fit.slope >= 0 ? "+" : ""}${fit.slope.toFixed(2)} a day (±${(1.96 * fit.seSlope).toFixed(2)})` });
    if (!growing) continue;
    // Already full: the alerts say so today, a "full in N weeks" forecast would not make sense.
    if (now >= capacity) continue;
    const daysToFull = (capacity - now) / fit.slope;
    if (daysToFull > 90) continue;
    const fast = (capacity - now) / (fit.slope + 1.96 * fit.seSlope);
    const slow = fit.slope - 1.96 * fit.seSlope > 0 ? (capacity - now) / (fit.slope - 1.96 * fit.seSlope) : null;
    const weeks = Math.max(1, Math.round(daysToFull / 7));

    // Who is filling it: change in pallets per customer over the fit window.
    const growth = data.clients
      .map((c) => {
        const s = dailyLevels(data, keys, index, shipped, (wid, cid) => wid === w.id && cid === c.id);
        return { c, delta: s[s.length - 1] - s[s.length - fitDays] };
      })
      .filter((g) => g.delta > 0)
      .sort((a, b) => b.delta - a.delta);
    const other = data.warehouses.filter((x) => x.id !== w.id).sort((a, b) => rackFree.get(b.id)! - rackFree.get(a.id)!)[0];
    const otherFree = other ? rackFree.get(other.id)! : 0;

    findings.push({
      id: `space-${w.code}`,
      kind: "space",
      score: daysToFull < 35 ? 88 : 70,
      title: `${w.code} will be full in about ${plural(weeks, "week")}`,
      body:
        `${w.code} holds ${now} pallets for ${capacity} rack slots (${pct(now / capacity)}) and has grown by ${fit.slope.toFixed(1)} pallets a day over the last ${Math.round(fitDays / 7)} weeks. ` +
        (growth[0] ? `Most of it is ${growth[0].c.name} (+${growth[0].delta} pallets)${growth[1] ? ` and ${growth[1].c.name} (+${growth[1].delta})` : ""}. ` : "") +
        `At this pace there is no room left around ${dayFmt.format(new Date(data.now.getTime() + daysToFull * DAY))}` +
        (other && otherFree > 0 ? `. ${other.code} has ${otherFree} free slots: the next deliveries of slow items can go there.` : "."),
      method: `Daily stock rebuilt from every inbound and outbound, then a straight-line fit (least squares) over the last ${fitDays} days: ${fit.slope.toFixed(2)} ± ${(1.96 * fit.seSlope).toFixed(2)} pallets a day (95%), R² ${fit.r2.toFixed(2)}.`,
      confidence: fit.r2 > 0.5 ? "high" : "medium",
      evidence: [
        { label: "Occupancy", value: `${now} / ${capacity}` },
        { label: "Trend", value: `+${fit.slope.toFixed(1)} pallets / day` },
        { label: "Full", value: `${dayFmt.format(new Date(data.now.getTime() + fast * DAY))} – ${slow ? dayFmt.format(new Date(data.now.getTime() + slow * DAY)) : "later"}` },
      ],
      chart: { type: "occupancy", series: recent, capacity, fit: { intercept: fit.intercept, slope: fit.slope }, horizon: Math.min(120, Math.ceil(daysToFull) + 7) },
      actions: [
        { kind: "link", label: `See the oldest stock in ${w.code}`, href: `/office/warehouse?w=${w.code}&color=age` },
        ...(growth[0] ? [{ kind: "link" as const, label: `Open ${growth[0].c.name.split(",")[0]}`, href: `/office/clients/${growth[0].c.code}` }] : []),
      ],
    });
  }
}

/** Pallets in the building at the end of each day, rebuilt backwards from today's stock. */
function dailyLevels(
  data: AnalystData,
  keys: string[],
  index: Map<string, number>,
  shipped: AnalystData["outbounds"],
  match: (warehouseId: string | null, clientId: string) => boolean,
) {
  const delta = new Array<number>(keys.length + 1).fill(0); // net change per day; last slot is today
  const todayKey = ymd(data.now);
  const at = (d: Date) => (ymd(d) === todayKey ? keys.length : index.get(ymd(d)));
  for (const i of data.inbounds) {
    if ((i.status !== "RECEIVED" && i.status !== "CLOSED") || !match(i.warehouseId, i.clientId)) continue;
    const k = at(i.date);
    if (k !== undefined) delta[k] += sum(i.lines.map((l) => l.pallets));
  }
  for (const o of shipped) {
    if (o.status === "PREPARED" || !match(o.warehouseId, o.clientId)) continue;
    const k = at(o.date);
    if (k !== undefined) delta[k] -= sum(o.lines.map((l) => l.pallets));
  }
  let level = sum(data.stock.filter((s) => match(s.warehouseId, s.clientId)).map((s) => s.pallets));
  const series = new Array<number>(keys.length).fill(0);
  level -= delta[keys.length]; // end of yesterday
  for (let k = keys.length - 1; k >= 0; k--) {
    series[k] = level;
    level -= delta[k];
  }
  series.push(series[series.length - 1] + delta[keys.length]);
  return series;
}

// ─── 3. Is what moves most closest to the dock ──────────────────────────────────────────────
function slotting(data: AnalystData, shipped: AnalystData["outbounds"], findings: Finding[], gaps: Gap[], steps: Step[]) {
  const pickDays = Math.min(60, data.days);
  if (pickDays < 14) {
    gaps.push({ topic: "Slotting", text: "Which items are fast movers needs at least two weeks of picks." });
    return;
  }
  const since = data.now.getTime() - pickDays * DAY;
  for (const w of data.warehouses) {
    const layout = makeLayout(w.dims);
    const picks = new Map<string, number>();
    for (const o of shipped) {
      if (o.warehouseId !== w.id || o.date.getTime() < since) continue;
      for (const l of o.lines) picks.set(l.itemId, (picks.get(l.itemId) ?? 0) + l.pallets);
    }
    const rack = data.stock.filter((s) => s.warehouseId === w.id && !s.outboundId && parseLocation(s.location)?.kind === "rack");
    if (!rack.length || !picks.size) continue;
    const seconds = slotSeconds(layout);
    const { classes, pareto, ranked, total } = abcClasses(picks);
    const aItems = ranked.filter(([id]) => classes.get(id) === "A").map(([id]) => id);

    // The pallets that will go out in the next two weeks: each item's oldest ones (first in, first out),
    // as many as it ships in two weeks at its recent pace. Their trips are what the layout costs.
    const HORIZON = 14;
    const due: string[] = [];
    for (const [itemId, n] of picks) {
      const mine = rack.filter((s) => s.itemId === itemId).sort((a, b) => (a.received?.getTime() ?? Infinity) - (b.received?.getTime() ?? Infinity));
      due.push(...mine.slice(0, Math.round((n / pickDays) * HORIZON)).map((s) => s.location));
    }
    if (!due.length) continue;
    const now = mean(due.map((slot) => seconds.get(slot)!));
    // With a velocity rule at put-away, the pallets due out would sit in the quickest slots.
    const best = mean([...seconds.values()].sort((a, b) => a - b).slice(0, due.length));
    const saving = 1 - best / now;
    const perMonth = ((now - best) * (total / pickDays) * 30) / 3600;
    const aSkus = aItems.map((id) => data.items.find((i) => i.id === id)!.sku);
    steps.push({
      kind: "tool",
      text: `slotting ${w.code}: ${aItems.length} of ${ranked.length} items make 80% of picks; ${due.length} pallets due out in 2 weeks at ${now.toFixed(0)} s a trip, ${best.toFixed(0)} s with a velocity rule`,
    });
    if (saving < 0.15) continue;

    findings.push({
      id: `slotting-${w.code}`,
      kind: "slotting",
      score: Math.min(60, 40 + Math.round(saving * 50)),
      title: `Put fast movers by the dock: picking in ${w.code} ${pct(saving)} faster`,
      body:
        `${plural(aItems.length, "item")} (${aSkus.slice(0, 4).join(", ")}${aSkus.length > 4 ? "…" : ""}) make 80% of the pallets picked in ${w.code}, but put-away places each pallet next to the customer's other stock, ` +
        `so fast movers often land deep in an aisle or on a top level. Fetching the ${due.length} pallets due out in the next two weeks takes ${now.toFixed(0)} s a trip. ` +
        `Placing class A items low and near the dock as they arrive would bring it to ${best.toFixed(0)} s: about ${perMonth.toFixed(1)} forklift hours a month. ` +
        `Moving pallets that are already stored is not worth it: each one is picked once, so the move costs more than it saves.`,
      method:
        `ABC analysis on ${total} pallets picked in the last ${pickDays} days. Pallets due out in 14 days = each item's oldest, at its recent pace. ` +
        `Each slot is priced in seconds: the real pick route from the dispatch lane at ${TRAVEL_MPS} m/s, plus lifting to its level and back at ${LIFT_MPS} m/s.`,
      confidence: "high",
      evidence: [
        { label: "Seconds a trip", value: `${now.toFixed(0)} → ${best.toFixed(0)} s` },
        { label: "Class A items", value: `${aItems.length} of ${ranked.length}` },
        { label: "Saved a month", value: `${perMonth.toFixed(1)} forklift hours` },
      ],
      chart: { type: "slotting", pareto, before: now, best },
      actions: [
        { kind: "rule", label: `Switch ${w.code} put-away to the velocity rule`, warehouseId: w.id, rule: "velocity" },
        { kind: "link", label: `See ${w.code} in 3D`, href: `/office/warehouse?w=${w.code}` },
      ],
    });
  }
}

// ─── 4. Which carriers are late, and when ───────────────────────────────────────────────────
function carriers(data: AnalystData, findings: Finding[], gaps: Gap[], steps: Step[]) {
  const arrivals = data.slots.filter((s) => s.arrivedAt && s.carrier);
  const late = (s: (typeof arrivals)[number]) => s.arrivedAt!.getTime() - s.startsAt.getTime() > LATE_MIN * 60 * 1000;
  if (arrivals.length < 60) {
    gaps.push({ topic: "Carrier punctuality", text: `${arrivals.length} recorded arrivals is too few to tell a late carrier from bad luck.` });
    return;
  }
  const baselineK = arrivals.filter(late).length;
  const baseline = baselineK / arrivals.length;
  const names = [...new Set(arrivals.map((s) => s.carrier!))].sort();
  type Test = { carrier: string; day: number | null; k: number; n: number; restK: number; restN: number; p: number };
  const tests: Test[] = [];
  for (const carrier of names) {
    for (const day of [null, 1, 2, 3, 4, 5, 6]) {
      const group = arrivals.filter((s) => s.carrier === carrier && (day === null || weekday(s.startsAt) === day));
      if (group.length < 6) continue;
      const k = group.filter(late).length;
      const restK = baselineK - k;
      const restN = arrivals.length - group.length;
      tests.push({ carrier, day, k, n: group.length, restK, restN, p: fisherGreater(k, group.length, restK, restN) });
    }
  }
  const q = benjaminiHochberg(tests.map((t) => t.p));
  const flagged = tests
    .map((t, i) => ({ ...t, q: q[i] }))
    .filter((t) => t.q < 0.05 && t.k / t.n >= 2 * baseline)
    .sort((a, b) => a.q - b.q);
  steps.push({ kind: "tool", text: `carriers: ${tests.length} Fisher tests (carrier and carrier × weekday), Benjamini–Hochberg → ${flagged.length} below q 0.05` });
  if (!flagged.length) {
    if (arrivals.length < 200) gaps.push({ topic: "Carrier punctuality", text: `No carrier stands out yet. With ${arrivals.length} arrivals only large differences can be told from chance; three months of slots make it reliable.` });
    return;
  }
  // Prefer the most specific explanation: a weekday cell over the whole carrier.
  const seen = new Set<string>();
  for (const t of flagged) {
    if (seen.has(t.carrier)) continue;
    const cell = t.day === null ? flagged.find((x) => x.carrier === t.carrier && x.day !== null) : t;
    const show = cell ?? t;
    seen.add(t.carrier);
    const [lo, hi] = wilson(show.k, show.n);
    const others = arrivals.filter((s) => s.carrier === show.carrier && show.day !== null && weekday(s.startsAt) !== show.day);
    const otherRate = others.length ? others.filter(late).length / others.length : null;
    const when = show.day === null ? "" : ` on ${WEEKDAY_NAMES[show.day]}s`;
    const rows: IntervalRow[] = names.map((c) => {
      const g = arrivals.filter((s) => s.carrier === c);
      const k = g.filter(late).length;
      const [l, h] = wilson(k, g.length);
      return { label: c, k, n: g.length, rate: k / g.length, lo: l, hi: h, flagged: false };
    });
    if (show.day !== null) rows.push({ label: `${show.carrier}, ${WEEKDAY_NAMES[show.day]}s`, k: show.k, n: show.n, rate: show.k / show.n, lo, hi, flagged: true });
    else rows.forEach((r) => (r.flagged = r.label === show.carrier));

    findings.push({
      id: `carrier-${show.carrier}-${show.day ?? "all"}`,
      kind: "carrier",
      score: 62 + Math.min(15, Math.round(-Math.log10(show.q))),
      title: `${show.carrier} is late${when}: ${show.k} of ${show.n} trucks`,
      body:
        `${show.carrier} turned up more than ${LATE_MIN} minutes after its slot ${show.k} times out of ${show.n}${when} (${pct(show.k / show.n)}, 95% CI ${pct(lo)}–${pct(hi)}), against ${pct(baseline)} for all trucks. ` +
        (otherRate !== null ? `On other days it is ${pct(otherRate)}, like everyone else, so it is a ${WEEKDAY_NAMES[show.day!]} problem, not a carrier problem. ` : "") +
        `A late truck holds the door and the next slot.`,
      method: `Fisher exact test for every carrier and every carrier × weekday (${tests.length} tests), corrected for multiple comparisons with Benjamini–Hochberg; ${qText(show.q)}. Late = more than ${LATE_MIN} min after the slot starts.`,
      confidence: show.q < 0.01 ? "high" : "medium",
      evidence: [
        { label: "Late", value: `${show.k} of ${show.n} (${pct(show.k / show.n)})` },
        { label: "All trucks", value: pct(baseline) },
        { label: "q-value", value: show.q < 0.001 ? "< 0.001" : show.q.toFixed(3) },
      ],
      chart: { type: "intervals", rows, baseline, unit: "late arrivals" },
      actions: [
        {
          kind: "notice",
          label: `Message ${show.carrier}`,
          to: show.carrier,
          text:
            `Hola, revisando las citas de los últimos meses, ${show.day !== null ? `los ${ES_WEEKDAYS[show.day]} ` : ""}` +
            `habéis llegado tarde a ${show.k} de ${show.n} citas. ¿Os viene mejor que os demos una franja más tarde ese día? Así no perdemos el muelle ninguno de los dos. Un saludo.`,
        },
        { kind: "link", label: "Open the dock", href: "/office/dock" },
      ],
    });
  }
}

// ─── 5. When the dock is busiest ────────────────────────────────────────────────────────────
function dockPeaks(data: AnalystData, findings: Finding[], steps: Step[]) {
  const days = [1, 2, 3, 4, 5, 6];
  const hours = Array.from({ length: 14 }, (_, i) => i + 6);
  const counts = days.map(() => hours.map(() => 0));
  const weeks = Math.max(1, data.days / 7);
  for (const s of data.slots) {
    const d = days.indexOf(weekday(s.startsAt));
    const h = hours.indexOf(hour(s.startsAt));
    if (d >= 0 && h >= 0) counts[d][h]++;
  }
  const perWeek = counts.map((row) => row.map((v) => v / weeks));
  const all = perWeek.flat();
  const avg = mean(all.filter((v) => v > 0));
  if (!avg) return;
  let best = { d: 0, h: 0, v: 0 };
  for (let d = 0; d < days.length; d++) for (let h = 0; h < hours.length - 1; h++) {
    const v = perWeek[d][h] + perWeek[d][h + 1];
    if (v > best.v) best = { d, h, v };
  }
  const ratio = best.v / 2 / avg;
  // Trucks an hour on weekday afternoons, the room there is to move them to.
  const afternoon = mean(perWeek.slice(0, 5).flatMap((row) => row.filter((_, h) => hours[h] >= 14 && hours[h] < 19)));
  steps.push({ kind: "tool", text: `dock: busiest block ${WEEKDAYS[days[best.d]]} ${hours[best.h]}–${hours[best.h] + 2} h, ${ratio.toFixed(1)}× the average hour` });
  if (ratio < 2) return;
  findings.push({
    id: "dock-peak",
    kind: "dock",
    score: 35,
    title: `${WEEKDAY_NAMES[days[best.d]]} ${hours[best.h]}–${hours[best.h] + 2} h gets ${ratio.toFixed(1)}× the average dock traffic`,
    body:
      `On an average week ${best.v.toFixed(1)} trucks come in that two-hour block, while weekday afternoons from 14:00 get ${afternoon.toFixed(1)} an hour. ` +
      `Offering flexible customers an afternoon pick-up would spread the load and cut waiting at the gate.`,
    method: `Slots started per weekday and hour over the last ${data.days} days, divided by ${weeks.toFixed(0)} weeks; compared with the average busy hour.`,
    confidence: "high",
    evidence: [
      { label: "Peak block", value: `${best.v.toFixed(1)} trucks / week` },
      { label: "Average hour", value: `${avg.toFixed(1)} trucks / week` },
    ],
    chart: { type: "heatmap", rows: days.map((d) => WEEKDAYS[d]), cols: hours.map((h) => String(h)), values: perWeek },
    actions: [{ kind: "link", label: "Open the dock", href: "/office/dock" }],
  });
}

// ─── 6. Who brings problems to the dock ─────────────────────────────────────────────────────
function quality(data: AnalystData, findings: Finding[], gaps: Gap[], steps: Step[], clientById: Map<string, AnalystData["clients"][number]>) {
  const done = data.inbounds.filter((i) => (i.status === "RECEIVED" || i.status === "CLOSED") && i.expected !== null && i.received !== null);
  if (done.length < 40) {
    gaps.push({ topic: "Delivery quality", text: `${done.length} received deliveries is too few to compare suppliers and carriers fairly.` });
    return;
  }
  const mismatch = (i: (typeof done)[number]) => i.expected !== i.received;
  const damage = (i: (typeof done)[number]) => !!i.incident && !mismatch(i);
  type Group = { family: "supplier" | "carrier"; name: string; list: typeof done; hit: (i: (typeof done)[number]) => boolean };
  const groups: Group[] = [
    ...[...new Set(done.map((i) => i.supplier).filter(Boolean))].map((name) => ({ family: "supplier" as const, name: name!, list: done.filter((i) => i.supplier === name), hit: mismatch })),
    ...[...new Set(done.map((i) => i.carrier).filter(Boolean))].map((name) => ({ family: "carrier" as const, name: name!, list: done.filter((i) => i.carrier === name), hit: damage })),
  ].filter((g) => g.list.length >= 5);
  const tests = groups.map((g) => {
    const k = g.list.filter(g.hit).length;
    const restK = done.filter(g.hit).length - k;
    return { g, k, n: g.list.length, restK, restN: done.length - g.list.length, p: fisherGreater(k, g.list.length, restK, done.length - g.list.length) };
  });
  const q = benjaminiHochberg(tests.map((t) => t.p));
  const flagged = tests.map((t, i) => ({ ...t, q: q[i] })).filter((t) => t.q < 0.05 && t.k / t.n >= 2 * (t.restK / Math.max(1, t.restN)));
  steps.push({ kind: "tool", text: `quality: ${tests.length} Fisher tests (note vs pallets by supplier, damage by carrier), Benjamini–Hochberg → ${flagged.length} below q 0.05` });
  if (!flagged.length && done.length < 120) gaps.push({ topic: "Delivery quality", text: `Nothing stands out in ${done.length} deliveries; problems that happen one time in ten need about three months of receipts to show.` });

  for (const t of flagged) {
    const [lo, hi] = wilson(t.k, t.n);
    const rest = t.restK / Math.max(1, t.restN);
    const isSupplier = t.g.family === "supplier";
    const owner = isSupplier ? clientById.get(t.g.list[0].clientId) : null;
    const rows: IntervalRow[] = tests
      .filter((x) => x.g.family === t.g.family)
      .map((x) => {
        const [l, h] = wilson(x.k, x.n);
        return { label: x.g.name, k: x.k, n: x.n, rate: x.k / x.n, lo: l, hi: h, flagged: x.g.name === t.g.name };
      })
      .sort((a, b) => b.rate - a.rate);
    findings.push({
      id: `quality-${t.g.family}-${t.g.name}`,
      kind: "quality",
      score: 55 + Math.min(15, Math.round(-Math.log10(t.q) * 3)),
      title: isSupplier
        ? `Delivery notes from ${t.g.name} don't match the truck ${pct(t.k / t.n)} of the time`
        : `${t.g.name} delivers damaged pallets ${pct(t.k / t.n)} of the time`,
      body: isSupplier
        ? `${t.k} of ${t.n} deliveries from ${t.g.name} brought fewer pallets than the note said (95% CI ${pct(lo)}–${pct(hi)}), against ${pct(rest)} for every other supplier. Each one means a claim, a call and a corrected stock figure.`
        : `${t.k} of ${t.n} deliveries brought by ${t.g.name} had crushed or broken pallets (95% CI ${pct(lo)}–${pct(hi)}), against ${pct(rest)} for the other carriers. The dock receipts have the photos.`,
      method: `Fisher exact test of each ${t.g.family} against all the others (${tests.length} tests), Benjamini–Hochberg correction; ${qText(t.q)}.`,
      confidence: t.q < 0.01 ? "high" : "medium",
      evidence: [
        { label: isSupplier ? "Notes off" : "Damaged", value: `${t.k} of ${t.n}` },
        { label: "Everyone else", value: pct(rest) },
        { label: "q-value", value: t.q < 0.001 ? "< 0.001" : t.q.toFixed(3) },
      ],
      chart: { type: "intervals", rows, baseline: rest, unit: isSupplier ? "notes that don't match" : "damaged deliveries" },
      actions: [
        isSupplier && owner
          ? {
              kind: "notice",
              label: `Tell ${owner.name.split(",")[0]}`,
              to: owner.name,
              text: `${hola(owner.contact)} en ${t.k} de las últimas ${t.n} entregas desde ${t.g.name} el albarán no cuadraba con los palés del camión (el resto de orígenes, un ${pct(rest)}). Tenéis las actas con fotos en el portal. ¿Podéis revisarlo con ellos? Un saludo.`,
            }
          : {
              kind: "notice",
              label: `Message ${t.g.name}`,
              to: t.g.name,
              text: `Hola, en ${t.k} de las últimas ${t.n} descargas vuestras hemos recibido palés dañados, bastante más que con el resto de transportistas. Os pasamos las actas con fotos. ¿Podemos ver cómo mejorar la sujeción de la carga? Un saludo.`,
            },
      ] satisfies Action[],
    });
  }
}

// ─── 7. Which customers take space but little work ──────────────────────────────────────────
function customers(
  data: AnalystData,
  keys: string[],
  index: Map<string, number>,
  shipped: AnalystData["outbounds"],
  findings: Finding[],
  gaps: Gap[],
  steps: Step[],
) {
  if (keys.length < 28) {
    gaps.push({ topic: "Customer mix", text: "Comparing the space a customer takes with the work it brings needs at least four weeks." });
    return;
  }
  const rows = data.clients.map((c) => {
    const levels = dailyLevels(data, keys, index, shipped, (_, cid) => cid === c.id);
    const palletDays = sum(levels.slice(0, -1));
    const moved =
      sum(data.inbounds.filter((i) => i.clientId === c.id && index.has(ymd(i.date))).flatMap((i) => i.lines.map((l) => l.pallets))) +
      sum(shipped.filter((o) => o.clientId === c.id && index.has(ymd(o.date))).flatMap((o) => o.lines.map((l) => l.pallets)));
    const out = sum(shipped.filter((o) => o.clientId === c.id && index.has(ymd(o.date))).flatMap((o) => o.lines.map((l) => l.pallets)));
    return { c, palletDays, moved, stay: out ? palletDays / out : Infinity };
  });
  const totalSpace = sum(rows.map((r) => r.palletDays));
  const totalWork = sum(rows.map((r) => r.moved));
  const avgStay = totalSpace / Math.max(1, sum(rows.map((r) => (Number.isFinite(r.stay) ? r.palletDays / r.stay : 0))));
  const share = rows.map((r) => ({ ...r, space: r.palletDays / totalSpace, work: r.moved / totalWork }));
  const flagged = share.filter((r) => r.space >= 0.08 && r.space >= 2 * r.work).sort((a, b) => b.space / b.work - a.space / a.work);
  steps.push({ kind: "tool", text: `customers: space (pallet-days) vs work (pallets in + out) for ${rows.length} customers → ${flagged.length} take much more space than work` });

  for (const r of flagged.slice(0, 1)) {
    const slow = data.items
      .filter((i) => i.clientId === r.c.id)
      .map((i) => ({ i, pallets: sum(data.stock.filter((s) => s.itemId === i.id).map((s) => s.pallets)), out: sum(shipped.filter((o) => index.has(ymd(o.date))).flatMap((o) => o.lines.filter((l) => l.itemId === i.id).map((l) => l.pallets))) }))
      .filter((x) => x.pallets > 0)
      .sort((a, b) => a.out / a.pallets - b.out / b.pallets)
      .slice(0, 2);
    findings.push({
      id: `customer-${r.c.code}`,
      kind: "customer",
      score: 42,
      title: `${r.c.name.split(",")[0]} takes ${pct(r.space)} of the space but brings ${pct(r.work)} of the work`,
      body:
        `Over the last ${data.days} days a pallet of ${r.c.name} stayed ${Number.isFinite(r.stay) ? Math.round(r.stay) : "∞"} days on average, against ${Math.round(avgStay)} for the warehouse. ` +
        (slow.length ? `${slow.map((x) => `${x.i.sku} (${x.pallets} pallets, ${x.out} out)`).join(" and ")} barely move. ` : "") +
        `If storage is billed per pallet-week this is fine; if the contract is mostly per movement, it is worth reviewing.`,
      method: `Daily stock per customer rebuilt from the movements and summed into pallet-days (space); pallets received plus pallets shipped (work). Flagged when space share is at least twice the work share.`,
      confidence: "high",
      evidence: [
        { label: "Space", value: pct(r.space) },
        { label: "Work", value: pct(r.work) },
        { label: "Average stay", value: `${Number.isFinite(r.stay) ? Math.round(r.stay) : "∞"} days (all: ${Math.round(avgStay)})` },
      ],
      chart: { type: "share", rows: share.sort((a, b) => b.space - a.space).map((x) => ({ label: x.c.name.split(",")[0], space: x.space, work: x.work, flagged: x.c.id === r.c.id })) },
      actions: [{ kind: "link", label: `Open ${r.c.name.split(",")[0]}`, href: `/office/clients/${r.c.code}` }],
    });
  }
}
