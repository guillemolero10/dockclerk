// Reads the warehouse records of one customer and turns them into a bill. The arithmetic is in compute.ts.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { billPeriod, type BillResult, type TariffInput } from "./compute";
import { dateOfDay, dayNumber, type Period } from "./calendar";
import { buildStays, type PalletKind } from "./stays";

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
      outbounds: { where: { status: { in: ["SHIPPED", "CLOSED"] } }, select: { number: true, status: true, date: true, shippedAt: true, shipped: true } },
      stock: { select: { itemId: true, lot: true, units: true, inboundId: true } },
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

/**
 * Creates or replaces the draft pre-invoice of every customer with movements in the period.
 * An approved one is never touched. With `dryRun`, nothing is written (the figures are returned for checking).
 */
export async function prepareClients(p: Period, options: { dryRun?: boolean } = {}): Promise<PrepareOutcome & { bills: LoadedBilling[] }> {
  const clients = await db.client.findMany({ select: { id: true, code: true }, orderBy: { code: "asc" } });
  const out: PrepareOutcome & { bills: LoadedBilling[] } = { prepared: 0, skipped: [], bills: [] };
  const from = dateOfDay(p.start);
  const to = dateOfDay(p.end - 1);

  for (const client of clients) {
    const bill = await loadBilling(client.id, p);
    if (!bill.hasMovements) {
      if (!options.dryRun) await db.preInvoice.deleteMany({ where: { clientId: client.id, from, to, status: "DRAFT" } });
      continue;
    }
    if (!bill.hasTariff) {
      out.skipped.push({ client: client.code, reason: "No tariff." });
      continue;
    }
    if (!bill.result.checks.detailMatches) {
      out.skipped.push({ client: client.code, reason: "The detail does not add up to the summary." });
      continue;
    }
    out.bills.push(bill);
    if (options.dryRun) {
      out.prepared++;
      continue;
    }

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
    const skipApproved = () => out.skipped.push({ client: client.code, reason: "Already approved." });
    const refresh = async (id: string) => {
      // Only while it is still a draft: if somebody approves it right now, this changes nothing.
      const { count } = await db.preInvoice.updateMany({ where: { id, status: "DRAFT" }, data });
      return count === 1;
    };
    const existing = await db.preInvoice.findUnique({ where: { clientId_from_to: { clientId: client.id, from, to } }, select: { id: true, status: true } });
    if (existing?.status === "APPROVED") {
      skipApproved();
      continue;
    }
    if (existing) {
      if (!(await refresh(existing.id))) {
        skipApproved();
        continue;
      }
    } else {
      try {
        await db.preInvoice.create({ data: { clientId: client.id, from, to, status: "DRAFT", ...data } });
      } catch (error) {
        // Another tab created it a moment ago (unique clientId + period): treat it as the existing one, and keep going with the rest.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
        const other = await db.preInvoice.findUnique({ where: { clientId_from_to: { clientId: client.id, from, to } }, select: { id: true } });
        if (!other || !(await refresh(other.id))) {
          skipApproved();
          continue;
        }
      }
    }
    out.prepared++;
  }
  return out;
}

/** Today in Madrid as a day number (for "that month has not started"). */
export const todayDay = () => dayNumber(new Date());
