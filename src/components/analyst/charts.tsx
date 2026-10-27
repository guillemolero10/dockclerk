// Charts of the analyst report, plain SVG. One neutral ink for the data; red only for what the
// finding flags (it is an alert). Every mark carries its value on hover, and the numbers are also
// in the finding's text and evidence, so nothing depends on the chart alone.

import type { Chart, IntervalRow } from "@/lib/analyst/types";

const INK = "#15130f";
const MUTED = "#8a857a";
const GRID = "#d9d5c9";
const BAND = "#e4e0d5";
const ALERT = "#d23a2a";
const W = 560;

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function FindingChart({ chart }: { chart: Chart }) {
  switch (chart.type) {
    case "stockout":
      return <Stockout {...chart} />;
    case "occupancy":
      return <Occupancy {...chart} />;
    case "slotting":
      return <Slotting {...chart} />;
    case "intervals":
      return <Intervals {...chart} />;
    case "heatmap":
      return <Heatmap {...chart} />;
    case "share":
      return <Share {...chart} />;
  }
}

function Frame({ title, height, width = W, children }: { title: string; height: number; width?: number; children: React.ReactNode }) {
  return (
    <figure className="min-w-0">
      <figcaption className="cond mb-1 text-[11px] text-dock-ink/55">{title}</figcaption>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={title}>
        {children}
      </svg>
    </figure>
  );
}

