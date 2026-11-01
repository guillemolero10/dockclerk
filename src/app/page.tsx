import { redirect } from "next/navigation";
import { Building2, HardHat, KeyRound, Monitor, Truck } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { LangSwitch } from "@/lib/i18n/lang-switch";
import { getT } from "@/lib/i18n/server";
import { getSession, HOME } from "@/lib/session";

// Reads the session cookie on every request.
export const dynamic = "force-dynamic";

export default async function Home() {
  // Already signed in: straight to your own place. If the database is down, show the form anyway (signing in will say so).
  const { t } = await getT();
  const session = await getSession().catch(() => null);
  if (session) redirect(HOME[session.role]);

  return (
    <div className="min-h-screen bg-dock-ink text-white">
      <div className="hazard h-2.5" />
      <main
        className="min-h-[calc(100vh-10px)]"
        style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.035) 1px, transparent 1px)", backgroundSize: "7px 7px" }}
      >
        <div className="mx-auto max-w-5xl px-6 py-10 sm:py-16">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="cond grid h-9 w-9 place-items-center bg-dock-yellow text-sm font-bold text-dock-ink">DC</span>
              <span className="text-lg font-semibold tracking-tight text-white">DockClerk</span>
            </div>
            <LangSwitch big />
          </div>

          <div className="mt-8 grid gap-10 sm:mt-10 sm:gap-12 lg:grid-cols-[1.4fr_1fr] lg:items-start">
            <div>
              <h1 className="max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-white sm:text-5xl">
                {t("lg.headline1")} <span className="text-dock-yellow">{t("lg.headline2")}</span>
              </h1>
              <p className="mt-5 max-w-2xl text-lg text-white/55">
                {t("lg.intro")}
              </p>

              <h2 className="cond mt-12 text-sm text-white/35">{t("lg.four")}</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Who icon={Monitor} title={t("lg.office")} text={t("lg.officeText")} />
                <Who icon={HardHat} title={t("lg.operator")} text={t("lg.operatorText")} />
                <Who icon={Building2} title={t("lg.customer")} text={t("lg.customerText")} />
                <Who icon={Truck} title={t("lg.driver")} text={t("lg.driverText")} />
              </div>
            </div>

            {/* On a phone the form comes first (visual order only; the page text stays first in the HTML). */}
            <section className="order-first border border-white/15 bg-white/[0.03] p-6 lg:order-none">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center bg-dock-yellow/15 text-dock-yellow ring-1 ring-dock-yellow/30">
                  <KeyRound size={19} />
                </span>
                <div>
                  <h2 className="font-semibold text-white">{t("lg.signIn")}</h2>
                  <p className="cond text-xs text-white/40">{t("lg.who")}</p>
                </div>
              </div>
              <div className="mt-6">
                <LoginForm />
              </div>
              <p className="mt-5 text-xs leading-relaxed text-white/40">
                {t("lg.demo")}
              </p>
            </section>
          </div>

          <footer className="mt-14 flex flex-wrap items-center justify-between gap-3 border-t border-white/15 pt-6 text-xs text-white/40">
            <span>{t("lg.built")}</span>
            <span>{t("lg.invented")}</span>
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
