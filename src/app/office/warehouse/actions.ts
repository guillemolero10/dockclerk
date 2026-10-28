"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { LIMITS, makeLayout } from "@/lib/warehouse/layout";
import { assertRole } from "@/lib/session";

// Every exported function below is reachable by anybody who can POST to the site: check the role in each one.
const requireOffice = () => assertRole("office");

function readDims(formData: FormData) {
  const num = (name: keyof typeof LIMITS | "aisleWidth") => {
    const value = Number(String(formData.get(name) ?? "").replace(",", "."));
    if (!Number.isFinite(value)) throw new Error(`Missing ${name}.`);
    if (name !== "aisleWidth") {
      const { min, max } = LIMITS[name];
      if (value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}.`);
    }
    return value;
  };
  return { length: num("length"), width: num("width"), height: num("height"), aisleWidth: num("aisleWidth"), docks: Math.round(num("docks")) };
}

/** Creates a warehouse, or updates one. Measurements are locked while the building holds stock. */
export async function saveWarehouse(formData: FormData) {
  await requireOffice();
  const code = String(formData.get("code") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  if (!name || !city) throw new Error("Name and city are required.");
  const dims = readDims(formData);
  if (makeLayout(dims).capacity < 1) throw new Error("No racking fits in those measurements.");

  let saved: string;
  if (code) {
    const existing = await db.warehouse.findUniqueOrThrow({ where: { code }, include: { _count: { select: { stock: true } } } });
    const locked = existing._count.stock > 0;
    await db.warehouse.update({ where: { code }, data: locked ? { name, city } : { name, city, ...dims } });
    saved = code;
  } else {
    const codes = (await db.warehouse.findMany({ select: { code: true } })).map((w) => Number(w.code.replace(/\D/g, "")) || 0);
    saved = `N${Math.max(0, ...codes) + 1}`;
    await db.warehouse.create({ data: { code: saved, name, city, ...dims } });
  }
  revalidatePath("/office", "layout");
  redirect(`/office/warehouse?w=${saved}`);
}

/** Only empty buildings can go. */
export async function deleteWarehouse(formData: FormData) {
  await requireOffice();
  const code = String(formData.get("code") ?? "");
  const warehouse = await db.warehouse.findUniqueOrThrow({
    where: { code },
    include: { _count: { select: { stock: true, inbounds: true, outbounds: true } } },
  });
  const used = warehouse._count.stock + warehouse._count.inbounds + warehouse._count.outbounds;
  if (used > 0) throw new Error("This warehouse has history; it cannot be deleted.");
  await db.warehouse.delete({ where: { code } });
  revalidatePath("/office", "layout");
  redirect("/office/warehouse");
}