const scale = (d0: number, d1: number, r0: number, r1: number) => (v: number) => r0 + ((v - d0) / (d1 - d0 || 1)) * (r1 - r0);
const path = (pts: [number, number][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join("");
const label = { fontSize: 11, fill: MUTED, fontFamily: "inherit" } as const;

// ─── Stock-out: weekly demand, then the free stock running down ──────────────────────────────
function Stockout({ weekly, free, mid, lo, hi }: Extract<Chart, { type: "stockout" }>) {
  const W = 300;
  const H = 150;
  const pad = { l: 34, r: 14, t: 18, b: 24 };
  const maxW = Math.max(...weekly, 1);
  const bw = (W - pad.l - pad.r) / weekly.length;
  const yW = scale(0, maxW, H - pad.b, pad.t);

  const yMin = Math.min(0, ...lo);
  const yMax = Math.max(free, ...hi);
  const x = scale(0, mid.length, pad.l, W - pad.r);
  const y = scale(yMin, yMax, H - pad.b, pad.t);
  const out = mid.findIndex((v) => v <= 0);
  const area = path([[x(0), y(free)], ...hi.map((v, i) => [x(i + 1), y(v)] as [number, number])]) + path(lo.map((v, i) => [x(i + 1), y(v)] as [number, number]).reverse()).replace("M", "L") + `L${x(0)},${y(free)}Z`;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Frame title="Pallets shipped per week, last 12 weeks" height={H} width={W}>
        <line x1={pad.l} x2={W - pad.r} y1={yW(0)} y2={yW(0)} stroke={GRID} />
        <text x={pad.l - 6} y={yW(maxW) + 4} textAnchor="end" {...label}>{maxW}</text>
        <text x={pad.l - 6} y={yW(0) + 4} textAnchor="end" {...label}>0</text>
        {weekly.map((v, i) => (
          <rect key={i} x={pad.l + i * bw + 2} y={yW(v)} width={bw - 4} height={Math.max(0, yW(0) - yW(v))} rx={3} fill={INK}>
            <title>{`${12 - i} weeks ago: ${v} pallets`}</title>
          </rect>
        ))}
        <text x={pad.l + (weekly.length - 0.5) * bw} y={yW(weekly.at(-1)!) - 5} textAnchor="middle" fontSize={11} fill={INK}>{weekly.at(-1)}</text>
        <text x={pad.l} y={H - 6} {...label}>12 weeks ago</text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" {...label}>last</text>
      </Frame>
      <Frame title="Free pallets over the next 4 weeks (shaded: 95% range)" height={H} width={W}>
        <path d={area} fill={BAND} />
        <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke={ALERT} strokeWidth={1} />
        <text x={W - pad.r} y={y(0) - 4} textAnchor="end" fontSize={11} fill={ALERT}>empty</text>
        <text x={pad.l - 6} y={y(free) + 4} textAnchor="end" {...label}>{free}</text>
        <path d={path([[x(0), y(free)], ...mid.map((v, i) => [x(i + 1), y(v)] as [number, number])])} fill="none" stroke={INK} strokeWidth={2} />
        {mid.map((v, i) => (
          <rect key={i} x={x(i + 0.5)} y={pad.t} width={x(1) - x(0)} height={H - pad.t - pad.b} fill="transparent">
            <title>{`Day ${i + 1}: ${Math.max(0, v).toFixed(0)} free pallets expected`}</title>
          </rect>
        ))}
        {out >= 0 && (
          <g>
            <line x1={x(out + 1)} x2={x(out + 1)} y1={pad.t} y2={H - pad.b} stroke={ALERT} strokeWidth={1} />
            <circle cx={x(out + 1)} cy={y(0)} r={4.5} fill={ALERT} stroke="#fff" strokeWidth={2} />
            <text x={x(out + 1) + 6} y={pad.t + 10} fontSize={11} fill={ALERT}>day {out + 1}</text>
          </g>
        )}
        <text x={pad.l} y={H - 6} {...label}>today</text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" {...label}>+28 days</text>
      </Frame>
    </div>
  );
}

// ─── Occupancy: daily level, the trend carried forward, the capacity line ────────────────────
function Occupancy({ series, capacity, fit, horizon }: Extract<Chart, { type: "occupancy" }>) {
  const H = 180;
  const pad = { l: 40, r: 14, t: 14, b: 24 };
  const n = series.length;
  const total = n + horizon;
  const yMin = Math.floor(Math.min(...series) * 0.9);
  const x = scale(0, total - 1, pad.l, W - pad.r);
  const y = scale(yMin, capacity * 1.04, H - pad.b, pad.t);
  const projected = (i: number) => Math.min(capacity, fit.intercept + fit.slope * i);
  const fullAt = Math.min(total - 1, Math.ceil((capacity - fit.intercept) / fit.slope));
  return (
    <Frame title={`Pallets in the building, last ${n} days and the trend carried forward`} height={H}>
      <line x1={pad.l} x2={W - pad.r} y1={y(capacity)} y2={y(capacity)} stroke={ALERT} />
      <text x={pad.l + 4} y={y(capacity) - 5} fontSize={11} fill={ALERT}>{capacity} rack slots</text>
      <text x={pad.l - 6} y={y(yMin) + 4} textAnchor="end" {...label}>{yMin}</text>
      <path d={path(series.map((v, i) => [x(i), y(v)]))} fill="none" stroke={INK} strokeWidth={2} />
      <path d={path([[x(n - 1), y(series[n - 1])], [x(fullAt), y(projected(fullAt))]])} fill="none" stroke={MUTED} strokeWidth={2} strokeDasharray="5 4" />
      <circle cx={x(n - 1)} cy={y(series[n - 1])} r={4} fill={INK} stroke="#fff" strokeWidth={2} />
      <text x={x(n - 1)} y={y(series[n - 1]) - 10} textAnchor="middle" fontSize={11} fill={INK} stroke="#fff" strokeWidth={3} paintOrder="stroke">{series[n - 1]} today</text>
      {series.map((v, i) => (
        <rect key={i} x={x(i - 0.5)} y={pad.t} width={x(1) - x(0)} height={H - pad.t - pad.b} fill="transparent">
          <title>{`${n - 1 - i === 0 ? "Today" : `${n - 1 - i} days ago`}: ${v} pallets`}</title>
        </rect>
      ))}
      <text x={pad.l} y={H - 6} {...label}>{n} days ago</text>
      <text x={x(n - 1)} y={H - 6} textAnchor="middle" {...label}>today</text>
      <text x={x(fullAt)} y={H - 6} textAnchor="end" {...label}>full</text>
    </Frame>
  );
}

// ─── Slotting: how concentrated the picks are (Pareto), plus the two figures that matter ─────
function Slotting({ pareto, before, best }: Extract<Chart, { type: "slotting" }>) {
  const W = 400;
  const H = 170;
  const pad = { l: 36, r: 14, t: 12, b: 24 };
  const x = scale(0, pareto.length, pad.l, W - pad.r);
  const y = scale(0, 1, H - pad.b, pad.t);
  const aCount = pareto.findIndex((v) => v >= 0.8) + 1;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[2fr_1fr]">
      <Frame title="Share of pallets picked, items from fastest to slowest" height={H} width={W}>
        <line x1={pad.l} x2={W - pad.r} y1={y(0.8)} y2={y(0.8)} stroke={GRID} />
        <text x={pad.l - 6} y={y(0.8) + 4} textAnchor="end" {...label}>80%</text>
        <text x={pad.l - 6} y={y(0) + 4} textAnchor="end" {...label}>0</text>
        <line x1={x(aCount)} x2={x(aCount)} y1={y(0)} y2={y(0.8)} stroke={GRID} />
        <text x={x(aCount) + 4} y={y(0.1)} {...label}>class A: {aCount} items</text>
        <path d={path([[x(0), y(0)], ...pareto.map((v, i) => [x(i + 1), y(v)] as [number, number])])} fill="none" stroke={INK} strokeWidth={2} />
        {pareto.map((v, i) => (
          <circle key={i} cx={x(i + 1)} cy={y(v)} r={i < aCount ? 4 : 3} fill={i < aCount ? INK : MUTED} stroke="#fff" strokeWidth={2}>
            <title>{`Top ${i + 1} items: ${pct(v)} of the pallets picked`}</title>
          </circle>
        ))}
        <text x={pad.l} y={H - 6} {...label}>fastest</text>
        <text x={W - pad.r} y={H - 6} textAnchor="end" {...label}>slowest</text>
      </Frame>
      <div className="space-y-3 text-center">
        <div>
          <p className="text-3xl font-semibold leading-none">{before.toFixed(0)} s</p>
          <p className="cond mt-1 text-[11px] text-dock-ink/55">a trip today</p>
        </div>
        <div>
          <p className="text-3xl font-semibold leading-none">{best.toFixed(0)} s</p>
          <p className="cond mt-1 text-[11px] text-dock-ink/55">with the velocity rule</p>
        </div>
      </div>
    </div>
  );
}

