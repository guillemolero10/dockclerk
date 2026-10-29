// Seed for the simulated "legacy warehouse software".
// Every company, person and product here is invented for the demo (the data is in seed-data.ts).
// Re-running it wipes the demo data and recreates the same data (deterministic).
// Everything that can fail on the day it runs is worked out first, in memory (seed-plan.ts): if it does not add up,
// the seed stops with an error BEFORE it wipes anything, so a failed run never leaves the database empty.
// It keeps three things on purpose: the User and Session tables (the judges' passwords must not change),
// the customers' ids (so each customer account stays linked), and the AI spend counters (the daily limit is not a reset button).

import { randomUUID } from "node:crypto";
import { PrismaClient, type PalletType, type Prisma } from "@prisma/client";
import { makeLayout } from "../src/lib/warehouse/layout";
import { runAnalysis } from "../src/lib/analyst";
import { ensureDemoUsers } from "./demo-users";
import { AMERICAN_ITEMS, CONTACTS, UPCOMING, PREPARED_TODAY, carriers, clients, consignees, tariffs, warehouses } from "./seed-data";
import { REF, makeRand, outboundsInOrder, planSeed, startOfDay, takeOldest, type DockBooking } from "./seed-plan";

const db = new PrismaClient();

// Deterministic pseudo-random numbers so every run produces the same warehouse.
const rand = makeRand();
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

const DAY = 24 * 60 * 60 * 1000;
const today = startOfDay(new Date());
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY);

async function wipe() {
  await db.preInvoice.deleteMany();
  await db.handling.deleteMany();
  await db.tariff.deleteMany();
  await db.analystReport.deleteMany();
  await db.dockAppointment.deleteMany();
  await db.draft.deleteMany();
  await db.message.deleteMany();
  await db.dockReceipt.deleteMany();
  await db.stock.deleteMany();
  await db.outboundLine.deleteMany();
  await db.outbound.deleteMany();
  await db.inboundLine.deleteMany();
  await db.inbound.deleteMany();
  await db.item.deleteMany();
  // Customers are updated in place (by their stable code), never recreated: the accounts point at their ids.
  await db.client.deleteMany({ where: { code: { notIn: clients.map((c) => c.code) } } });
  await db.consignee.deleteMany();
  await db.carrier.deleteMany();
  await db.warehouse.deleteMany();
}

