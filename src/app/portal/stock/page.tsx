import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import { requireCustomer } from "@/lib/portal";

export const dynamic = "force-dynamic";

const UNIT: Record<string, string> = { BOX: "boxes", BAG: "bags", PALLET: "units" };

export default async function PortalStock() {
  const client = await requireCustomer();
  const [items, lots, warehouses] = await Promise.all([
    db.item.findMany({ where: { clientId: client.id }, orderBy: { sku: "asc" } }),
    db.stock.groupBy({
      by: ["itemId", "lot", "expiresAt", "warehouseId"],
      where: { clientId: client.id },
      _sum: { pallets: true, units: true },
      orderBy: [{ expiresAt: "asc" }],
    }),
    db.warehouse.findMany(),
  ]);

  return (
    <main className="space-y-4">
      <h1 className="text-3xl font-semibold tracking-tight">Stock</h1>
      <p className="text-sm text-dock-ink/60">Live from the warehouse software. Lots go out first-expiring-first, so the oldest leave first.</p>
      <div className="space-y-3">
        {items.map((item) => {
          const mine = lots.filter((l) => l.itemId === item.id);
          const pallets = mine.reduce((sum, l) => sum + (l._sum.pallets ?? 0), 0);
          const units = mine.reduce((sum, l) => sum + (l._sum.units ?? 0), 0);
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
                <table className="w-full text-sm">
                  <tbody>
                    {mine.map((l, i) => (
                      <tr key={i} className="border-b border-dock-line last:border-0">
                        <td className="mono px-5 py-1.5">{l.lot ? `lot ${l.lot}` : "no lot"}</td>
                        <td className="text-dock-ink/60">{warehouses.find((w) => w.id === l.warehouseId)?.name}</td>
                        <td className="mono text-dock-ink/60">{l.expiresAt ? `expires ${fmtDate(l.expiresAt)}` : ""}</td>
                        <td className="mono px-5 text-right">{l._sum.pallets} plt</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          );
        })}
      </div>
    </main>
  );
}