// ─── Rates with their 95% intervals, one row per group ──────────────────────────────────────
function Intervals({ rows, baseline, unit }: Extract<Chart, { type: "intervals" }>) {
  const rowH = 26;
  const pad = { l: 210, r: 70, t: 22, b: 22 };
  const H = pad.t + rows.length * rowH + pad.b;
  const max = Math.min(1, Math.max(...rows.map((r) => r.hi), baseline) * 1.1);
  const x = scale(0, max, pad.l, W - pad.r);
  const step = max > 0.5 ? 0.25 : max > 0.2 ? 0.1 : 0.05;
  const ticks = Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => Math.round(i * step * 100) / 100);
  return (
    <Frame title={`Share of ${unit}, with 95% intervals (red: stands out after correction)`} height={H}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t - 4} y2={H - pad.b} stroke={GRID} />
          <text x={x(t)} y={H - 6} textAnchor="middle" {...label}>{pct(t)}</text>
        </g>
      ))}
      <line x1={x(baseline)} x2={x(baseline)} y1={pad.t - 10} y2={H - pad.b} stroke={MUTED} strokeWidth={1.5} />
      <text x={x(baseline) + 4} y={pad.t - 10} {...label}>everyone: {pct(baseline)}</text>
      {rows.map((r: IntervalRow, i) => {
        const cy = pad.t + i * rowH + rowH / 2;
        const color = r.flagged ? ALERT : INK;
        return (
          <g key={r.label}>
            <title>{`${r.label}: ${r.k} of ${r.n} (${pct(r.rate)}), 95% interval ${pct(r.lo)}–${pct(r.hi)}`}</title>
            <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
            <text x={pad.l - 10} y={cy + 4} textAnchor="end" fontSize={11.5} fill={r.flagged ? ALERT : INK} fontWeight={r.flagged ? 600 : 400}>
              {r.label.length > 34 ? `${r.label.slice(0, 33)}…` : r.label}
            </text>
            <line x1={x(r.lo)} x2={x(r.hi)} y1={cy} y2={cy} stroke={r.flagged ? ALERT : MUTED} strokeWidth={2} strokeLinecap="round" />
            <circle cx={x(r.rate)} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={2} />
            <text x={W - pad.r + 8} y={cy + 4} {...label}>{r.k}/{r.n}</text>
          </g>
        );
      })}
    </Frame>
  );
}

