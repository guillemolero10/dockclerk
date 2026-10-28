import { redirect } from "next/navigation";
import { Building2, HardHat, KeyRound, Monitor, Truck } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { getSession, HOME } from "@/lib/session";

// Reads the session cookie on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Already signed in: straight to your own place. If the database is down, show the form anyway (signing in will say so).
  const session = await getSession().catch(() => null);
  if (session) redirect(HOME[session.role]);

  return (
    <div className="min-h-screen bg-dock-ink text-white">
      <div className="hazard h-2.5" />
      <main
        className="min-h-[calc(100vh-10px)]"
        style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "7px 7px" }}
      >
        <div className="mx-auto max-w-5xl px-6 py-16">
          <div className="flex items-center gap-2.5">
            <span className="cond grid h-9 w-9 place-items-center bg-dock-yellow text-sm font-bold text-dock-ink">DC</span>
            <span className="text-lg font-semibold tracking-tight text-white">DockClerk</span>
          </div>

          <div className="mt-10 grid gap-12 lg:grid-cols-[1.4fr_1fr] lg:items-start">
            <div>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
                Don&apos;t replace your warehouse software.{" "}
                <span className="text-dock-yellow">Hire an AI clerk that works inside it.</span>
              </h1>
              <p className="mt-5 max-w-2xl text-lg text-white/55">
                DockClerk reads the orders customers send by email, WhatsApp or voice note, prepares them in the software
                the warehouse already uses, and counts the boxes at the dock with a phone. A person approves everything.
              </p>

              <h2 className="cond mt-12 text-sm text-white/35">Four people, four ways in</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Who icon={Monitor} title="Office" text="The AI clerk handles the inbox and prepares the work. You approve with one click." />
                <Who icon={HardHat} title="Warehouse operator" text="On the phone: unload, put away, pick. Photograph the delivery note and the AI counts the boxes." />
                <Who icon={Building2} title="Customer" text="Their own portal: stock, movements, receipts with photos. They can ask and order in plain words." />
                <Who icon={Truck} title="Truck driver" text="No account: a link by WhatsApp for each delivery. The office sends it from the Dock screen." />
              </div>
            </div>

            <section className="border border-white/15 bg-white/[0.03] p-6">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center bg-dock-yellow/15 text-dock-yellow ring-1 ring-dock-yellow/30">
                  <KeyRound size={19} />
                </span>
                <div>
                  <h2 className="font-semibold text-white">Sign in</h2>
                  <p className="cond text-xs text-white/40">Office, operator or customer</p>
                </div>
              </div>
              <div className="mt-6">
                <LoginForm />
              </div>
              <p className="mt-5 text-xs leading-relaxed text-white/40">
                Demo accounts for the judges: the user names and passwords come with the hackathon submission form.
              </p>
            </section>
          </div>

          <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-6 text-xs text-white/40">
            <span>Built during the Meta Global AI Developer Hackathon 2026 · Powered by Meta&apos;s Muse Spark and SAM 3.1</span>
            <span>All companies and data are invented</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Who({ icon: Icon, title, text }: { icon: typeof Monitor; title: string; text: string }) {
  return (
    <div className="border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 place-items-center bg-dock-yellow/15 text-dock-yellow ring-1 ring-dock-yellow/30">
          <Icon size={16} />
        </span>
        <h3 className="text-sm font-semibold text-white">{title}</h3>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-white/50">{text}</p>
    </div>
  );
}
