// The invented data of the demo: customers, items, tariffs, buildings, carriers, destinations and the work fixed for today and tomorrow.
// Pure (no database): prisma/seed.ts writes it, prisma/seed-plan.ts and scripts/seed-days-check.ts read it.
// Every company, person and product here is invented.

import type { ClientType, PartialPallets, Unit } from "@prisma/client";
import type { WarehouseDims } from "../src/lib/warehouse/layout";

export const clients: { code: string; name: string; type: ClientType; email: string; phone: string; items: [string, string, Unit, number, boolean][] }[] = [
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

// Items on American pallets (the others are on Euro pallets).
export const AMERICAN_ITEMS = new Set(["AGUA-15", "REFR-NAR"]);

// One invented tariff per customer. Prices in euros per pallet; storage per pallet and day.
// Juguetes Levante has the round figures used in the worked examples. Textil Biar is the one customer
// charged for a loose pallet as a whole pallet; the other seven pay the fraction of a pallet.
export const tariffs: Record<string, { inPerPallet: number; outPerPallet: number; storagePrice: number; storageByType?: Record<string, number>; handlingPrice?: number; partialPallets: PartialPallets }> = {
  C001: { inPerPallet: 1.0, outPerPallet: 1.0, storagePrice: 0.1, partialPallets: "FRACTION" },
  C002: { inPerPallet: 1.2, outPerPallet: 1.2, storagePrice: 0.08, partialPallets: "FRACTION" },
  C003: { inPerPallet: 1.1, outPerPallet: 1.1, storagePrice: 0.12, partialPallets: "FRACTION" },
  C004: { inPerPallet: 1.5, outPerPallet: 1.5, storagePrice: 0.12, storageByType: { AMERICAN: 0.18 }, handlingPrice: 12, partialPallets: "FRACTION" },
  C005: { inPerPallet: 1.0, outPerPallet: 1.25, storagePrice: 0.09, partialPallets: "FULL" },
  C006: { inPerPallet: 1.3, outPerPallet: 1.3, storagePrice: 0.08, partialPallets: "FRACTION" },
  C007: { inPerPallet: 1.5, outPerPallet: 1.5, storagePrice: 0.15, partialPallets: "FRACTION" },
  C008: { inPerPallet: 1.25, outPerPallet: 1.25, storagePrice: 0.14, partialPallets: "FRACTION" },
};

// Two hubs of the same chain on purpose: "Hipermercados Turia" alone is ambiguous.
export const consignees: [string, string, string, string, string[]][] = [
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

export const carriers: [string, string][] = [
  ["Transportes Hermanos Sempere", "4821 KLM"],
  ["Rápidos Carrasqueta", "7310 JHG"],
  ["Logística Foia de Castalla", "1955 LPR"],
  ["Autónomo – Vicente Pastor", "9042 GTB"],
  ["Rutas del Vinalopó", "3367 MNS"],
];

// Who usually writes from each customer (same people as in the inbox messages).
export const CONTACTS: Record<string, string> = {"C001": "Marta Pérez", "C002": "Compras Serra Mariola", "C003": "Javier Mira", "C004": "Toni Ferrer", "C005": "Rosa Mollá", "C006": "Granzas del Mediterráneo", "C007": "Laura Gil", "C008": "Pilar Sanz"};

// Two buildings: general goods, and a smaller food & cosmetics one that is nearly full.
export const warehouses: { code: string; name: string; city: string; dims: WarehouseDims; clients: string[] }[] = [
  {
    code: "N1", name: "Nave 1 · Carga general", city: "Elche",
    dims: { length: 28, width: 24, height: 8, aisleWidth: 3.0, docks: 4 },
    clients: ["C001", "C002", "C003", "C005", "C006"],
  },
  {
    code: "N2", name: "Nave 2 · Alimentación y cosmética", city: "Novelda",
    dims: { length: 28, width: 14, height: 8, aisleWidth: 3.0, docks: 2 },
    clients: ["C004", "C007", "C008"],
  },
];

/**
 * Open work for the coming days, fixed on purpose so the demo never depends on luck:
 * customer, SKU, destination, pallets, days from today, hour of the deadline.
 */
export const UPCOMING: [string, string, string, number, number, number][] = [
  ["C003", "BOTA-INV", "D0701", 5, 1, 10],
  ["C008", "TURRON-DUR", "D0610", 6, 1, 9],
  ["C004", "AGUA-15", "D0520", 4, 1, 12],
  ["C007", "CREMA-50", "D0901", 2, 2, 11],
  ["C002", "PP-NAT", "D0800", 8, 2, 8],
  ["C005", "TOALLA-BL", "D0700", 3, 2, 13],
];

/** Picked this morning and waiting in the dispatch lanes for their trucks: customer, SKU, destination, pallets, hour of the deadline. */
export const PREPARED_TODAY: [string, string, string, number, number][] = [
  ["C006", "PVC-BLA", "D0802", 6, 16],
  ["C005", "SABANA-90", "D0951", 4, 18],
];

/** The two outbounds of tomorrow that already have a door (the rest waits for the clerk). */
export const BOOKED_TOMORROW = ["BOTA-INV", "TURRON-DUR"];

/** The building of a customer. */
export const warehouseOf = (clientCode: string) => {
  const w = warehouses.find((w) => w.clients.includes(clientCode));
  if (!w) throw new Error(`Customer ${clientCode} has no building`);
  return w;
};

