// What needs someone's attention today, worked out from the live warehouse software.
// No model involved: every alert is a plain query, so the list is always right and instant.

import { db } from "@/lib/db";
import { firstName, fmtDate, madridDayRange, madridHm } from "@/lib/format";
import { allocatePicks } from "@/lib/warehouse/picking";
import { makeLayout } from "@/lib/warehouse/layout";

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** red: act now · amber: today · grey: keep an eye on it. */
export type AlertLevel = "red" | "amber" | "grey";
export type AlertKind = "dock" | "stock" | "expiry" | "space" | "floor" | "incident" | "slow";

export type Alert = {
  id: string;
  level: AlertLevel;
  kind: AlertKind;
  title: string;
  detail: string;
  href: string;
  action: string;
  /** Spanish notice the office can send the customer as is. */
  notice?: string;
};

const LEVEL_ORDER: Record<AlertLevel, number> = { red: 0, amber: 1, grey: 2 };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Pallets whose lot expires within this many days. */
export const EXPIRY_DAYS = 30;
/** Lots this close to expiry are red: most retailers refuse goods with less than three weeks left. */
const EXPIRY_RED_DAYS = 21;
/** Received pallets still on the dock floor after this long. */
const PUTAWAY_HOURS = 2;
/** A booked truck is late this long after its slot starts. */
const LATE_MINUTES = 15;
/** No pallet of the item has left for this long. */
const SLOW_DAYS = 21;

