// A safety belt for the paid models: how much has been spent today, and a stop at AI_DAILY_BUDGET_USD.
// The total lives in the database (table AiSpend, one row per Madrid day), so it is shared by every
// serverless instance and survives restarts and reseeds. Over the limit the callers get an ordinary error,
// exactly like "model not available", and the rules engine / report template answer instead.

import { db } from "@/lib/db";
import { madridYmd } from "@/lib/format";

const DEFAULT_BUDGET_USD = 3;

/** AI_DAILY_BUDGET_USD in dollars; 0 switches the paid models off. Blank or invalid means the default. */
export function dailyBudgetUsd() {
  const raw = process.env.AI_DAILY_BUDGET_USD?.trim();
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_BUDGET_USD;
}

/** "$3.00", or "$0.005" for tiny amounts. */
export const fmtUsd = (value: number) => `$${value >= 1 ? value.toFixed(2) : value.toFixed(3)}`;

export class DailyBudgetError extends Error {
  constructor(
    readonly spentUsd: number,
    readonly limitUsd: number,
  ) {
    super(`Daily AI budget reached: ${fmtUsd(spentUsd)} spent of ${fmtUsd(limitUsd)}`);
    this.name = "DailyBudgetError";
  }
}

const MICRO = 1_000_000;

export async function spentTodayUsd() {
  const row = await db.aiSpend.findUnique({ where: { day: madridYmd() }, select: { costMicroUsd: true } });
  return (row?.costMicroUsd ?? 0) / MICRO;
}

/** Throws DailyBudgetError when today's spend has reached the limit. If the counter cannot be read it also stops: no guard, no spending. */
export async function assertBudget() {
  const limit = dailyBudgetUsd();
  const spent = await spentTodayUsd().catch((error) => {
    console.error("AI spend counter unreadable, treating the budget as spent", error);
    return Infinity;
  });
  if (spent >= limit) throw new DailyBudgetError(spent, limit);
}

/** Adds one model call to today's total. Never throws: the answer is already paid for. */
export async function recordSpend(usage: { costUsd: number; prompt: number; completion: number }) {
  const micro = Math.round(usage.costUsd * MICRO);
  try {
    await db.aiSpend.upsert({
      where: { day: madridYmd() },
      create: { day: madridYmd(), costMicroUsd: micro, calls: 1, promptTokens: usage.prompt, completionTokens: usage.completion },
      update: { costMicroUsd: { increment: micro }, calls: { increment: 1 }, promptTokens: { increment: usage.prompt }, completionTokens: { increment: usage.completion } },
    });
  } catch (error) {
    console.error("Could not record the AI spend", error);
  }
}
