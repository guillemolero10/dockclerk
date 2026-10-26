"use server";

import { redirect } from "next/navigation";
import { setSession } from "@/lib/session";

export async function enterAsOffice() {
  await setSession({ role: "office" });
  redirect("/office");
}

export async function enterAsOperator() {
  await setSession({ role: "operator" });
  redirect("/operator");
}

export async function enterAsCustomer(formData: FormData) {
  const clientId = String(formData.get("clientId") ?? "");
  if (!clientId) redirect("/");
  await setSession({ role: "customer", clientId });
  redirect("/portal");
}