async function main() {
  // 1. Everything that can fail, in memory, before touching the database (the history comes first in `rand`, as it always did).
  const plan = planSeed({ today, now: Date.now(), rand });
  const history = plan.history;
  console.log(`Plan ok: ${history.inbounds.length} inbounds, ${history.outbounds.length + history.extraOutbounds.length} outbounds, ${plan.dock.length} dock bookings for today and tomorrow, racks ${plan.racks.map((r) => `${r.warehouse} ${r.pallets}/${r.slots}`).join(", ")}.`);

  // 2. Only now the old data goes.
  await wipe();

  const warehouseRows = await Promise.all(
    warehouses.map((w) => db.warehouse.create({ data: { code: w.code, name: w.name, city: w.city, ...w.dims } })),
  );
  const warehouseOfCode = (clientCode: string) => warehouseRows[warehouses.findIndex((w) => w.clients.includes(clientCode))].id;
  const warehouseOfClient = new Map<string, string>();

  const consigneeRows: { id: string; code: string }[] = [];
  for (const [code, name, address, city, aliases] of consignees) {
    consigneeRows.push(await db.consignee.create({ data: { code, name, address, city, aliases } }));
  }
  const carrierRows: { id: string; plate: string | null }[] = [];
  for (const [name, plate] of carriers) carrierRows.push(await db.carrier.create({ data: { name, plate } }));

  const itemRows: { id: string; sku: string; clientId: string; clientCode: string; unitsPerPallet: number; tracksLot: boolean }[] = [];
  for (const c of clients) {
    const fields = { name: c.name, contact: CONTACTS[c.code], type: c.type, email: c.email, phone: c.phone };
    const client = await db.client.upsert({ where: { code: c.code }, update: fields, create: { code: c.code, ...fields } });
    warehouseOfClient.set(client.id, warehouseOfCode(c.code));
    const t = tariffs[c.code];
    await db.tariff.create({ data: { clientId: client.id, ...t, storageByType: t.storageByType ?? {}, handlingPrice: t.handlingPrice ?? 10 } });
    for (const [sku, description, unit, unitsPerPallet, tracksLot] of c.items) {
      const palletType: PalletType = AMERICAN_ITEMS.has(sku) ? "AMERICAN" : "EURO";
      const item = await db.item.create({ data: { clientId: client.id, sku, description, unit, unitsPerPallet, tracksLot, palletType } });
      itemRows.push({ id: item.id, sku, clientId: client.id, clientCode: c.code, unitsPerPallet, tracksLot });
    }
  }
  const clientRows = await db.client.findMany();

  // Demo accounts: only the missing ones are created (the passwords go to ../USUARIOS-DEMO.md and nowhere else).
  const accounts = await ensureDemoUsers(db);
  console.log(`Accounts: ${accounts.created.length} created, ${accounts.relinked.length} re-linked to their customer, the rest unchanged (passwords are never printed).`);
  if (accounts.created.length) console.log(`  New: ${accounts.created.join(", ")} (password in USUARIOS-DEMO.md)`);
  if (accounts.notInFile.length) console.log(`  Not in USUARIOS-DEMO.md (password unknown here): ${accounts.notInFile.join(", ")}. Use: npm run users:reset -- <user>`);

  // Six months of history (prisma/history.ts, simulated above): the analyst studies it, and today's stock is what it leaves behind.
  const itemOf = new Map(itemRows.map((it) => [it.sku, it]));
  const warehouseIdOf = new Map(warehouseRows.map((w) => [w.code, w.id]));
  const consigneeIdOf = new Map(consigneeRows.map((c) => [c.code, c.id]));
  const inboundIdOf = new Map(history.inbounds.map((i) => [i.key, randomUUID()]));
  const outboundIdOf = new Map(history.outbounds.map((o) => [o.key, randomUUID()]));

  const pastIn = [...history.inbounds].sort((a, b) => a.date.getTime() - b.date.getTime());
  await db.inbound.createMany({
    data: pastIn.map((i) => {
      const it = itemOf.get(i.sku)!;
      const carrier = carrierRows[i.carrier];
      return {
        id: inboundIdOf.get(i.key)!, date: i.date, receivedAt: i.date, clientId: it.clientId, warehouseId: warehouseIdOf.get(i.warehouse)!,
        clientDocRef: `ALB-${between(10000, 99999)}`, supplier: i.supplier, carrierId: carrier.id, plate: carrier.plate,
        expectedPallets: i.expected, expectedUnits: i.expected * it.unitsPerPallet, receivedPallets: i.pallets, receivedUnits: i.pallets * it.unitsPerPallet,
        incident: i.incident, status: "CLOSED" as const,
      };
    }),
  });
  await db.inboundLine.createMany({
    data: pastIn.map((i) => {
      const it = itemOf.get(i.sku)!;
      return { inboundId: inboundIdOf.get(i.key)!, itemId: it.id, lot: i.lot, pallets: i.pallets, units: i.pallets * it.unitsPerPallet };
    }),
  });

  const pastOut = outboundsInOrder(history).past;
  const outboundRow = (o: (typeof pastOut)[number], docRef: string) => {
    const it = itemOf.get(o.sku)!;
    return {
      id: outboundIdOf.get(o.key)!, date: o.date, shippedAt: o.shippedAt, deadline: o.deadline, clientId: it.clientId, warehouseId: warehouseIdOf.get(o.warehouse)!,
      clientDocRef: docRef, consigneeId: consigneeIdOf.get(o.consignee)!, carrierId: carrierRows[o.carrier].id,
      status: o.day < -3 ? ("CLOSED" as const) : ("SHIPPED" as const),
      // What left on the truck, pallet by pallet, as shipOutbound records it: the lot trail.
      shipped: o.shipped.map((p) => ({ itemId: it.id, sku: p.sku, lot: p.lot, units: p.units ?? it.unitsPerPallet, location: "EXP-1", inboundId: inboundIdOf.get(p.inboundKey)! })),
    };
  };
  const lineRow = (o: (typeof pastOut)[number]) => {
    const it = itemOf.get(o.sku)!;
    return { outboundId: outboundIdOf.get(o.key)!, itemId: it.id, pallets: o.pallets, units: o.units ?? o.pallets * it.unitsPerPallet };
  };
  await db.outbound.createMany({ data: pastOut.map((o) => outboundRow(o, `PED-${between(1000, 9999)}`)) });
  await db.outboundLine.createMany({ data: pastOut.map(lineRow) });
  // The planted cases come after, with fixed references, so they do not shift the random numbers of the rest.
  history.extraOutbounds.forEach((o) => outboundIdOf.set(o.key, randomUUID()));
  await db.outbound.createMany({ data: history.extraOutbounds.map((o, i) => outboundRow(o, `PED-${7001 + i}`)) });
  await db.outboundLine.createMany({ data: history.extraOutbounds.map(lineRow) });
  await db.dockAppointment.createMany({
    data: history.slots.map((t) => ({
      warehouseId: warehouseIdOf.get(t.warehouse)!, dock: t.dock, startsAt: t.start, endsAt: t.end, status: "DONE" as const, arrivedAt: t.arrivedAt,
      carrierId: carrierRows[t.carrier].id, plate: carrierRows[t.carrier].plate,
      inboundId: t.inbound ? inboundIdOf.get(t.inbound) : undefined, outboundId: t.outbound ? outboundIdOf.get(t.outbound) : undefined,
    })),
  });

  // What is left of each lot is today's stock.
  type Balance = { itemId: string; sku: string; clientId: string; unitsPerPallet: number; pallets: number; lot: string | null; inboundId: string; received: Date; loose?: number };
  const balances: Balance[] = history.remaining.map((r) => {
    const it = itemOf.get(r.sku)!;
    return { itemId: it.id, sku: r.sku, clientId: it.clientId, unitsPerPallet: it.unitsPerPallet, pallets: r.pallets, lot: r.lot, inboundId: inboundIdOf.get(r.inboundKey)!, received: r.received, loose: r.loose };
  });

  // Ids of the records created one by one that the dock plan points at (seed-plan.ts names them with REF).
  const idOfRef = new Map<string, string>(outboundIdOf);

  // Open work for the coming days, fixed on purpose so the demo never depends on luck (UPCOMING in seed-data.ts).
  for (const [clientCode, sku, consigneeCode, pallets, inDays, hour] of UPCOMING) {
    // Still on the shelves until someone picks them: the 3D view lights them up.
    const client = clientRows.find((c) => c.code === clientCode)!;
    const item = await db.item.findFirstOrThrow({ where: { clientId: client.id, sku } });
    const date = daysAgo(-inDays);
    idOfRef.set(REF.upcoming(sku), randomUUID());
    await db.outbound.create({
      data: {
        id: idOfRef.get(REF.upcoming(sku)),
        date,
        deadline: new Date(date.getTime() + hour * 60 * 60 * 1000),
        clientId: client.id,
        clientDocRef: `PED-${between(1000, 9999)}`,
        consigneeId: consigneeRows.find((c) => c.code === consigneeCode)!.id,
        carrierId: pick(carrierRows).id,
        status: "REQUESTED",
        lines: { create: { itemId: item.id, pallets, units: pallets * item.unitsPerPallet } },
      },
    });
  }

  // Picked this morning and waiting in the dispatch lanes for their trucks: off the shelves already.
  const staged: Prisma.StockCreateManyInput[] = [];
  for (const [clientCode, sku, consigneeCode, pallets, hour] of PREPARED_TODAY) {
    const client = clientRows.find((c) => c.code === clientCode)!;
    const item = await db.item.findFirstOrThrow({ where: { clientId: client.id, sku } });
    // Oldest lots first, as the picker would take them (planSeed has already checked there are enough).
    const taken = takeOldest(balances.filter((x) => x.itemId === item.id), pallets);
    if (!taken) throw new Error(`Not enough ${sku} for the prepared outbound`);
    idOfRef.set(REF.prepared(sku), randomUUID());
    const outbound = await db.outbound.create({
      data: {
        id: idOfRef.get(REF.prepared(sku)),
        date: today,
        deadline: new Date(today.getTime() + hour * 60 * 60 * 1000),
        clientId: client.id,
        warehouseId: warehouseOfClient.get(client.id),
        clientDocRef: `PED-${between(1000, 9999)}`,
        consigneeId: consigneeRows.find((c) => c.code === consigneeCode)!.id,
        carrierId: carrierRows[2].id,
        status: "PREPARED",
        lines: { create: { itemId: item.id, pallets, units: pallets * item.unitsPerPallet } },
      },
    });
    // The picked pallets wait in the next dispatch lane of their warehouse.
    const warehouseId = warehouseOfClient.get(client.id)!;
    const lane = new Set(staged.filter((x) => x.warehouseId === warehouseId).map((x) => x.outboundId)).size + 1;
    for (const b of taken) {
      staged.push({
        warehouseId, clientId: client.id, itemId: item.id, lot: b.lot, pallets: 1, units: item.unitsPerPallet,
        location: `EXP-${lane}`, inboundId: b.inboundId, outboundId: outbound.id,
      });
    }
  }

  // Every pallet gets its own rack slot. Customers keep to their own stretch of racking,
  // with the free slots scattered in between like in any real warehouse.
  // Food and cosmetics carry a best-before date: made three days before it came in, plus the product's shelf life.
  const shelfLife: Record<string, number> = {
    "AGUA-15": 540, "REFR-NAR": 300, "HORCH-1L": 240, "CREMA-50": 900, "GEL-750": 900, "CHAMP-400": 900, "COLONIA-1": 900,
    "TURRON-DUR": 365, "TURRON-BLA": 300, POLVORON: 240, MAZAPAN: 270,
  };
  const expiringSoon = new Map([["HORCH-1L", 19], ["MAZAPAN", 26]]); // so the expiry alert has something to say
  const stockRows: Prisma.StockCreateManyInput[] = [];
  for (const [w, warehouse] of warehouseRows.entries()) {
    const slots = makeLayout(warehouses[w].dims).rackSlotsInFillOrder();
    const physical = balances.filter((b) => b.pallets > 0 && warehouseOfClient.get(b.clientId) === warehouse.id);
    const total = physical.reduce((sum, b) => sum + b.pallets, 0);
    if (total > slots.length) throw new Error(`${warehouse.code} too small: ${total} pallets for ${slots.length} slots`);

    let slot = 0;
    let placed = 0;
    for (const b of physical) {
      const life = shelfLife[b.sku];
      let expiresAt: Date | null = null;
      if (b.lot && life) {
        const soon = expiringSoon.get(b.sku);
        expiringSoon.delete(b.sku); // only the oldest lot of that item
        expiresAt = soon ? daysAgo(-soon) : new Date(b.received.getTime() + (life - 3) * DAY);
      }
      for (let i = 0; i < b.pallets; i++) {
        // Skip a slot with the probability that spreads the free space evenly.
        while (slots.length - slot > total - placed && rand() < (slots.length - slot - (total - placed)) / (slots.length - slot)) slot++;
        stockRows.push({
          warehouseId: warehouse.id, clientId: b.clientId, itemId: b.itemId, lot: b.lot, expiresAt,
          // The last row of a balance with a loose pallet holds only its few boxes.
          pallets: 1, units: b.loose && i === b.pallets - 1 ? b.loose : b.unitsPerPallet, location: slots[slot++], inboundId: b.inboundId,
        });
        placed++;
      }
    }
  }
  await db.stock.createMany({ data: [...stockRows, ...staged] });

  // Unloaded at 7:40 this morning, still on the floor of the receiving lane until put away.
  const granzas = clientRows.find((c) => c.code === "C006")!;
  const masterbatch = await db.item.findFirstOrThrow({ where: { clientId: granzas.id, sku: "MB-ROJO" } });
  const morning = await db.inbound.create({
    data: {
      date: new Date(today.getTime() + (7 * 60 + 40) * 60 * 1000),
      receivedAt: new Date(today.getTime() + (7 * 60 + 40) * 60 * 1000),
      clientId: granzas.id,
      warehouseId: warehouseOfClient.get(granzas.id),
      clientDocRef: "ALB-58210",
      supplier: "Granzas del Mediterráneo – Planta Villena",
      carrierId: carrierRows[1].id,
      plate: carrierRows[1].plate,
      expectedPallets: 5,
      expectedUnits: 5 * masterbatch.unitsPerPallet,
      receivedPallets: 5,
      receivedUnits: 5 * masterbatch.unitsPerPallet,
      status: "RECEIVED",
      lines: { create: { itemId: masterbatch.id, lot: "L2698-41", pallets: 5, units: 5 * masterbatch.unitsPerPallet } },
    },
  });
  await db.stock.createMany({
    data: Array.from({ length: 5 }, () => ({
      warehouseId: warehouseOfClient.get(granzas.id)!,
      clientId: granzas.id, itemId: masterbatch.id, lot: "L2698-41", pallets: 1, units: masterbatch.unitsPerPallet, location: "REC-3", inboundId: morning.id,
    })),
  });

  // Today's expected truck for the dock demo. Quantities arrive later with the driver's photo
  // of the delivery note, through the driver link created with it.
  const toys = clientRows.find((c) => c.code === "C001")!;
  const expectedToys = await db.inbound.create({
    data: {
      date: today,
      clientId: toys.id,
      warehouseId: warehouseOfClient.get(toys.id),
      supplier: "Juguetes Levante – Fábrica Onil",
      carrierId: carrierRows[0].id,
      plate: carrierRows[0].plate,
      status: "EXPECTED",
    },
  });

  // A second truck expected today, at the food warehouse.
  const drinks = clientRows.find((c) => c.code === "C004")!;
  const expectedDrinks = await db.inbound.create({
    data: {
      date: today,
      clientId: drinks.id,
      warehouseId: warehouseOfClient.get(drinks.id),
      clientDocRef: "ALB-61877",
      supplier: "Bebidas Montgó – Planta de Pedreguer",
      carrierId: carrierRows[4].id,
      plate: carrierRows[4].plate,
      expectedPallets: 18,
      status: "EXPECTED",
    },
  });

  // Two cases so those alerts show up in the demo. No short order on purpose: it would top the analyst's report.
  // a truck announced for tomorrow that still has no door...
  const aitana = clientRows.find((c) => c.code === "C007")!;
  await db.inbound.create({
    data: {
      date: daysAgo(-1),
      clientId: aitana.id,
      warehouseId: warehouseOfClient.get(aitana.id),
      clientDocRef: "ALB-20431",
      supplier: "Cosmética Aitana – Planta de Alcoy",
      expectedPallets: 10,
      status: "EXPECTED",
    },
  });
  // ...and a delivery from this week that came in damaged.
  const lastWeek = await db.inbound.findFirst({ where: { status: "CLOSED", incident: null, date: { gte: daysAgo(6), lt: daysAgo(1) } }, orderBy: { date: "desc" } });
  if (lastWeek) await db.inbound.update({ where: { id: lastWeek.id }, data: { incident: "2 palés con cajas aplastadas" } });

  await seedHandling(clientRows);
  idOfRef.set(REF.morning, morning.id);
  idOfRef.set(REF.expectedToys, expectedToys.id);
  idOfRef.set(REF.expectedDrinks, expectedDrinks.id);
  await seedDock(plan.dock, { warehouseIdOf, idOfRef, carrierRows });
  await seedInbox(clientRows);

  // This week's report, as the Monday run would have left it.
  await runAnalysis(182, "cron");

  const counts = await Promise.all([
    db.client.count(), db.consignee.count(), db.item.count(), db.inbound.count(), db.outbound.count(), db.stock.count(), db.message.count(),
    db.dockAppointment.count(), db.tariff.count(), db.handling.count(),
  ]);
  console.log(`Seeded: ${counts[0]} clients, ${counts[1]} consignees, ${counts[2]} items, ${counts[3]} inbounds, ${counts[4]} outbounds, ${counts[5]} stock rows, ${counts[6]} messages, ${counts[7]} dock slots, ${counts[8]} tariffs, ${counts[9]} handling jobs, 1 analyst report`);
}

