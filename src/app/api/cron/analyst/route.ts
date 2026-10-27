// Monday 07:00 (Madrid): the analyst studies the last six months and leaves its report for the office.
// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET" when that variable is set.

import { runAnalysis } from "@/lib/analyst";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const id = await runAnalysis(182, "cron");
  return Response.json({ report: id });
}
