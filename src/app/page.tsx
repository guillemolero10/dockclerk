import { db } from "@/lib/db";
import { enterAsCustomer, enterAsOffice, enterAsOperator } from "./actions";

// Reads live data on every request.
export const dynamic = "force-dynamic";

async function loadCustomers() {
  try {
    return await db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  } catch {
    return null; // database not connected yet
  }
}

export default async function Home() {
  const customers = await loadCustomers();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">DockClerk</h1>
      <p className="mt-2 text-neutral-500">
        An AI clerk that works inside your warehouse software. Pick who you are for this demo.
      </p>
      <p className="mt-1 text-xs text-neutral-400">
        Demo role switcher, no real login. All companies and data are invented.
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <RoleCard title="Office" text="Inbox handled by the AI clerk, approval queue and the legacy software." action={enterAsOffice} />
        <RoleCard title="Warehouse operator" text="Today's tasks and receiving goods at the dock from your phone." action={enterAsOperator} />

        <div className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="font-medium">Truck driver</h2>
          <p className="mt-1 text-sm text-neutral-500">
            No app, no account: drivers get a link by WhatsApp for each delivery.
          </p>
          <p className="mt-4 text-sm text-neutral-400">Open it from an expected inbound in the office view.</p>
        </div>

        <form action={enterAsCustomer} className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
          <h2 className="font-medium">Customer portal</h2>
          <p className="mt-1 text-sm text-neutral-500">Companies that store goods here: stock, movements, receipts and an assistant.</p>
          {customers === null ? (
            <p className="mt-4 text-sm text-amber-600">Database not connected yet.</p>
          ) : (
            <div className="mt-4 flex gap-2">
              <select name="clientId" className="min-w-0 flex-1 rounded-md border border-neutral-300 bg-transparent px-2 py-1.5 text-sm dark:border-neutral-700">
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <button className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900">Enter</button>
            </div>
          )}
        </form>
      </div>
    </main>
  );
}

function RoleCard({ title, text, action }: { title: string; text: string; action: () => Promise<void> }) {
  return (
    <form action={action} className="rounded-xl border border-neutral-200 p-5 dark:border-neutral-800">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-neutral-500">{text}</p>
      <button className="mt-4 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white dark:bg-white dark:text-neutral-900">Enter</button>
    </form>
  );
}
