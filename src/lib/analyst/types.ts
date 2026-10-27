// Contract between the analyses (code, numbers) and the report (model, story).

export type FindingKind = "stockout" | "space" | "slotting" | "carrier" | "dock" | "quality" | "customer";

export type IntervalRow = { label: string; k: number; n: number; rate: number; lo: number; hi: number; flagged: boolean };

export type Chart =
  | { type: "stockout"; weekly: number[]; free: number; mid: number[]; lo: number[]; hi: number[] }
  | { type: "occupancy"; series: number[]; capacity: number; fit: { intercept: number; slope: number }; horizon: number }
  | { type: "slotting"; pareto: number[]; before: number; best: number }
  | { type: "intervals"; rows: IntervalRow[]; baseline: number; unit: string }
  | { type: "heatmap"; rows: string[]; cols: string[]; values: number[][] }
  | { type: "share"; rows: { label: string; space: number; work: number; flagged: boolean }[] };

export type Action =
  | { kind: "rule"; label: string; warehouseId: string; rule: "velocity" }
  | { kind: "notice"; label: string; to: string; text: string }
  | { kind: "link"; label: string; href: string };

export type Finding = {
  id: string;
  kind: FindingKind;
  /** Priority worked out by code (0–100); the model may reorder. */
  score: number;
  title: string;
  body: string;
  /** How it was worked out, in one or two sentences a data scientist can check. */
  method: string;
  confidence: "high" | "medium" | "low";
  evidence: { label: string; value: string }[];
  chart: Chart;
  actions: Action[];
  /** Filled by the report: why it matters this week, in the model's words. */
  note?: string;
};

/** Something the analyst could not conclude, and the data it would need. */
export type Gap = { topic: string; text: string };

export type Step = { kind: "read" | "tool" | "ok" | "ask"; text: string };

export type Analysis = { findings: Finding[]; gaps: Gap[]; steps: Step[] };
