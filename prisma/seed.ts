// Seed for the simulated "legacy warehouse software".
// Every company, person and product here is invented for the demo.
// Re-running it wipes the demo database and recreates the same data (deterministic).

import { PrismaClient, type ClientType, type Prisma, type Unit } from "@prisma/client";
import { rackSlotsInFillOrder } from "../src/lib/warehouse/layout";

const db = new PrismaClient();

// Deterministic pseudo-random numbers so every run produces the same warehouse.
let seed = 42;
function rand() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];

const DAY = 24 * 60 * 60 * 1000;
const today = new Date();
today.setHours(0, 0, 0, 0);
const daysAgo = (n: number) => new Date(today.getTime() - n * DAY);

const clients: { code: string; name: string; type: ClientType; email: string; phone: string; items: [string, string, Unit, number, boolean][] }[] = [
  {
    code: "C001", name: "Juguetes Levante, S.L.", type: "FINISHED_GOODS", email: "pedidos@jugueteslevante.example", phone: "+34 600 100 001",
    items: [
      ["PELUCHE-30", "Peluche oso 30 cm (caja 12 uds)", "BOX", 40, false],
      ["PELUCHE-50", "Peluche oso 50 cm (caja 6 uds)", "BOX", 30, false],
      ["MUNECA-CL", "Muñeca clásica con vestido (caja 8 uds)", "BOX", 48, false],
      ["PUZZLE-500", "Puzzle 500 piezas (caja 20 uds)", "BOX", 60, false],
    ],
  },
  {
    code: "C002", name: "Polímeros Serra Mariola, S.L.", type: "RAW_MATERIAL", email: "logistica@serramariola.example", phone: "+34 600 100 002",
    items: [
      ["PP-NAT", "Granza polipropileno natural (saco 25 kg)", "BAG", 55, true],
      ["PE-AD", "Granza polietileno alta densidad (saco 25 kg)", "BAG", 55, true],
      ["ABS-NEG", "Granza ABS negro (saco 25 kg)", "BAG", 50, true],
    ],
  },
  {
    code: "C003", name: "Calzados Vinalopó Sur, S.L.", type: "FINISHED_GOODS", email: "almacen@calzadosvinalopo.example", phone: "+34 600 100 003",
    items: [
      ["ZAP-RUN-42", "Zapatilla running T42 (caja 10 pares)", "BOX", 36, false],
      ["ZAP-RUN-40", "Zapatilla running T40 (caja 10 pares)", "BOX", 36, false],
      ["BOTA-INV", "Bota invierno surtida (caja 6 pares)", "BOX", 24, false],
      ["SAND-VER", "Sandalia verano surtida (caja 12 pares)", "BOX", 40, false],
    ],
  },
  {
    code: "C004", name: "Bebidas Montgó, S.A.", type: "FINISHED_GOODS", email: "expediciones@bebidasmontgo.example", phone: "+34 600 100 004",
    items: [
      ["AGUA-15", "Agua mineral 1,5 L (pack 6)", "BOX", 84, true],
      ["REFR-NAR", "Refresco naranja 33 cl (pack 24)", "BOX", 80, true],
      ["HORCH-1L", "Horchata 1 L (caja 6)", "BOX", 100, true],
    ],
  },
  {
    code: "C005", name: "Textil Biar, S.L.", type: "FINISHED_GOODS", email: "pedidos@textilbiar.example", phone: "+34 600 100 005",
    items: [
      ["TOALLA-BL", "Toalla baño blanca (caja 20 uds)", "BOX", 32, false],
      ["SABANA-90", "Juego sábanas 90 cm (caja 10 uds)", "BOX", 40, false],
      ["MANTA-SOF", "Manta sofá (caja 8 uds)", "BOX", 24, false],
    ],
  },
  {
    code: "C006", name: "Granzas del Mediterráneo, S.L.", type: "RAW_MATERIAL", email: "compras@granzasmed.example", phone: "+34 600 100 006",
    items: [
      ["PVC-BLA", "Compuesto PVC blanco (saco 25 kg)", "BAG", 50, true],
      ["MB-ROJO", "Masterbatch rojo (saco 25 kg)", "BAG", 40, true],
      ["PS-CRIS", "Granza poliestireno cristal (saco 25 kg)", "BAG", 55, true],
    ],
  },
  {
    code: "C007", name: "Cosmética Aitana, S.L.", type: "FINISHED_GOODS", email: "logistica@cosmeticaaitana.example", phone: "+34 600 100 007",
    items: [
      ["CREMA-50", "Crema hidratante 50 ml (caja 48 uds)", "BOX", 90, true],
      ["GEL-750", "Gel de baño 750 ml (caja 12 uds)", "BOX", 70, true],
      ["CHAMP-400", "Champú 400 ml (caja 12 uds)", "BOX", 75, true],
      ["COLONIA-1", "Colonia infantil 200 ml (caja 24 uds)", "BOX", 60, true],
    ],
  },
  {
    code: "C008", name: "Dulces Carrascal, S.L.", type: "FINISHED_GOODS", email: "pedidos@dulcescarrascal.example", phone: "+34 600 100 008",
    items: [
      ["TURRON-DUR", "Turrón duro 200 g (caja 24 uds)", "BOX", 70, true],
      ["TURRON-BLA", "Turrón blando 200 g (caja 24 uds)", "BOX", 70, true],
      ["POLVORON", "Polvorones surtidos 500 g (caja 12 uds)", "BOX", 80, true],
      ["MAZAPAN", "Figuritas de mazapán 250 g (caja 20 uds)", "BOX", 80, true],
    ],
  },
];

