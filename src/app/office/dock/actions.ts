"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getDockDay } from "@/lib/dock/day";
import { DOCK_CLOSE_H, DOCK_OPEN_H, firstFree, overlaps, slotMinutes, type Busy } from "@/lib/dock/slots";
import { madridDay, madridHm } from "@/lib/format";
import { shipOutbound } from "@/lib/ops/floor";
import { assertRole } from "@/lib/session";
import { makeLayout } from "@/lib/warehouse/layout";

const MIN = 60 * 1000;

// Every exported function below is reachable by anybody who can POST to the site: check the role in each one.
const requireOffice = () => assertRole("office");

export type BookState = { ok?: string; error?: string; suggestion?: { dock: number; time: string } } | null;

/** Slots already taken that day in a warehouse (a no-show frees its door). */
async function busyDocks(warehouseId: string, day: { start: Date; end: Date }): Promise<Busy[]> {
  const taken = await db.dockAppointment.findMany({
    where: { warehouseId, startsAt: { gte: day.start, lt: day.end }, status: { not: "NO_SHOW" } },
    include: { inbound: { select: { number: true } }, outbound: { select: { number: true } } },
  });
  return taken.map((a) => ({
    dock: a.dock,
    start: a.startsAt.getTime(),
    end: a.endsAt.getTime(),
    label: `${a.inboundId ? "inbound" : "outbound"} Nº ${a.inbound?.number ?? a.outbound?.number}`,
  }));
}

export async function bookSlot(_: BookState, formData: FormData): Promise<BookState> {
  await requireOffice();
  const code = String(formData.get("warehouse") ?? "");
  const key = String(formData.get("order") ?? "");
  const ymd = String(formData.get("day") ?? "");
  const time = String(formData.get("time") ?? "");
  const dockChoice = String(formData.get("dock") ?? "auto");

  const warehouse = await db.warehouse.findUnique({ where: { code } });
  const [kind, id] = key.split(":") as ["in" | "out", string];
  if (!warehouse || !id || !/^\d{4}-\d{2}-\d{2}$/.test(ymd) || !/^\d{2}:\d{2}$/.test(time)) return { error: "Pick a truck, a day and a time." };

  const order =
    kind === "in"
      ? await db.inbound.findUnique({ where: { id }, include: { lines: true, appointment: true } })
      : await db.outbound.findUnique({ where: { id }, include: { lines: true, appointment: true } });
  if (!order) return { error: "That order no longer exists." };
  if (order.appointment) return { error: `Nº ${order.number} already has a slot.` };

  const pallets = (kind === "in" && "expectedPallets" in order ? order.expectedPallets : null) ?? (order.lines.length ? order.lines.reduce((s, l) => s + l.pallets, 0) : null);
  const minutes = slotMinutes(kind, pallets);
  const day = madridDay(ymd);
  const [h, m] = time.split(":").map(Number);
  const start = day.start.getTime() + (h * 60 + m) * MIN;

  const layout = makeLayout(warehouse);
  const doors = layout.docks.filter((d) => d.kind === kind).map((d) => d.n);
  const busy = await busyDocks(warehouse.id, day);

  let slot: { dock: number; start: number; end: number } | null;
  if (dockChoice === "auto") {
    slot = firstFree(busy, doors, day.start.getTime(), start, minutes);
    if (!slot) return { error: "No door is free for that long after that time today." };
  } else {
    const dock = Number(dockChoice);
    if (!doors.includes(dock)) return { error: `Dock ${dock} is for ${kind === "in" ? "dispatch" : "receiving"}.` };
    slot = { dock, start, end: start + minutes * MIN };
    const clash = busy.find((b) => b.dock === dock && overlaps(b, slot!));
    if (clash) {
      const next = firstFree(busy, doors, day.start.getTime(), start, minutes);
      return {
        error: `Dock ${dock} is taken ${madridHm(new Date(clash.start))}–${madridHm(new Date(clash.end))} by ${clash.label}.`,
        suggestion: next ? { dock: next.dock, time: madridHm(new Date(next.start)) } : undefined,
      };
    }
    const open = day.start.getTime() + DOCK_OPEN_H * 60 * MIN;
    const close = day.start.getTime() + DOCK_CLOSE_H * 60 * MIN;
    if (slot.start < open || slot.end > close) return { error: `Docks open from 0${DOCK_OPEN_H}:00 to ${DOCK_CLOSE_H}:00.` };
  }

  await db.dockAppointment.create({
    data: {
      warehouseId: warehouse.id,
      dock: slot.dock,
      startsAt: new Date(slot.start),
      endsAt: new Date(slot.end),
      inboundId: kind === "in" ? id : null,
      outboundId: kind === "out" ? id : null,
      carrierId: order.carrierId,
      plate: "plate" in order ? order.plate : null,
    },
  });
  revalidatePath("/office", "layout");
  return { ok: `Nº ${order.number}: dock ${slot.dock}, ${madridHm(new Date(slot.start))}–${madridHm(new Date(slot.end))}.` };
}

