import Link from "next/link";
import { ArrowRight, Building2, HardHat, Monitor, Truck } from "lucide-react";
import { db } from "@/lib/db";
import { enterAsCustomer, enterAsOffice, enterAsOperator } from "./actions";

// Reads live data on every request.
export const dynamic = "force-dynamic";

async function loadDemoData() {
  try {
    const [customers, nextTruck] = await Promise.all([
      db.client.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
      db.inbound.findFirst({ where: { status: "EXPECTED" }, orderBy: { date: "asc" }, select: { driverToken: true } }),
    ]);
    return { customers, driverToken: nextTruck?.driverToken ?? null };
  } catch {
    return { customers: null, driverToken: null }; // database not connected yet
  }
}

export default async function Home() {
  const { customers, driverToken } = await loadDemoData();

  return (
    <div className="dock-app min-h-screen">
      <div className="hazard h-1.5" />
      <main className="dock-grid min-h-[calc(100vh-6px)]">
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-dock-amber font-mono text-sm font-bold text-black">DC</span>
            <span className="text-lg font-semibold tracking-tight text-white">DockClerk</span>
          </div>

          <h1 className="mt-10 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
            Don&apos;t replace your warehouse software.{" "}
            <span className="text-dock-amber">Hire an AI clerk that works inside it.</span>
          </h1>
          <p className="mt-5 max-w-2xl text-lg text-zinc-400">
            DockClerk reads the orders customers send by email, WhatsApp or voice note, prepares them in the software
            the warehouse already uses, and counts the boxes at the dock with a phone. A person approves everything.
          </p>

          <h2 className="mt-14 text-sm font-medium uppercase tracking-wider text-zinc-500">Try the demo as one of the four people in the warehouse</h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <RoleCard
              icon={Monitor}
              title="Office"
              who="The admin team"
              text="The AI clerk handles the inbox and prepares the work. You approve with one click."
            >
              <form action={enterAsOffice}>
                <EnterButton label="Enter as office" />
              </form>
            </RoleCard>

            <RoleCard
              icon={HardHat}
              title="Warehouse operator"
              who="Forklift driver, on the phone"
              text="Today's tasks. Photograph the delivery note and the pallet: the AI counts the boxes and spots damage."
            >
              <form action={enterAsOperator}>
                <EnterButton label="Enter as operator" />
              </form>
            </RoleCard>

            <RoleCard
              icon={Truck}
              title="Truck driver"
              who="No app, no account"
              text="Gets a link by WhatsApp for each delivery: sends the delivery note photo and signs the receipt."
            >
              {driverToken ? (
                <Link href={`/driver/${driverToken}`} className="inline-flex items-center gap-2 rounded-lg bg-white/[0.06] px-4 py-2 text-sm font-medium text-white ring-1 ring-white/10 transition hover:bg-white/[0.1]">
                  Open today&apos;s delivery link <ArrowRight size={15} />
                </Link>
              ) : (
                <p className="text-sm text-zinc-500">No delivery expected right now.</p>
              )}
            </RoleCard>

            <RoleCard
              icon={Building2}
              title="Customer"
              who="Companies that store goods here"
              text="Their own portal: stock, movements and delivery receipts with photos. They can ask and order in plain words."
            >
              {customers === null ? (
                <p className="text-sm text-amber-400">Database not connected yet.</p>
              ) : (
                <form action={enterAsCustomer} className="flex flex-wrap gap-2">
                  <select name="clientId" className="min-w-0 flex-1 rounded-lg border border-dock-line bg-black/40 px-3 py-2 text-sm text-zinc-200">
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <EnterButton label="Enter" />
                </form>
              )}
            </RoleCard>
          </div>

          <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-dock-line pt-6 text-xs text-zinc-500">
            <span>Built during the Meta Global AI Developer Hackathon 2026 · Powered by Meta&apos;s Muse Spark and SAM 3.1</span>
            <span>Demo: no real login · all companies and data are invented</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function RoleCard({ icon: Icon, title, who, text, children }: { icon: typeof Monitor; title: string; who: string; text: string; children: React.ReactNode }) {
  return (
    <div className="dock-card flex flex-col p-6">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-dock-amber/10 text-dock-amber ring-1 ring-dock-amber/20">
          <Icon size={19} />
        </span>
        <div>
          <h3 className="font-semibold text-white">{title}</h3>
          <p className="text-xs text-zinc-500">{who}</p>
        </div>
      </div>
      <p className="mt-4 flex-1 text-sm leading-relaxed text-zinc-400">{text}</p>
      <div className="mt-5">{children}</div>
    </div>
  );
}

function EnterButton({ label }: { label: string }) {
  return (
    <button className="group inline-flex items-center gap-2 rounded-lg bg-dock-amber px-4 py-2 text-sm font-medium text-black transition hover:brightness-110">
      {label} <ArrowRight size={15} className="transition group-hover:translate-x-0.5" />
    </button>
  );
}