export async function getAlerts(now = new Date()): Promise<Alert[]> {
  const t = now.getTime();
  const today = madridDayRange(now);
  const tomorrow = madridDayRange(new Date(t + DAY));

  const [warehouses, stock, open, prepared, late, overdue, unbooked, incidents, recentOut] = await Promise.all([
    db.warehouse.findMany({ orderBy: { code: "asc" } }),
    db.stock.findMany({ include: { inbound: { select: { date: true, number: true } }, item: true, client: true } }),
    db.outbound.findMany({ where: { status: "REQUESTED" }, include: { lines: true, client: true, consignee: true, appointment: true } }),
    db.outbound.findMany({ where: { status: "PREPARED" }, include: { client: true, consignee: true, appointment: true } }),
    db.dockAppointment.findMany({
      where: { status: "BOOKED", startsAt: { gte: today.start, lt: new Date(t - LATE_MINUTES * 60000) } },
      include: { warehouse: true, carrier: true, inbound: { include: { client: true } }, outbound: { include: { client: true } } },
    }),
    db.inbound.findMany({ where: { status: "EXPECTED", date: { lt: today.start } }, include: { client: true } }),
    db.inbound.findMany({
      where: { status: "EXPECTED", date: { gte: today.start, lt: tomorrow.end }, appointment: null },
      include: { client: true },
    }),
    db.inbound.findMany({
      where: { incident: { not: null }, date: { gte: new Date(t - 7 * DAY) } },
      include: { client: true, receipt: { select: { id: true } } },
      orderBy: { date: "desc" },
    }),
    db.outbound.findMany({ where: { date: { gte: new Date(t - SLOW_DAYS * DAY) } }, select: { lines: { select: { itemId: true } } } }),
  ]);

  const alerts: Alert[] = [];
  const whName = new Map(warehouses.map((w) => [w.id, w.code]));

  // Trucks that should be at the gate by now.
  for (const a of late) {
    const who = a.inbound?.client.name ?? a.outbound?.client.name ?? "";
    const what = a.inbound ? `delivery Nº ${a.inbound.number}` : `collection Nº ${a.outbound?.number}`;
    const minutes = Math.round((t - a.startsAt.getTime()) / 60000);
    alerts.push({
      id: `late-${a.id}`,
      level: "red",
      kind: "dock",
      title: `Truck ${minutes} min late at ${a.warehouse.code} door ${a.dock}`,
      detail: `${who} · ${what} · slot ${madridHm(a.startsAt)}${a.carrier ? ` · ${a.carrier.name}` : ""}${a.plate ? ` (${a.plate})` : ""}. Call the carrier or free the door.`,
      href: `/office/dock?w=${a.warehouse.code}`,
      action: "Open the dock",
    });
  }

  // Deliveries announced for an earlier day that never turned up.
  for (const i of overdue) {
    alerts.push({
      id: `overdue-${i.id}`,
      level: "red",
      kind: "dock",
      title: `Delivery Nº ${i.number} never arrived`,
      detail: `${i.client.name} announced ${i.expectedPallets ?? "?"} pallets for ${fmtDate(i.date)}. Ask the customer whether it is still coming.`,
      href: `/office/legacy/inbounds`,
      action: "See the delivery",
      notice: `Hola${firstName(i.client.contact) ? ` ${firstName(i.client.contact)}` : ""}, la entrada Nº ${i.number} (${i.expectedPallets ?? "?"} palés) estaba prevista para el ${fmtDate(i.date)} y no ha llegado. ¿Sigue en pie o la anulamos? Un saludo.`,
    });
  }

  // Open outbounds: short of stock, or close to the deadline with nothing picked.
  const pickable = stock.map((s) => ({
    id: s.id, warehouseId: s.warehouseId, itemId: s.itemId, location: s.location, pallets: s.pallets,
    expiresAt: s.expiresAt, receivedAt: s.inbound?.date ?? null, outboundId: s.outboundId,
  }));
  const plans = allocatePicks(pickable, open.map((o) => ({ id: o.id, number: o.number, date: o.date, deadline: o.deadline, lines: o.lines })));
  for (const o of open) {
    const plan = plans.get(o.id);
    const total = o.lines.reduce((sum, l) => sum + l.pallets, 0);
    const deadline = o.deadline ?? o.date;
    const to = o.consignee?.name.split("–")[0].trim() ?? "—";
    if (plan && plan.short > 0) {
      alerts.push({
        id: `short-${o.id}`,
        level: "red",
        kind: "stock",
        title: `Outbound Nº ${o.number} is ${plural(plan.short, "pallet")} short`,
        detail: `${o.client.name} → ${to}: ${total} ordered, ${total - plan.short} in stock. Ship part or wait for the next delivery.`,
        href: `/office/warehouse?pick=${o.id}`,
        action: "See it in 3D",
        notice: `Hola${firstName(o.client.contact) ? ` ${firstName(o.client.contact)}` : ""}, para la salida Nº ${o.number} a ${to} nos pedís ${total} palés y ahora mismo tenéis ${total - plan.short} en stock. ¿Enviamos lo que hay o esperamos a la próxima entrada? Un saludo.`,
      });
      continue;
    }
    const hoursLeft = (deadline.getTime() - t) / HOUR;
    if (hoursLeft < 6 && (plan?.picked.length ?? 0) < total) {
      alerts.push({
        id: `deadline-${o.id}`,
        level: hoursLeft < 2 ? "red" : "amber",
        kind: "floor",
        title: hoursLeft < 0 ? `Outbound Nº ${o.number} is past its deadline` : `Outbound Nº ${o.number} due at ${madridHm(deadline)}`,
        detail: `${o.client.name} → ${to}: ${plan?.picked.length ?? 0} of ${total} pallets picked${plan?.warehouseId ? ` in ${whName.get(plan.warehouseId)}` : ""}.`,
        href: `/office/warehouse?pick=${o.id}`,
        action: "Light up the pick",
      });
    }
  }

  // Ready to load, but no truck booked to take it.
  for (const o of prepared.filter((x) => !x.appointment)) {
    alerts.push({
      id: `nobook-out-${o.id}`,
      level: "amber",
      kind: "dock",
      title: `Outbound Nº ${o.number} is ready but has no truck`,
      detail: `${o.client.name} → ${o.consignee?.name.split("–")[0].trim() ?? "—"}, waiting in the dispatch lane. Book a loading slot.`,
      href: `/office/dock`,
      action: "Book a slot",
    });
  }
  for (const i of unbooked) {
    alerts.push({
      id: `nobook-in-${i.id}`,
      level: "amber",
      kind: "dock",
      title: `Delivery Nº ${i.number} has no dock slot`,
      detail: `${i.client.name}, ${i.expectedPallets ?? "?"} pallets due ${i.date < today.end ? "today" : "tomorrow"}. Book a door before the truck turns up.`,
      href: `/office/dock`,
      action: "Book a slot",
    });
  }

  // Received pallets still in the receiving lanes.
  for (const w of warehouses) {
    const waiting = stock.filter((s) => s.warehouseId === w.id && s.location.startsWith("REC-"));
    if (!waiting.length) continue;
    const oldest = Math.min(...waiting.map((s) => s.inbound?.date.getTime() ?? t));
    const hours = (t - oldest) / HOUR;
    if (hours < PUTAWAY_HOURS) continue;
    alerts.push({
      id: `putaway-${w.id}`,
      level: hours > 6 ? "red" : "amber",
      kind: "floor",
      title: `${plural(waiting.length, "pallet")} waiting to be put away in ${w.code}`,
      detail: `On the dock floor for ${Math.floor(hours)} h. They block the door for the next truck.`,
      href: `/office/warehouse?w=${w.code}`,
      action: "See them in 3D",
    });
  }

  // Space: how full each building is.
  for (const w of warehouses) {
    const capacity = makeLayout(w).capacity;
    const used = stock.filter((s) => s.warehouseId === w.id && /^[A-Z]-\d{2}-\d$/.test(s.location)).reduce((sum, s) => sum + s.pallets, 0);
    const pct = Math.round((used / Math.max(capacity, 1)) * 100);
    if (pct < 85) continue;
    alerts.push({
      id: `space-${w.id}`,
      level: pct >= 95 ? "red" : "amber",
      kind: "space",
      title: `${w.code} is ${pct}% full`,
      detail: `${used} of ${capacity} rack slots taken, ${capacity - used} free. Send the next deliveries of its customers to another building or move slow stock.`,
      href: `/office/warehouse?w=${w.code}&color=age`,
      action: "See the oldest stock",
    });
  }

  // Lots about to expire, one alert per lot.
  const lots = new Map<string, { s: (typeof stock)[number]; pallets: number; days: number }>();
  for (const s of stock) {
    if (!s.expiresAt || s.outboundId) continue;
    const days = Math.ceil((s.expiresAt.getTime() - t) / DAY);
    if (days > EXPIRY_DAYS) continue;
    const key = `${s.itemId}|${s.lot}|${s.warehouseId}`;
    const entry = lots.get(key) ?? { s, pallets: 0, days };
    entry.pallets += s.pallets;
    lots.set(key, entry);
  }
  for (const [key, { s, pallets, days }] of lots) {
    const w = whName.get(s.warehouseId);
    alerts.push({
      id: `expiry-${key}`,
      level: days <= EXPIRY_RED_DAYS ? "red" : "amber",
      kind: "expiry",
      title: days <= 0 ? `Lot ${s.lot} of ${s.item.sku} has expired` : `Lot ${s.lot} of ${s.item.sku} expires in ${plural(days, "day")}`,
      detail: `${s.client.name} · ${plural(pallets, "pallet")} in ${w} · best before ${fmtDate(s.expiresAt)}. It goes out first on the next order (FEFO).`,
      href: `/office/warehouse?w=${w}&color=expiry`,
      action: "See it in 3D",
      notice: `Hola${firstName(s.client.contact) ? ` ${firstName(s.client.contact)}` : ""}, os avisamos de que el lote ${s.lot} de ${s.item.sku} (${s.item.description}) caduca el ${fmtDate(s.expiresAt)}. Tenéis ${plural(pallets, "palé", "palés")} en almacén. Saldrá primero en el próximo pedido; si queréis darle salida antes, decidnos a dónde. Un saludo.`,
    });
  }

  // Problems at the dock this week.
  for (const i of incidents) {
    alerts.push({
      id: `incident-${i.id}`,
      level: "grey",
      kind: "incident",
      title: `Incident on delivery Nº ${i.number}`,
      detail: `${i.client.name} · ${fmtDate(i.date)} · ${i.incident}`,
      href: i.receipt ? `/receipts/${i.id}` : `/office/legacy/inbounds`,
      action: i.receipt ? "Open the receipt" : "See the delivery",
    });
  }

  // Items that have not moved for weeks: candidates to free space.
  const moved = new Set(recentOut.flatMap((o) => o.lines.map((l) => l.itemId)));
  const byItem = new Map<string, { s: (typeof stock)[number]; pallets: number; oldest: number }>();
  for (const s of stock) {
    if (s.outboundId || !s.inbound) continue;
    const entry = byItem.get(s.itemId) ?? { s, pallets: 0, oldest: t };
    entry.pallets += s.pallets;
    entry.oldest = Math.min(entry.oldest, s.inbound.date.getTime());
    byItem.set(s.itemId, entry);
  }
  const slow = [...byItem.entries()]
    .filter(([itemId, e]) => t - e.oldest > SLOW_DAYS * DAY && !moved.has(itemId))
    .sort((a, b) => b[1].pallets - a[1].pallets)
    .slice(0, 5);
  for (const [itemId, { s, pallets, oldest }] of slow) {
    alerts.push({
      id: `slow-${itemId}`,
      level: "grey",
      kind: "slow",
      title: `${s.item.sku} has not moved in ${Math.floor((t - oldest) / DAY)} days`,
      detail: `${s.client.name} · ${plural(pallets, "pallet")} in ${whName.get(s.warehouseId)}, no outbound in the last three weeks.`,
      href: `/office/warehouse?w=${whName.get(s.warehouseId)}&color=age`,
      action: "See it in 3D",
    });
  }

  return alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