/** Truck arrived, done, no-show or cancel. Done needs the goods received or picked first. */
export async function updateSlot(formData: FormData) {
  await requireOffice();
  const id = String(formData.get("id") ?? "");
  const action = String(formData.get("action") ?? "");
  const slot = await db.dockAppointment.findUnique({ where: { id }, include: { inbound: true, outbound: true } });
  if (!slot) return;

  if (action === "arrived" && slot.status === "BOOKED") {
    await db.$transaction([
      db.dockAppointment.update({ where: { id }, data: { status: "ARRIVED", arrivedAt: new Date() } }),
      ...(slot.inbound?.status === "EXPECTED" ? [db.inbound.update({ where: { id: slot.inbound.id }, data: { status: "RECEIVING" } })] : []),
    ]);
  } else if (action === "done" && slot.status === "ARRIVED") {
    const received = slot.inbound && ["RECEIVED", "CLOSED"].includes(slot.inbound.status);
    const loaded = slot.outbound && ["PREPARED", "SHIPPED"].includes(slot.outbound.status);
    if (!received && !loaded) return;
    await db.dockAppointment.update({ where: { id }, data: { status: "DONE" } });
    if (slot.outbound?.status === "PREPARED") await shipOutbound(slot.outbound.id);
  } else if (action === "noshow" && slot.status === "BOOKED") {
    await db.dockAppointment.update({ where: { id }, data: { status: "NO_SHOW" } });
  } else if (action === "cancel" && (slot.status === "BOOKED" || slot.status === "NO_SHOW")) {
    await db.dockAppointment.delete({ where: { id } });
  }
  revalidatePath("/office", "layout");
}

/** The clerk books every truck still without a slot, as close as possible to when it is needed. */
export async function clerkSchedule(formData: FormData) {
  await requireOffice();
  const code = String(formData.get("warehouse") ?? "");
  const ymd = String(formData.get("day") ?? "");
  const data = await getDockDay(code, ymd);
  if (!data) return;

  const day = madridDay(ymd);
  const busy = await busyDocks(data.current.id, day);
  const now = Date.now();
  let booked = 0;
  for (const order of data.waiting) {
    const doors = data.docks.filter((d) => d.kind === order.kind).map((d) => d.n);
    const from = Math.max(order.preferred.getTime(), now);
    const slot = firstFree(busy, doors, day.start.getTime(), from, order.minutes);
    if (!slot) continue;
    const [kind, id] = order.key.split(":");
    const source = kind === "in" ? await db.inbound.findUnique({ where: { id } }) : await db.outbound.findUnique({ where: { id } });
    await db.dockAppointment.create({
      data: {
        warehouseId: data.current.id,
        dock: slot.dock,
        startsAt: new Date(slot.start),
        endsAt: new Date(slot.end),
        inboundId: kind === "in" ? id : null,
        outboundId: kind === "out" ? id : null,
        carrierId: source?.carrierId ?? null,
        plate: source && "plate" in source ? source.plate : null,
        bookedBy: "clerk",
      },
    });
    busy.push({ ...slot, label: `Nº ${order.number}` });
    booked++;
  }
  revalidatePath("/office", "layout");
  redirect(`/office/dock?w=${code}&day=${ymd}&clerk=${booked}`);
}
