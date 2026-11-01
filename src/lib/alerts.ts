// What needs someone's attention today, worked out from the live warehouse software.
// No model involved: every alert is a plain query, so the list is always right and instant.

import { db } from "@/lib/db";
import { firstName, fmtDate, madridDayRange, madridHm } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { describeUnits, unitWordFor } from "@/lib/pallets/quantity";
import { allocatePicks, describeShortage } from "@/lib/warehouse/picking";
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
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`; // customer notices only (Spanish)

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
  const { t: tr } = await getT();
  const t = now.getTime();
  const today = madridDayRange(now);
  const tomorrow = madridDayRange(new Date(t + DAY));

  const [warehouses, stock, open, prepared, late, overdue, unbooked, incidents, recentOut] = await Promise.all([
    db.warehouse.findMany({ orderBy: { code: "asc" } }),
    db.stock.findMany({ include: { inbound: { select: { date: true, number: true } }, item: true, client: true } }),
    db.outbound.findMany({ where: { status: "REQUESTED" }, include: { lines: { include: { item: true } }, client: true, consignee: true, appointment: true } }),
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
    const what = a.inbound ? tr("alx.delivery", { n: a.inbound.number }) : tr("alx.collection", { n: a.outbound?.number ?? "" });
    const minutes = Math.round((t - a.startsAt.getTime()) / 60000);
    const lateBy = minutes < 60 ? tr("alx.min", { n: minutes }) : minutes % 60 ? tr("alx.hmin", { h: Math.floor(minutes / 60), m: minutes % 60 }) : tr("alx.h", { h: Math.floor(minutes / 60) });
    alerts.push({
      id: `late-${a.id}`,
      level: "red",
      kind: "dock",
      title: tr("alx.lateTitle", { by: lateBy, wh: a.warehouse.code, dock: a.dock }),
      detail: tr("alx.lateDetail", { who, what, time: madridHm(a.startsAt), carrier: a.carrier ? ` · ${a.carrier.name}` : "", plate: a.plate ? ` (${a.plate})` : "" }),
      href: `/office/dock?w=${a.warehouse.code}`,
      action: tr("alx.openDock"),
    });
  }

  // Deliveries announced for an earlier day that never turned up.
  for (const i of overdue) {
    alerts.push({
      id: `overdue-${i.id}`,
      level: "red",
      kind: "dock",
      title: tr("alx.neverTitle", { n: i.number }),
      detail: tr("alx.neverDetail", { client: i.client.name, what: i.expectedPallets !== null ? tr("alx.pallets_due_p", { n: i.expectedPallets }) : tr("alx.aDelivery"), date: fmtDate(i.date) }),
      href: `/office/legacy/inbounds`,
      action: tr("alx.seeDelivery"),
      notice: `Hola${firstName(i.client.contact) ? ` ${firstName(i.client.contact)}` : ""}, la entrada Nº ${i.number}${i.expectedPallets !== null ? ` (${i.expectedPallets} palés)` : ""} estaba prevista para el ${fmtDate(i.date)} y no ha llegado. ¿Sigue en pie o la anulamos? Un saludo.`,
    });
  }

  // Open outbounds: short of stock, or close to the deadline with nothing picked.
  const pickable = stock.map((s) => ({
    id: s.id, warehouseId: s.warehouseId, itemId: s.itemId, location: s.location, units: s.units,
    expiresAt: s.expiresAt, receivedAt: s.inbound?.date ?? null, outboundId: s.outboundId, palletCode: s.palletCode,
  }));
  const plans = allocatePicks(pickable, open.map((o) => ({ id: o.id, number: o.number, date: o.date, deadline: o.deadline, lines: o.lines.map((l) => ({ itemId: l.itemId, units: l.units, unitsPerPallet: l.item.unitsPerPallet })) })));
  for (const o of open) {
    const plan = plans.get(o.id);
    const total = o.lines.reduce((sum, l) => sum + l.pallets, 0);
    const deadline = o.deadline ?? o.date;
    const to = o.consignee?.name.split("–")[0].trim() ?? "—";
    if (plan && plan.short > 0) {
      // In the item's own unit ("2 palés + 20 cajas"), not in pallet positions: a loose pallet is not a pallet.
      const lacking = plan.shortLines.map((s) => {
        const line = o.lines.find((l) => l.itemId === s.itemId)!;
        const word = unitWordFor(line.item.unit);
        return {
          sku: line.item.sku,
          ask: describeUnits(line.units, line.item.unitsPerPallet, word),
          have: describeUnits(Math.max(0, line.units - s.units), line.item.unitsPerPallet, word),
        };
      });
      alerts.push({
        id: `short-${o.id}`,
        level: "red",
        kind: "stock",
        title: tr("alx.shortTitle", { n: o.number, text: describeShortage(plan.shortLines, (id) => o.lines.find((l) => l.itemId === id)?.item, { of: tr("pk.of"), and: tr("pk.and") }) }),
        detail: tr("alx.shortDetail", { client: o.client.name, to, lines: lacking.map((l) => tr("alx.shortLine", { sku: l.sku, ask: l.ask, have: l.have })).join("; ") }),
        href: `/office/warehouse?pick=${o.id}`,
        action: tr("alx.seeIn3d"),
        notice: `Hola${firstName(o.client.contact) ? ` ${firstName(o.client.contact)}` : ""}, para la salida Nº ${o.number} a ${to} nos pedís ${lacking.map((l) => `${l.ask} de ${l.sku}`).join(" y ")} y ahora mismo tenéis ${lacking.map((l) => `${l.have} de ${l.sku}`).join(" y ")} en stock. ¿Enviamos lo que hay o esperamos a la próxima entrada? Un saludo.`,
      });
      continue;
    }
    const hoursLeft = (deadline.getTime() - t) / HOUR;
    if (hoursLeft < 6 && (plan?.picked.length ?? 0) < total) {
      alerts.push({
        id: `deadline-${o.id}`,
        level: hoursLeft < 2 ? "red" : "amber",
        kind: "floor",
        title: hoursLeft < 0 ? tr("alx.pastDeadline", { n: o.number }) : tr("alx.dueAt", { n: o.number, time: madridHm(deadline) }),
        detail: tr("alx.pickedOf", { client: o.client.name, to, a: plan?.picked.length ?? 0, b: total, where: plan?.warehouseId ? tr("alx.in", { wh: whName.get(plan.warehouseId) ?? "" }) : "" }),
        href: `/office/warehouse?pick=${o.id}`,
        action: tr("alx.lightUp"),
      });
    }
  }

  // Ready to load, but no truck booked to take it.
  for (const o of prepared.filter((x) => !x.appointment)) {
    alerts.push({
      id: `nobook-out-${o.id}`,
      level: "amber",
      kind: "dock",
      title: tr("alx.noTruckTitle", { n: o.number }),
      detail: tr("alx.noTruckDetail", { client: o.client.name, to: o.consignee?.name.split("–")[0].trim() ?? "—" }),
      href: `/office/dock`,
      action: tr("alx.bookSlot"),
    });
  }
  for (const i of unbooked) {
    alerts.push({
      id: `nobook-in-${i.id}`,
      level: "amber",
      kind: "dock",
      title: tr("alx.noSlotTitle", { n: i.number }),
      detail: tr("alx.noSlotDetail", { client: i.client.name, what: i.expectedPallets !== null ? tr("alx.pallets_due_p", { n: i.expectedPallets }) : tr("alx.aDelivery"), when: i.date < today.end ? tr("alx.today") : tr("alx.tomorrow") }),
      href: `/office/dock`,
      action: tr("alx.bookSlot"),
    });
  }

  // Received pallets still in the receiving lanes.
  for (const w of warehouses) {
    // A mixed pallet is several rows with one pallet ID: count pallets, not rows.
    const waiting = stock.filter((s) => s.warehouseId === w.id && s.location.startsWith("REC-") && s.pallets > 0);
    if (!waiting.length) continue;
    const oldest = Math.min(...waiting.map((s) => s.inbound?.date.getTime() ?? t));
    const hours = (t - oldest) / HOUR;
    if (hours < PUTAWAY_HOURS) continue;
    alerts.push({
      id: `putaway-${w.id}`,
      level: hours > 6 ? "red" : "amber",
      kind: "floor",
      title: tr("alx.putawayTitle", { n: tr("alx.pallet_p", { n: waiting.length }), wh: w.code }),
      detail: tr("alx.putawayDetail", { h: Math.floor(hours) }),
      href: `/office/warehouse?w=${w.code}`,
      action: tr("alx.seeThem"),
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
      title: tr("alx.fullTitle", { wh: w.code, p: pct }),
      detail: tr("alx.fullDetail", { used, cap: capacity, free: capacity - used }),
      href: `/office/warehouse?w=${w.code}&color=age`,
      action: tr("alx.seeOldest"),
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
      title: days <= 0 ? tr("alx.expiredTitle", { lot: s.lot ?? "", sku: s.item.sku }) : tr("alx.expiresTitle", { lot: s.lot ?? "", sku: s.item.sku, days: tr("alx.day_p", { n: days }) }),
      detail: tr("alx.expiryDetail", { client: s.client.name, pallets: tr("alx.pallet_p", { n: pallets }), wh: w ?? "", date: fmtDate(s.expiresAt) }),
      href: `/office/warehouse?w=${w}&color=expiry`,
      action: tr("alx.seeIn3d"),
      notice: `Hola${firstName(s.client.contact) ? ` ${firstName(s.client.contact)}` : ""}, os avisamos de que el lote ${s.lot} de ${s.item.sku} (${s.item.description}) caduca el ${fmtDate(s.expiresAt)}. Tenéis ${plural(pallets, "palé", "palés")} en almacén. Saldrá primero en el próximo pedido; si queréis darle salida antes, decidnos a dónde. Un saludo.`,
    });
  }

  // Problems at the dock this week.
  for (const i of incidents) {
    alerts.push({
      id: `incident-${i.id}`,
      level: "grey",
      kind: "incident",
      title: tr("alx.incidentTitle", { n: i.number }),
      detail: `${i.client.name} · ${fmtDate(i.date)} · ${i.incident}`,
      href: i.receipt ? `/receipts/${i.id}` : `/office/legacy/inbounds`,
      action: i.receipt ? tr("alx.openReceipt") : tr("alx.seeDelivery"),
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
      title: tr("alx.slowTitle", { sku: s.item.sku, n: Math.floor((t - oldest) / DAY) }),
      detail: tr("alx.slowDetail", { client: s.client.name, pallets: tr("alx.pallet_p", { n: pallets }), wh: whName.get(s.warehouseId) ?? "" }),
      href: `/office/warehouse?w=${whName.get(s.warehouseId)}&color=age`,
      action: tr("alx.seeIn3d"),
    });
  }

  return alerts.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
