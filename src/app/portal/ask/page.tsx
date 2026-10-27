import { AskClerk } from "@/components/portal/ask-clerk";
import { db } from "@/lib/db";
import { requireCustomer } from "@/lib/portal";

export const dynamic = "force-dynamic";

export default async function PortalAsk() {
  const client = await requireCustomer();
  const [items, lastOut] = await Promise.all([
    db.item.findMany({ where: { clientId: client.id, stock: { some: {} } }, orderBy: { sku: "asc" }, take: 2 }),
    db.outbound.findFirst({ where: { clientId: client.id, consigneeId: { not: null } }, orderBy: { date: "desc" }, include: { consignee: true } }),
  ]);
  const destination = lastOut?.consignee?.aliases[0] ?? lastOut?.consignee?.name ?? "";
  const examples = [
    items[0] && `¿Cuántos palés me quedan de ${items[0].sku}?`,
    "¿Qué entradas hemos tenido este mes?",
    items[1] && destination && `Mandad 3 palés de ${items[1].sku} a ${destination} el viernes por la mañana`,
  ].filter(Boolean) as string[];

  return (
    <main className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Ask & request</h1>
        <p className="mt-1 text-sm text-dock-ink/60">
          Write like you would to the office. Questions about your goods are answered right away from the live software; orders go to the office, who approves them.
        </p>
      </div>
      <AskClerk examples={examples} />
    </main>
  );
}
