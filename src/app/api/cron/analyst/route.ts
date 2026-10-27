// Monday 06:00 UTC (07:00 in Madrid in winter, 08:00 in summer): the analyst studies the last six months
// and leaves its report for the office.
// Vercel Cron calls this with "Authorization: Bearer $CRON_SECRET". Without that variable the route stays shut,
// so nobody on the internet can run the analysis (and spend model credits) by opening the URL.

import { runAnalysis } from "@/lib/analyst";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const id = await runAnalysis(182, "cron");
  return Response.json({ report: id });
}
