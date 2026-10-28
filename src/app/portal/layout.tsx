import { LogOut } from "lucide-react";
import { logout } from "@/app/actions";
import { PortalNav } from "@/components/portal/portal-nav";
import { requireCustomer } from "@/lib/portal";

export default async function PortalLayout({ children }: LayoutProps<"/portal">) {
  const client = await requireCustomer();
  return (
    <div className="dock-app min-h-screen">
      <div className="hazard h-2" />
      <header className="border-b-[1.5px] border-dock-ink bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <div className="flex items-center gap-2.5">
            <span className="cond grid h-8 w-8 place-items-center bg-dock-ink text-sm font-bold text-dock-yellow">AV</span>
            <span>
              <span className="block text-sm font-semibold leading-tight">Almacenes del Vinalopó</span>
              <span className="cond block text-[11px] text-dock-ink/50">Customer portal · {client.name}</span>
            </span>
          </div>
          <PortalNav />
          <form action={logout} className="ml-auto">
            <button className="cond flex items-center gap-1.5 text-xs text-dock-ink/50 hover:text-dock-ink">
              <LogOut size={14} /> Sign out
            </button>
          </form>
        </div>
      </header>
      <div className="mx-auto max-w-6xl px-6 py-8">{children}</div>
    </div>
  );
}