// Two hubs of the same chain on purpose: "Hipermercados Turia" alone is ambiguous.
const consignees: [string, string, string, string, string[]][] = [
  ["D0412", "Hipermercados Turia – Plataforma Riba-roja", "Pol. Ind. El Oliveral, parcela 7", "Riba-roja de Túria", ["Turia Riba-roja", "Hiper Turia Ribarroja", "plataforma de Riba-roja"]],
  ["D0413", "Hipermercados Turia – Plataforma Quart", "Ctra. de Madrid km 342", "Quart de Poblet", ["Turia Quart", "Hiper Turia Quart"]],
  ["D0520", "SuperBahía – Centro logístico Alicante", "Av. de la Industria 14", "Alicante", ["SuperBahía Alicante", "Bahía Alicante"]],
  ["D0521", "SuperBahía – Centro logístico Murcia", "Ctra. de Alcantarilla 22", "Murcia", ["SuperBahía Murcia"]],
  ["D0610", "Grupo Costablanca – Almacén regulador Elche", "C/ Torres Quevedo 3", "Elche", ["Costablanca Elche", "almacén de Elche"]],
  ["D0611", "Grupo Costablanca – Almacén regulador Castellón", "Pol. Ind. Ciudad del Transporte", "Castellón", ["Costablanca Castellón"]],
  ["D0700", "Hogar y Más – Plataforma Madrid", "Av. de los Andes 40", "Coslada", ["Hogar y Más Madrid", "Hogar y Más Coslada"]],
  ["D0701", "Hogar y Más – Plataforma Barcelona", "C/ Motors 210", "El Prat de Llobregat", ["Hogar y Más Barcelona", "Hogar y Más El Prat"]],
  ["D0800", "Fábrica Inyectados Castalla", "Pol. Ind. Bayona, nave 12", "Castalla", ["Inyectados Castalla", "fábrica de Castalla"]],
  ["D0801", "Fábrica Moldes Ibi", "C/ Alcoi 55", "Ibi", ["Moldes Ibi"]],
  ["D0802", "Envases Plásticos Villena", "Pol. Ind. El Rubial 8", "Villena", ["Envases Villena"]],
  ["D0900", "Farmacias del Sureste – Almacén central", "C/ Velázquez 9", "Murcia", ["Farmacias del Sureste"]],
  ["D0901", "Perfumerías Lucentum", "Av. de Denia 120", "Alicante", ["Lucentum"]],
  ["D0950", "Tiendas El Rincón del Juguete – Central", "C/ Mayor 31", "Valencia", ["Rincón del Juguete"]],
  ["D0951", "Distribuciones Marina Alta", "Pol. Ind. Les Galgues 4", "Pedreguer", ["Marina Alta"]],
];

const carriers: [string, string][] = [
  ["Transportes Hermanos Sempere", "4821 KLM"],
  ["Trans-Ibi Express", "7310 JHG"],
  ["Logística Foia de Castalla", "1955 LPR"],
  ["Autónomo – Vicente Pastor", "9042 GTB"],
  ["Rutas del Vinalopó", "3367 MNS"],
];

async function wipe() {
  await db.draft.deleteMany();
  await db.message.deleteMany();
  await db.dockReceipt.deleteMany();
  await db.stock.deleteMany();
  await db.outboundLine.deleteMany();
  await db.outbound.deleteMany();
  await db.inboundLine.deleteMany();
  await db.inbound.deleteMany();
  await db.item.deleteMany();
  await db.client.deleteMany();
  await db.consignee.deleteMany();
  await db.carrier.deleteMany();
}

