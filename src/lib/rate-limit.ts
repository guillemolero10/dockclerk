// Fixed-window counters in the database (no Redis): "at most N of this in this window, per this key".
// Each increment is a single upsert (INSERT ... ON CONFLICT), so simultaneous requests cannot overwrite each other's count.

import { db } from "@/lib/db";

/** Counts one use of `key` and says whether it is still inside the allowance. */
export async function consume(key: string, max: number, windowMs: number): Promise<boolean> {
  return (await bump(key, windowMs)) <= max;
}

/** Adds one to the counter of `key` (starting a new window if the last one is over) and returns the new count. */
export async function bump(key: string, windowMs: number): Promise<number> {
  const now = new Date();
  // A finished window starts again from zero.
  await db.rateLimit.deleteMany({ where: { key, windowStart: { lt: new Date(now.getTime() - windowMs) } } });
  const row = await db.rateLimit.upsert({
    where: { key },
    create: { key, count: 1, windowStart: now },
    update: { count: { increment: 1 } },
  });
  return row.count;
}

/** Whether `key` already used up its allowance in the current window, without counting anything. */
export async function isLimited(key: string, max: number, windowMs: number): Promise<boolean> {
  const row = await db.rateLimit.findUnique({ where: { key } });
  return !!row && row.windowStart.getTime() > Date.now() - windowMs && row.count >= max;
}

export async function reset(key: string) {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** Housekeeping: forgets counters whose window is long over. */
export async function sweep(olderThanMs: number) {
  await db.rateLimit.deleteMany({ where: { windowStart: { lt: new Date(Date.now() - olderThanMs) } } });
}
