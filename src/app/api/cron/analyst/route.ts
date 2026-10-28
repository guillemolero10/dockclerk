// Monday 06:00 UTC (07:00 in Madrid in winter, 08:00 in summer): the analyst studies the last six months
// and leaves its report for the office.
// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET". Without that variable the route stays shut,
// so nobody on the internet can run the analysis (and spend model credits) by opening the URL.

import { timingSafeEqual } from "node:crypto";
import { runAnalysis } from "@/lib/analyst";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Compares two secrets without leaking, through response time, how many leading characters were right. */
function same(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !same(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  const id = await runAnalysis(182, "cron");
  return Response.json({ report: id });
}