async function main() {
  await wipe();

  const consigneeRows = [];
  for (const [code, name, address, city, aliases] of consignees) {
    consigneeRows.push(await db.consignee.create({ data: { code, name, address, city, aliases } }));
  }
  const carrierRows = [];
  for (const [name, plate] of carriers) carrierRows.push(await db.carrier.create({ data: { name, plate } }));

  // Stock is built from the movements, so balances always match the history.
  type Balance = { itemId: string; clientId: string; unitsPerPallet: number; pallets: number; lot: string | null; inboundId: string };
  const balances: Balance[] = [];

  for (const c of clients) {
    const client = await db.client.create({ data: { code: c.code, name: c.name, type: c.type, email: c.email, phone: c.phone } });

    for (const [sku, description, unit, unitsPerPallet, tracksLot] of c.items) {
      const item = await db.item.create({ data: { clientId: client.id, sku, description, unit, unitsPerPallet, tracksLot } });

      // 1-2 inbounds per item over the last 4 weeks.
      const inboundCount = between(1, 2);
      for (let i = 0; i < inboundCount; i++) {
        const pallets = between(15, 45);
        const carrier = pick(carrierRows);
        const lot = tracksLot ? `L${between(2600, 2699)}-${between(10, 99)}` : null;
        const inbound = await db.inbound.create({
          data: {
            date: daysAgo(between(8, 28)),
            clientId: client.id,
            clientDocRef: `ALB-${between(10000, 99999)}`,
            supplier: client.name,
            carrierId: carrier.id,
            plate: carrier.plate,
            expectedPallets: pallets,
            expectedUnits: pallets * unitsPerPallet,
            receivedPallets: pallets,
            receivedUnits: pallets * unitsPerPallet,
            status: "CLOSED",
            lines: { create: { itemId: item.id, lot, pallets, units: pallets * unitsPerPallet } },
          },
        });
        balances.push({ itemId: item.id, clientId: client.id, unitsPerPallet, pallets, lot, inboundId: inbound.id });
      }
    }
  }

  // ~60 outbounds that consume stock, the newest ones still open.
  const clientRows = await db.client.findMany();
  for (let i = 0; i < 60; i++) {
    const candidates = balances.filter((b) => b.pallets >= 2);
    const balance = pick(candidates);
    const pallets = between(1, Math.min(12, balance.pallets - 1));
    balance.pallets -= pallets;
    const age = between(0, 18);
    const consignee = pick(consigneeRows);
    await db.outbound.create({
      data: {
        date: daysAgo(age),
        deadline: new Date(daysAgo(age).getTime() + between(8, 14) * 60 * 60 * 1000),
        clientId: balance.clientId,
        clientDocRef: `PED-${between(1000, 9999)}`,
        consigneeId: consignee.id,
        carrierId: pick(carrierRows).id,
        status: age > 3 ? "CLOSED" : age > 0 ? "SHIPPED" : pick(["PREPARED", "SHIPPED"] as const),
        lines: { create: { itemId: balance.itemId, pallets, units: pallets * balance.unitsPerPallet } },
      },
    });
  }

  // Open work for the coming days, fixed on purpose so the demo never depends on luck.
  const upcoming: [string, string, string, number, number, number][] = [
    ["C003", "BOTA-INV", "D0701", 5, 1, 10],
    ["C008", "TURRON-DUR", "D0610", 6, 1, 9],
    ["C004", "AGUA-15", "D0520", 4, 1, 12],
    ["C007", "CREMA-50", "D0901", 2, 2, 11],
    ["C002", "PP-NAT", "D0800", 8, 2, 8],
    ["C005", "TOALLA-BL", "D0700", 3, 2, 13],
  ];
  for (const [clientCode, sku, consigneeCode, pallets, inDays, hour] of upcoming) {
    // Still on the shelves until someone picks them: the 3D view lights them up.
    const client = clientRows.find((c) => c.code === clientCode)!;
    const item = await db.item.findFirstOrThrow({ where: { clientId: client.id, sku } });
    const date = daysAgo(-inDays);
    await db.outbound.create({
      data: {
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
  const preparedToday: [string, string, string, number, number][] = [
    ["C006", "PVC-BLA", "D0802", 6, 16],
    ["C005", "SABANA-90", "D0951", 4, 18],
  ];
  for (const [clientCode, sku, consigneeCode, pallets, hour] of preparedToday) {
    const client = clientRows.find((c) => c.code === clientCode)!;
    const item = await db.item.findFirstOrThrow({ where: { clientId: client.id, sku } });
    const balance = balances.find((b) => b.itemId === item.id && b.pallets >= pallets);
    if (!balance) throw new Error(`Not enough ${sku} for the prepared outbound`);
    balance.pallets -= pallets;
    await db.outbound.create({
      data: {
        date: today,
        deadline: new Date(today.getTime() + hour * 60 * 60 * 1000),
        clientId: client.id,
        clientDocRef: `PED-${between(1000, 9999)}`,
        consigneeId: consigneeRows.find((c) => c.code === consigneeCode)!.id,
        carrierId: carrierRows[2].id,
        status: "PREPARED",
        lines: { create: { itemId: item.id, pallets, units: pallets * item.unitsPerPallet } },
      },
    });
  }

  // Every pallet gets its own rack slot. Customers keep to their own stretch of racking,
  // with the free slots scattered in between like in any real warehouse.
  const codeOf = new Map(clientRows.map((c) => [c.id, c.code]));
  const shelfLife: Record<string, [number, number]> = { C004: [120, 400], C007: [300, 700], C008: [60, 240] };
  const expiringSoon = new Map([["HORCH-1L", 19], ["MAZAPAN", 26]]); // so the expiry alert has something to say
  const skuOf = new Map((await db.item.findMany({ select: { id: true, sku: true } })).map((i) => [i.id, i.sku]));
  const slots = rackSlotsInFillOrder();
  const physical = balances.filter((b) => b.pallets > 0);
  const total = physical.reduce((sum, b) => sum + b.pallets, 0);
  if (total > slots.length) throw new Error(`Racks too small: ${total} pallets for ${slots.length} slots`);

  const stockRows: Prisma.StockCreateManyInput[] = [];
  let slot = 0;
  for (const b of physical) {
    const life = shelfLife[codeOf.get(b.clientId)!];
    const sku = skuOf.get(b.itemId)!;
    let expiresAt: Date | null = null;
    if (b.lot && life) {
      const soon = expiringSoon.get(sku);
      expiringSoon.delete(sku); // only the oldest lot of that item
      expiresAt = daysAgo(-(soon ?? between(life[0], life[1])));
    }
    for (let i = 0; i < b.pallets; i++) {
      // Skip a slot with the probability that spreads the free space evenly.
      while (slots.length - slot > total - stockRows.length && rand() < (slots.length - slot - (total - stockRows.length)) / (slots.length - slot)) slot++;
      stockRows.push({
        clientId: b.clientId, itemId: b.itemId, lot: b.lot, expiresAt, pallets: 1, units: b.unitsPerPallet, location: slots[slot++], inboundId: b.inboundId,
      });
    }
  }
  await db.stock.createMany({ data: stockRows });

  // Unloaded at 7:40 this morning, still on the floor of the receiving lane until put away.
  const granzas = clientRows.find((c) => c.code === "C006")!;
  const masterbatch = await db.item.findFirstOrThrow({ where: { clientId: granzas.id, sku: "MB-ROJO" } });
  const morning = await db.inbound.create({
    data: {
      date: new Date(today.getTime() + (7 * 60 + 40) * 60 * 1000),
      clientId: granzas.id,
      clientDocRef: "ALB-58210",
      supplier: granzas.name,
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
      clientId: granzas.id, itemId: masterbatch.id, lot: "L2698-41", pallets: 1, units: masterbatch.unitsPerPallet, location: "REC-3", inboundId: morning.id,
    })),
  });

  // Today's expected truck for the dock demo. Quantities arrive later with the driver's photo
  // of the delivery note, through the driver link created with it.
  const toys = clientRows.find((c) => c.code === "C001")!;
  await db.inbound.create({
    data: {
      date: today,
      clientId: toys.id,
      supplier: "Juguetes Levante, S.L. – Fábrica Onil",
      carrierId: carrierRows[0].id,
      plate: carrierRows[0].plate,
      status: "EXPECTED",
    },
  });

  await seedInbox(clientRows);

  const counts = await Promise.all([
    db.client.count(), db.consignee.count(), db.item.count(), db.inbound.count(), db.outbound.count(), db.stock.count(), db.message.count(),
  ]);
  console.log(`Seeded: ${counts[0]} clients, ${counts[1]} consignees, ${counts[2]} items, ${counts[3]} inbounds, ${counts[4]} outbounds, ${counts[5]} stock rows, ${counts[6]} messages`);
}

async function seedInbox(clientRows: { id: string; code: string; name: string; email: string | null }[]) {
  const byCode = (code: string) => clientRows.find((c) => c.code === code)!;
  const minutesAgo = (n: number) => new Date(Date.now() - n * 60 * 1000);

  const messages: { channel: "EMAIL" | "WHATSAPP" | "PORTAL"; client: string | null; fromName: string; fromAddress?: string; subject?: string; body: string; at: number }[] = [
    // The five messages of the demo video.
    { channel: "EMAIL", client: "C001", fromName: "Marta Pérez (Juguetes Levante)", subject: "Pedido para mañana",
      body: "Buenas, mañana mandad 12 palés de la ref. PELUCHE-30 a Hipermercados Turia, que lleguen antes de las 10. Gracias, Marta.", at: 95 },
    { channel: "WHATSAPP", client: "C004", fromName: "Toni (Bebidas Montgó)",
      body: "Hola! Para el jueves necesito 6 palés de agua de litro y medio para SuperBahía Alicante. Y si puede ser 4 de horchata también 👍", at: 80 },
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
