// Reads the warehouse records of one customer and turns them into a bill. The arithmetic is in compute.ts.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { billPeriod, type BillResult, type TariffInput } from "./compute";
import { dateOfDay, dayNumber, type Period } from "./calendar";
import { mapLimit } from "./pool";
import { buildStays, shippedSince, type PalletKind } from "./stays";

const NO_TARIFF: TariffInput = { inPerPallet: 0, outPerPallet: 0, storagePrice: 0, storageByType: {}, factorPct: 100, vatPct: 0, partialPallets: "FRACTION" };

/** storageByType is JSON in the database: keep only the known pallet types with a real price. */
function readPrices(value: unknown): TariffInput["storageByType"] {
  const prices: TariffInput["storageByType"] = {};
  if (!value || typeof value !== "object") return prices;
  for (const type of ["EURO", "AMERICAN"] as PalletKind[]) {
    const price = (value as Record<string, unknown>)[type];
    if (typeof price === "number" && Number.isFinite(price) && price >= 0) prices[type] = price;
  }
  return prices;
}

const euros = (cents: number) => `${(cents / 100).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

export type LoadedBilling = {
  clientId: string;
  clientCode: string;
  /** False when the customer has no tariff: the figures are then all at zero price and must not be saved. */
  hasTariff: boolean;
  hasMovements: boolean;
  result: BillResult;
  steps: string[];
};

/** Everything a customer was charged for in the period, straight from the records. Writes nothing. */
export async function loadBilling(clientId: string, p: Period): Promise<LoadedBilling> {
  const client = await db.client.findUniqueOrThrow({
    where: { id: clientId },
    select: {
      code: true,
      tariff: true,
      items: { select: { id: true, sku: true, unitsPerPallet: true, palletType: true } },
      inbounds: { select: { id: true, number: true, clientDocRef: true, date: true, receivedAt: true } },
      // Only shipments from the day before the period on: older ones have no days inside it and no exit in it (see shippedSince).
      outbounds: {
        where: {
          status: { in: ["SHIPPED", "CLOSED"] },
          OR: [{ shippedAt: { gte: shippedSince(p.start) } }, { shippedAt: null, date: { gte: shippedSince(p.start) } }],
        },
        select: { number: true, status: true, date: true, shippedAt: true, shipped: true },
      },
      stock: { select: { itemId: true, lot: true, units: true, inboundId: true, palletCode: true, palletShare: true, splitFrom: true } },
      handling: { where: { date: { gte: dateOfDay(p.start - 1), lt: dateOfDay(p.end + 1) } }, select: { date: true, pallets: true, unitPrice: true, replacesExit: true } },
    },
  });

  const tariff: TariffInput = client.tariff
    ? {
        inPerPallet: client.tariff.inPerPallet,
        outPerPallet: client.tariff.outPerPallet,
        storagePrice: client.tariff.storagePrice,
        storageByType: readPrices(client.tariff.storageByType),
        factorPct: client.tariff.factorPct,
        vatPct: client.tariff.vatPct,
        partialPallets: client.tariff.partialPallets,
      }
    : NO_TARIFF;

  const stays = buildStays({ items: client.items, inbounds: client.inbounds, outbounds: client.outbounds, stock: client.stock, periodStart: p.start });
  const handling = client.handling.map((h) => ({ day: dayNumber(h.date), pallets: h.pallets, unitPrice: h.unitPrice, replacesExit: h.replacesExit }));
  const result = billPeriod({ stays, handling, tariff, period: p });
  const hasMovements = result.palletDays > 0 || result.inPallets > 0 || result.outPallets > 0 || result.handlingPallets > 0;

  const steps = [
    `load_records(${client.code}) → ${stays.length} stays, ${handling.length} handling`,
    `bill_period(${client.code}, ${p.first}..${p.last}, ${p.days} days, ${tariff.partialPallets}) → ${euros(result.totalCents)}`,
  ];
  return { clientId, clientCode: client.code, hasTariff: Boolean(client.tariff), hasMovements, result, steps };
}

export type PrepareOutcome = { prepared: number; skipped: { client: string; reason: string }[] };

/** Customers worked on at the same time: enough to save most of the waiting, few enough for the small connection pool on Vercel. */
const PREPARE_CONCURRENCY = 4;

/** What happened with one customer; the results are folded together in customer order, whichever finished first. */
type ClientOutcome = { skipped?: { client: string; reason: string }; bill?: LoadedBilling; prepared?: boolean };

/**
 * Creates or replaces the draft pre-invoice of every customer with movements in the period.
 * An approved one is never touched. With `dryRun`, nothing is written (the figures are returned for checking).
 * Customers are worked on a few at a time (`concurrency`, 4 by default); the result is the same for any number,
 * with `bills` and `skipped` in customer-code order.
 */
export async function prepareClients(p: Period, options: { dryRun?: boolean; concurrency?: number } = {}): Promise<PrepareOutcome & { bills: LoadedBilling[] }> {
  const clients = await db.client.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } });
  const from = dateOfDay(p.start);
  const to = dateOfDay(p.end - 1);

  const outcomes = await mapLimit(clients, options.concurrency ?? PREPARE_CONCURRENCY, async (client): Promise<ClientOutcome> => {
    const bill = await loadBilling(client.id, p);
    if (!bill.hasMovements) {
      if (!options.dryRun) await db.preInvoice.deleteMany({ where: { clientId: client.id, from, to, status: "DRAFT" } });
      return {};
    }
    if (!bill.hasTariff) return { skipped: { client: client.code, reason: "No tariff." } };
    if (!bill.result.checks.detailMatches) return { skipped: { client: client.code, reason: "The detail does not add up to the summary." } };
    if (options.dryRun) return { bill, prepared: true };

    const r = bill.result;
    const data = {
      partialPallets: r.rule,
      lines: r.lines as unknown as Prisma.InputJsonValue,
      detail: { rows: r.detail, checks: r.checks } as unknown as Prisma.InputJsonValue,
      baseCents: r.baseCents,
      vatPct: r.vatPct,
      vatCents: r.vatCents,
      totalCents: r.totalCents,
      steps: bill.steps as unknown as Prisma.InputJsonValue,
      createdAt: new Date(),
    };
    const approved: ClientOutcome = { bill, skipped: { client: client.code, reason: "Already approved." } };
    const refresh = async (id: string) => {
      // Only while it is still a draft: if somebody approves it right now, this changes nothing.
      const { count } = await db.preInvoice.updateMany({ where: { id, status: "DRAFT" }, data });
      return count === 1;
    };
    const existing = await db.preInvoice.findUnique({ where: { clientId_from_to: { clientId: client.id, from, to } }, select: { id: true, status: true } });
    if (existing?.status === "APPROVED") return approved;
    if (existing) {
      if (!(await refresh(existing.id))) return approved;
    } else {
      try {
        await db.preInvoice.create({ data: { clientId: client.id, from, to, status: "DRAFT", ...data } });
      } catch (error) {
        // Another tab created it a moment ago (unique clientId + period): treat it as the existing one, and keep going with the rest.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        const other = await db.preInvoice.findUnique({ where: { clientId_from_to: { clientId: client.id, from, to } }, select: { id: true } });
        if (!other || !(await refresh(other.id))) return approved;
      }
    }
    return { bill, prepared: true };
  });

  const out: PrepareOutcome & { bills: LoadedBilling[] } = { prepared: 0, skipped: [], bills: [] };
  for (const o of outcomes) {
    if (o.bill) out.bills.push(o.bill);
    if (o.skipped) out.skipped.push(o.skipped);
    if (o.prepared) out.prepared++;
  }
  return out;
}

/** Today in Madrid as a day number (for "that month has not started"). */
export const todayDay = () => dayNumber(new Date());
