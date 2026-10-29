// Read-only photograph of the warehouse state, to compare before and after "Replay the morning" (check 25).
//
//   npx tsx --env-file=.env scripts/state-snapshot.ts > /tmp/before.json
//   ... approve, pick, replay ...
//   npx tsx --env-file=.env scripts/state-snapshot.ts > /tmp/after.json ; diff /tmp/before.json /tmp/after.json
//
// It prints: free stock per item (rows and units, split by "in a rack" and "in a lane"), the rows that sit in an
// EXP-* / REC-* lane without an outbound (orphans), occupied rack slots per warehouse, and outbounds per status.
// It writes nothing.
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  const dayStart = new Date(Date.now() - 12 * 3600_000);
  const [stock, items, warehouses, outbounds, dock] = await Promise.all([
    db.stock.findMany({ select: { itemId: true, units: true, pallets: true, location: true, outboundId: true, warehouseId: true, lot: true } }),
    db.item.findMany({ select: { id: true, sku: true } }),
    db.warehouse.findMany({ select: { id: true, name: true } }),
    db.outbound.findMany({ select: { status: true, number: true } }),
    db.dockAppointment.findMany({
      where: { startsAt: { gte: dayStart, lt: new Date(Date.now() + 40 * 3600_000) } },
      orderBy: { startsAt: "asc" },
      include: { warehouse: { select: { code: true } }, inbound: { select: { number: true, status: true } }, outbound: { select: { number: true, status: true } } },
    }),
  ]);
  const sku = new Map(items.map((i) => [i.id, i.sku]));
  const wh = new Map(warehouses.map((w) => [w.id, w.name]));
  const isLane = (loc: string) => /^(REC|EXP)-/.test(loc);

  const free: Record<string, { rows: number; units: number; inLanes: number }> = {};
  const orphans: string[] = [];
  const occupied: Record<string, number> = {};
  const seen = new Map<string, number>();
  for (const s of stock) {
    const key = sku.get(s.itemId) ?? s.itemId;
    if (!s.outboundId) {
      const f = (free[key] ??= { rows: 0, units: 0, inLanes: 0 });
      f.rows++;
      f.units += s.units;
      if (isLane(s.location)) f.inLanes++;
    }
    if (isLane(s.location) && !s.outboundId && s.location.startsWith("EXP-")) orphans.push(`${s.location} ${key} ${s.units}`);
    if (!isLane(s.location)) {
      const w = wh.get(s.warehouseId) ?? s.warehouseId;
      occupied[w] = (occupied[w] ?? 0) + 1;
      const k = `${w}/${s.location}`;
      seen.set(k, (seen.get(k) ?? 0) + 1);
    }
  }
  const sharedSlots = [...seen.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} x${n}`);
  const byStatus: Record<string, number> = {};
  for (const o of outbounds) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;

  const hm = (d: Date) => d.toLocaleString("en-GB", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const now = Date.now();
  const dockRows = dock.map(
    (a) =>
      `${hm(a.startsAt)} ${a.warehouse.code} d${a.dock} ${a.status} ${a.inbound ? `IN#${a.inbound.number} ${a.inbound.status}` : `OUT#${a.outbound?.number} ${a.outbound?.status}`}`,
  );
  const lateCandidates = dock.filter((a) => a.status === "BOOKED" && a.startsAt.getTime() < now - 15 * 60000).map((a) => `${hm(a.startsAt)} ${a.warehouse.code} d${a.dock} ${a.inbound ? "IN" : "OUT"}`);
  const shippedButBooked = dock.filter((a) => a.outbound && ["SHIPPED", "CLOSED"].includes(a.outbound.status) && a.status !== "DONE").map((a) => `OUT#${a.outbound?.number} ${a.status}`);
  const sorted = <T>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  console.log(
    JSON.stringify(
      {
        freeStockPerItem: sorted(free),
        orphanRowsInExpLanes: orphans.sort(),
        occupiedRackSlots: sorted(occupied),
        slotsWithMoreThanOneRow: sharedSlots.sort(),
        outboundsPerStatus: sorted(byStatus),
        outboundsTotal: outbounds.length,
        dockRows: process.argv.includes("--dock") ? dockRows : undefined,
        lateCandidates,
        shippedButBooked,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
