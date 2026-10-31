import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { requireCustomer } from "@/lib/portal";

export const dynamic = "force-dynamic";

const UNIT: Record<string, string> = { BOX: "boxes", BAG: "bags", PALLET: "units" };

export default async function PortalStock() {
  const client = await requireCustomer();
  const [items, plain, mixedRows, warehouses] = await Promise.all([
    db.item.findMany({ where: { clientId: client.id }, orderBy: { sku: "asc" } }),
    db.stock.groupBy({
      by: ["itemId", "lot", "expiresAt", "warehouseId"],
      where: { clientId: client.id, palletShare: null },
      _sum: { pallets: true, units: true },
      orderBy: [{ expiresAt: "asc" }],
    }),
    // Rows of mixed pallets (several items under one pallet ID): listed one by one, not as "0 plt".
    db.stock.findMany({ where: { clientId: client.id, palletShare: { not: null } }, orderBy: [{ expiresAt: "asc" }, { palletCode: "asc" }] }),
    db.warehouse.findMany(),
  ]);

  return (
    <main className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Stock</h1>
      <p className="text-sm text-dock-ink/60">Live from the warehouse software. Lots go out first-expiring-first, so the oldest leave first.</p>
      <div className="space-y-3">
        {items.map((item) => {
          const rows = [
            ...plain.filter((l) => l.itemId === item.id).map((l) => ({ lot: l.lot, expiresAt: l.expiresAt, warehouseId: l.warehouseId, pallets: l._sum.pallets ?? 0, units: l._sum.units ?? 0, mixedCode: null as string | null })),
            ...mixedRows.filter((m) => m.itemId === item.id).map((m) => ({ lot: m.lot, expiresAt: m.expiresAt, warehouseId: m.warehouseId, pallets: m.pallets, units: m.units, mixedCode: m.palletCode ?? "—" })),
          ];
          const mine = rows;
          const pallets = rows.reduce((sum, l) => sum + l.pallets, 0);
          const units = rows.reduce((sum, l) => sum + l.units, 0);
          return (
            <section key={item.id} className="dock-card overflow-hidden bg-white">
              <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-[1.5px] border-dock-ink px-5 py-3">
                <span className="mono font-semibold">{item.sku}</span>
                <span className="flex-1 text-sm text-dock-ink/60">{item.description}</span>
                <span className="mono text-lg font-semibold">{pallets} plt</span>
                <span className="mono text-sm text-dock-ink/55">
                  {units.toLocaleString("es-ES")} {UNIT[item.unit]}
                </span>
              </header>
              {mine.length === 0 ? (
                <p className="px-5 py-2 text-sm text-dock-ink/45">Nothing in stock.</p>
              ) : (
                <ul className="text-sm">
                  {mine.map((l, i) => (
                    <li key={i} className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5 border-b border-dock-line px-5 py-2 last:border-0">
                      <span className="mono">{l.lot ? `lot ${l.lot}` : "no lot"}</span>
                      <span className="min-w-0 text-dock-ink/60">{warehouses.find((w) => w.id === l.warehouseId)?.name}</span>
                      <span className="mono text-dock-ink/60">{l.expiresAt ? `expires ${fmtDate(l.expiresAt)}` : ""}</span>
                      <span className="mono ml-auto whitespace-nowrap text-right">{l.mixedCode ? `en palé mixto ${l.mixedCode}` : `${l.pallets} plt`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
