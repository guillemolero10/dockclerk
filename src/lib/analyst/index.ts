// The analyst agent: studies the warehouse's history and writes a report.
// Runs every Monday at 07:00 (Vercel Cron) and whenever the office presses "Analyze now".

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { analyze } from "./analyses";
import { loadAnalystData } from "./data";
import { narrate } from "./narrate";
import type { Finding, Gap, Step } from "./types";

export const WINDOWS = [30, 90, 182] as const;
const json = (value: unknown) => value as Prisma.InputJsonValue;

export async function runAnalysis(days: number, trigger: "cron" | "office") {
  const started = Date.now();
  const data = await loadAnalystData(days);
  const { findings, gaps, steps } = analyze(data);
  const { story, brain, steps: storySteps } = await narrate(findings, gaps, days);

  const byId = new Map(findings.map((f) => [f.id, f]));
  const ordered: Finding[] = story.order.map((id) => ({ ...byId.get(id)!, note: story.notes[id] }));
  const allSteps: Step[] = [...steps, ...storySteps, { kind: "ok", text: `report ready in ${((Date.now() - started) / 1000).toFixed(1)} s` }];

  const report = await db.analystReport.create({
    data: { days, trigger, brain, headline: story.headline, summary: story.summary, findings: json(ordered), gaps: json(gaps), steps: json(allSteps) },
  });
  return report.id;
}

export type StoredReport = {
  id: string;
  createdAt: Date;
  days: number;
  trigger: string;
  brain: string;
  headline: string;
  summary: string;
  findings: Finding[];
  gaps: Gap[];
  steps: Step[];
};

export async function getReport(id?: string): Promise<StoredReport | null> {
  const row = id ? await db.analystReport.findUnique({ where: { id } }) : await db.analystReport.findFirst({ orderBy: { createdAt: "desc" } });
  if (!row) return null;
  return { ...row, findings: row.findings as Finding[], gaps: row.gaps as Gap[], steps: row.steps as Step[] };
}
