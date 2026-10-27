// The statistics the analyst relies on. Plain functions, no dependencies, so every number
// in a report can be traced back to a formula a person can check.

export const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
export function sd(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** Ordinary least squares y = a + b·x, with the standard error of the slope. */
export function ols(x: number[], y: number[]) {
  const n = x.length;
  const mx = mean(x);
  const my = mean(y);
  const sxx = sum(x.map((v) => (v - mx) ** 2));
  const sxy = sum(x.map((v, i) => (v - mx) * (y[i] - my)));
  const slope = sxx ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const residuals = y.map((v, i) => v - (intercept + slope * x[i]));
  const sse = sum(residuals.map((r) => r * r));
  const sst = sum(y.map((v) => (v - my) ** 2));
  const seSlope = n > 2 && sxx ? Math.sqrt(sse / (n - 2) / sxx) : Infinity;
  return { slope, intercept, seSlope, r2: sst ? 1 - sse / sst : 0, n };
}

export type Holt = {
  alpha: number;
  beta: number;
  phi: number;
  /** Standard deviation of the one-step-ahead errors. */
  sigma: number;
  forecast: (h: number) => number[];
};

/**
 * Holt's linear method with a damped trend (Gardner & McKenzie), the workhorse of weekly
 * demand planning: it follows a trend without extrapolating it forever.
 * Parameters picked by grid search on the one-step-ahead squared error.
 */
export function holtDamped(series: number[]): Holt | null {
  if (series.length < 6) return null;
  let best: (Holt & { sse: number }) | null = null;
  for (const alpha of [0.1, 0.2, 0.3, 0.5, 0.7]) {
    for (const beta of [0.05, 0.1, 0.2, 0.3]) {
      for (const phi of [0.8, 0.9, 0.98]) {
        let level = series[0];
        let trend = mean(series.slice(1, 4).map((v, i) => v - series[i]));
        let sse = 0;
        const errors: number[] = [];
        for (let t = 1; t < series.length; t++) {
          const predicted = level + phi * trend;
          const error = series[t] - predicted;
          errors.push(error);
          sse += error * error;
          const prev = level;
          level = alpha * series[t] + (1 - alpha) * (level + phi * trend);
          trend = beta * (level - prev) + (1 - beta) * phi * trend;
        }
        if (!best || sse < best.sse) {
          const [l, b] = [level, trend];
          best = {
            alpha, beta, phi, sse, sigma: sd(errors),
            forecast: (h) => {
              const out: number[] = [];
              let damp = 0;
              for (let i = 1; i <= h; i++) {
                damp += phi ** i;
                out.push(Math.max(0, l + damp * b));
              }
              return out;
            },
          };
        }
      }
    }
  }
  return best;
}

/**
 * Rolling-origin back-test of the next `horizon` periods in total, the figure that decides a stock-out:
 * the model against "the same as the last `horizon` periods", from several starting points.
 */
export function backtestTotal(series: number[], horizon = 4, origins = 4) {
  const errors = { model: [] as number[], naive: [] as number[] };
  for (let o = series.length - horizon; o > series.length - horizon - origins; o--) {
    if (o < Math.max(6, horizon)) break;
    const model = holtDamped(series.slice(0, o));
    if (!model) break;
    const actual = sum(series.slice(o, o + horizon));
    errors.model.push(Math.abs(sum(model.forecast(horizon)) - actual));
    errors.naive.push(Math.abs(sum(series.slice(o - horizon, o)) - actual));
  }
  if (!errors.model.length) return null;
  return { model: mean(errors.model), naive: mean(errors.naive), origins: errors.model.length };
}

/** Wilson score interval for a proportion k/n (95 % by default). */
export function wilson(k: number, n: number, z = 1.96): [number, number] {
  if (!n) return [0, 1];
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const logFactorial = (() => {
  const cache = [0];
  return (n: number) => {
    for (let i = cache.length; i <= n; i++) cache[i] = cache[i - 1] + Math.log(i);
    return cache[n];
  };
})();

/**
 * One-sided Fisher exact test: is the rate in the group (k of n) higher than in the rest (k2 of n2)?
 * Exact, so it stays honest with the small counts a single warehouse produces.
 */
export function fisherGreater(k: number, n: number, k2: number, n2: number) {
  const total = n + n2;
  const hits = k + k2;
  const logP = (x: number) =>
    logFactorial(hits) + logFactorial(total - hits) + logFactorial(n) + logFactorial(n2) -
    logFactorial(total) - logFactorial(x) - logFactorial(hits - x) - logFactorial(n - x) - logFactorial(n2 - hits + x);
  let p = 0;
  for (let x = k; x <= Math.min(n, hits); x++) {
    if (n2 - hits + x < 0) continue;
    p += Math.exp(logP(x));
  }
  return Math.min(1, p);
}

/** Benjamini–Hochberg: q-values that keep the share of false alarms under control when testing many groups at once. */
export function benjaminiHochberg(ps: number[]) {
  const order = ps.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const q = new Array<number>(ps.length);
  let running = 1;
  for (let r = order.length - 1; r >= 0; r--) {
    running = Math.min(running, (order[r].p * ps.length) / (r + 1));
    q[order[r].i] = running;
  }
  return q;
}