// ─── Dock heatmap: trucks a week by weekday and hour, one hue light → dark ───────────────────
function Heatmap({ rows, cols, values }: Extract<Chart, { type: "heatmap" }>) {
  const pad = { l: 36, r: 8, t: 8, b: 40 };
  const cw = (W - pad.l - pad.r) / cols.length;
  const ch = 22;
  const H = pad.t + rows.length * ch + pad.b;
  const max = Math.max(...values.flat(), 0.01);
  return (
    <Frame title="Trucks a week by weekday and hour (darker = busier)" height={H}>
      {rows.map((row, r) => (
        <g key={row}>
          <text x={pad.l - 6} y={pad.t + r * ch + ch / 2 + 4} textAnchor="end" {...label}>{row}</text>
          {cols.map((col, c) => (
            <rect key={col} x={pad.l + c * cw + 1} y={pad.t + r * ch + 1} width={cw - 2} height={ch - 2} rx={3} fill={INK} fillOpacity={0.04 + 0.86 * (values[r][c] / max)}>
              <title>{`${row} ${col}:00 — ${values[r][c].toFixed(1)} trucks a week`}</title>
            </rect>
          ))}
        </g>
      ))}
      {cols.map((col, c) => (
        <text key={col} x={pad.l + c * cw + cw / 2} y={pad.t + rows.length * ch + 14} textAnchor="middle" {...label}>{col}</text>
      ))}
      <text x={pad.l} y={H - 6} {...label}>fewer</text>
      {[0.1, 0.3, 0.5, 0.7, 0.9].map((o, i) => (
        <rect key={o} x={pad.l + 40 + i * 18} y={H - 16} width={16} height={10} rx={2} fill={INK} fillOpacity={o} />
      ))}
      <text x={pad.l + 40 + 5 * 18 + 6} y={H - 6} {...label}>more trucks a week</text>
    </Frame>
  );
}

// ─── Customers: share of space against share of work, as a dumbbell per customer ────────────
function Share({ rows }: Extract<Chart, { type: "share" }>) {
  const rowH = 24;
  const pad = { l: 170, r: 20, t: 30, b: 22 };
  const H = pad.t + rows.length * rowH + pad.b;
  const max = Math.max(...rows.flatMap((r) => [r.space, r.work])) * 1.1;
  const x = scale(0, max, pad.l, W - pad.r);
  return (
    <Frame title="Share of the space (pallet-days) and of the work (pallets in and out)" height={H}>
      <circle cx={pad.l + 6} cy={10} r={5} fill={INK} />
      <text x={pad.l + 16} y={14} {...label}>space</text>
      <circle cx={pad.l + 76} cy={10} r={4.5} fill="#fff" stroke={INK} strokeWidth={2} />
      <text x={pad.l + 86} y={14} {...label}>work</text>
      {[0, max / 2].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={pad.t - 6} y2={H - pad.b} stroke={GRID} />
          <text x={x(t)} y={H - 6} textAnchor="middle" {...label}>{pct(t)}</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = pad.t + i * rowH + rowH / 2;
        const color = r.flagged ? ALERT : INK;
        return (
          <g key={r.label}>
            <title>{`${r.label}: ${pct(r.space)} of the space, ${pct(r.work)} of the work`}</title>
            <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
            <text x={pad.l - 10} y={cy + 4} textAnchor="end" fontSize={11.5} fill={color} fontWeight={r.flagged ? 600 : 400}>{r.label}</text>
            <line x1={x(r.space)} x2={x(r.work)} y1={cy} y2={cy} stroke={r.flagged ? ALERT : GRID} strokeWidth={2} />
            <circle cx={x(r.work)} cy={cy} r={4.5} fill="#fff" stroke={color} strokeWidth={2} />
            <circle cx={x(r.space)} cy={cy} r={5} fill={color} stroke="#fff" strokeWidth={2} />
          </g>
        );
      })}
    </Frame>
  );
}