// Two jobs done last month that are charged apart from the pallets: one in place of an outbound, one on top.
async function seedHandling(clientRows: { id: string; code: string }[]) {
  const toys = clientRows.find((c) => c.code === "C001")!;
  const drinks = clientRows.find((c) => c.code === "C004")!;
  const monthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const monthEnd = new Date(today.getFullYear(), today.getMonth(), 1);
  // Relabelling replaced the shipment of the same pallets: it goes on the day of the biggest outbound of last month.
  const outbounds = await db.outbound.findMany({ where: { clientId: toys.id, date: { gte: monthStart, lt: monthEnd } }, include: { lines: true } });
  const biggest = outbounds
    .map((o) => ({ o, pallets: o.lines.reduce((sum, l) => sum + l.pallets, 0) }))
    .sort((a, b) => b.pallets - a.pallets || a.o.date.getTime() - b.o.date.getTime())[0];
  const hour = (d: Date, h: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
  await db.handling.create({
    data: {
      clientId: toys.id, date: hour(biggest?.o.date ?? new Date(monthStart.getTime() + 14 * DAY), 11), pallets: Math.min(2, biggest?.pallets ?? 2), unitPrice: 10, replacesExit: true,
      note: "Relabelled for the retailer, shipped as handling instead of an outbound", source: "office",
    },
  });
  await db.handling.create({
    data: {
      clientId: drinks.id, date: hour(new Date(monthStart.getTime() + 17 * DAY), 9), pallets: 3, unitPrice: 12, replacesExit: false,
      note: "Repacked 3 pallets after a damaged delivery", source: "floor",
    },
  });
}

// Today's and tomorrow's dock plan, worked out in seed-plan.ts (planDock) before anything was wiped.
// Some trucks are left without a slot on purpose, so the clerk has something to schedule in the demo.
async function seedDock(
  bookings: DockBooking[],
  { warehouseIdOf, idOfRef, carrierRows }: { warehouseIdOf: Map<string, string>; idOfRef: Map<string, string>; carrierRows: { id: string; plate: string | null }[] },
) {
  const idOf = (ref: string) => {
    const id = idOfRef.get(ref);
    if (!id) throw new Error(`Dock plan points at ${ref}, which was not created`);
    return id;
  };
  await db.dockAppointment.createMany({
    data: bookings.map((b) => ({
      warehouseId: warehouseIdOf.get(b.warehouse)!,
      dock: b.dock,
      startsAt: b.start,
      endsAt: b.end,
      inboundId: b.inbound ? idOf(b.inbound) : undefined,
      outboundId: b.outbound ? idOf(b.outbound) : undefined,
      status: b.status,
      arrivedAt: b.arrivedAt,
      carrierId: b.carrier === null ? undefined : carrierRows[b.carrier].id,
      plate: b.carrier === null ? undefined : carrierRows[b.carrier].plate,
    })),
  });
}

async function seedInbox(clientRows: { id: string; code: string; name: string; email: string | null }[]) {
  const byCode = (code: string) => clientRows.find((c) => c.code === code)!;
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000);

  const messages: { channel: "EMAIL" | "WHATSAPP" | "PORTAL"; client: string | null; fromName: string; fromAddress?: string; subject?: string; body: string; at: number }[] = [
    // The five messages of the demo video.
    { channel: "EMAIL", client: "C001", fromName: "Marta Pérez (Juguetes Levante)", subject: "Pedido para mañana",
      body: "Buenas, mañana mandad 12 palés de la ref. PELUCHE-30 a Hipermercados Turia, que lleguen antes de las 10. Gracias, Marta.", at: 95 },
    { channel: "WHATSAPP", client: "C004", fromName: "Toni (Bebidas Montgó)",
      body: "Hola! Para el jueves necesito 6 palés de agua de litro y medio para SuperBahía Alicante. Y si puede ser 2 palés y medio de horchata también 👍", at: 80 },
    { channel: "EMAIL", client: "C001", fromName: "Marta Pérez (Juguetes Levante)", subject: "Stock",
      body: "Hola, ¿cuántos palés me quedan de PELUCHE-30 en el almacén?", at: 70 },
    { channel: "PORTAL", client: "C007", fromName: "Laura Gil (Cosmética Aitana)",
      body: "Necesito sacar 3 palés de gel de 750 para Perfumerías Lucentum el viernes por la mañana.", at: 55 },
    { channel: "WHATSAPP", client: null, fromName: "+34 611 22 33 44",
      body: "lo de siempre para el lunes porfa", at: 40 },
    // More traffic so the inbox looks like a real morning.
    { channel: "EMAIL", client: "C003", fromName: "Javier Mira (Calzados Vinalopó Sur)", subject: "¿Ha salido?",
      body: "Buenos días, ¿ha salido ya el pedido de ayer para Hogar y Más Madrid? El cliente nos lo está reclamando.", at: 150 },
    { channel: "EMAIL", client: "C002", fromName: "Compras Serra Mariola", subject: "Envío a fábrica",
      body: "Por favor, preparad 10 palés de PP natural del lote más antiguo para Inyectados Castalla, recogida mañana a primera hora.", at: 140 },
    { channel: "EMAIL", client: "C008", fromName: "Pilar (Dulces Carrascal)", subject: "Campaña Navidad",
      body: "Hola equipo, para la semana que viene vamos a necesitar 20 palés de turrón duro y 15 de blando para Grupo Costablanca Elche. ¿Tenéis suficiente stock? Si no, decidme cuánto hay.", at: 130 },
    { channel: "WHATSAPP", client: "C005", fromName: "Rosa (Textil Biar)",
      body: "Buenas, mañana pasa nuestro camión a recoger 4 palés de toallas blancas, matrícula 2210 HBK", at: 120 },
    { channel: "PORTAL", client: "C001", fromName: "Marta Pérez (Juguetes Levante)",
      body: "¿Me podéis decir qué entradas hemos tenido este mes?", at: 110 },
    { channel: "EMAIL", client: "C006", fromName: "Granzas del Mediterráneo", subject: "Factura",
      body: "Hola, no nos ha llegado la factura de septiembre, ¿nos la podéis reenviar?", at: 100 },
    { channel: "EMAIL", client: "C003", fromName: "Javier Mira (Calzados Vinalopó Sur)", subject: "Cambio de pedido",
      body: "Del pedido de botas de invierno para Hogar y Más Barcelona, en vez de 5 palés que sean 3. Gracias.", at: 60 },
    { channel: "WHATSAPP", client: "C007", fromName: "Laura Gil (Cosmética Aitana)",
      body: "Una pregunta, ¿cuánta crema de 50 ml nos queda? Y del champú?", at: 30 },
    { channel: "EMAIL", client: null, fromName: "Comercial Transportes Rápidos", subject: "Oferta de transporte",
      body: "Estimados, les presentamos nuestras nuevas tarifas de transporte para 2027. Quedamos a su disposición.", at: 20 },
    { channel: "PORTAL", client: "C004", fromName: "Toni (Bebidas Montgó)",
      body: "Mandad 8 palés de refresco de naranja a Hipermercados Turia Quart para el miércoles.", at: 10 },
  ];

  for (const m of messages) {
    const client = m.client ? byCode(m.client) : null;
    await db.message.create({
      data: {
        channel: m.channel,
        clientId: client?.id,
        fromName: m.fromName,
        fromAddress: m.fromAddress ?? (m.channel === "EMAIL" ? client?.email ?? "info@desconocido.example" : undefined),
        subject: m.subject,
        body: m.body,
        receivedAt: minutesAgo(m.at),
      },
    });
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
