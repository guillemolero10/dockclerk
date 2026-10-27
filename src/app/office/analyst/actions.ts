"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { runAnalysis, WINDOWS } from "@/lib/analyst";
import { db } from "@/lib/db";
import { getSession } from "@/lib/session";

async function requireOffice() {
  const session = await getSession();
  if (session?.role !== "office") throw new Error("Only the office can do this.");
}

export async function analyzeNow(days: number) {
  await requireOffice();
  const window = WINDOWS.includes(days as (typeof WINDOWS)[number]) ? days : 182;
  const id = await runAnalysis(window, "office");
  revalidatePath("/office/analyst");
  redirect(`/office/analyst?r=${id}`);
}

/** Put-away rule of a warehouse: "velocity" (fast movers low and near the dock) or "customer". */
export async function setPutawayRule(warehouseId: string, rule: "velocity" | "customer") {
  await requireOffice();
  await db.warehouse.update({ where: { id: warehouseId }, data: { putaway: rule } });
  revalidatePath("/office/analyst");
  revalidatePath("/operator", "layout");
}
