"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions";
import { BellRing, Boxes, Building2, FlaskConical, Inbox, Receipt, LayoutDashboard, LogOut, MonitorCog, Route, Truck } from "lucide-react";

const NAV = [
  { href: "/office", label: "Today", icon: LayoutDashboard, exact: true },
  { href: "/office/inbox", label: "AI inbox", icon: Inbox, badgeKey: "inbox" as const },
  { href: "/office/warehouse", label: "Warehouse 3D", icon: Boxes },
  { href: "/office/dock", label: "Dock", icon: Truck },
  { href: "/office/alerts", label: "Alerts", icon: BellRing, badgeKey: "alerts" as const },
  { href: "/office/analyst", label: "Analyst", icon: FlaskConical },
  { href: "/office/trace", label: "Lot trace", icon: Route },
  { href: "/office/clients", label: "Customers", icon: Building2 },
  { href: "/office/billing", label: "Billing", icon: Receipt },
];

export function OfficeSidebar({ userName, inboxCount, alertCount }: { userName: string; inboxCount: number; alertCount: number }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <aside className="flex w-full shrink-0 flex-col bg-dock-ink text-white print:hidden md:sticky md:top-0 md:h-screen md:w-60">
      <div className="hazard h-2.5" />
      <Link href="/office" className="flex items-center gap-2.5 px-5 py-3 md:py-5">
        <span className="cond grid h-8 w-8 place-items-center bg-dock-yellow text-sm font-bold text-dock-ink">DC</span>
        <span>
          <span className="block text-[16px] font-semibold tracking-tight text-white">DockClerk</span>
          <span className="cond block text-[11px] text-white/40">AI back office</span>
        </span>
      </Link>

      <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:block md:flex-1 md:space-y-1 md:overflow-visible md:pb-0">
        {NAV.map(({ href, label, icon: Icon, exact, badgeKey }) => {
          const active = isActive(href, exact);
          const badge = badgeKey === "inbox" ? inboxCount : badgeKey === "alerts" ? alertCount : 0;
          return (
            <Link
              key={href}
              href={href}
              className={`cond group flex shrink-0 items-center gap-3 whitespace-nowrap px-3 py-2 text-sm transition-colors ${
                active ? "bg-dock-yellow text-dock-ink" : "text-white/60 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon size={17} className={active ? "text-dock-ink" : "text-white/40 group-hover:text-white/70"} />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span className={`mono rounded-full px-1.5 text-[11px] font-semibold ${active ? "bg-dock-ink text-dock-yellow" : "bg-dock-red text-white"}`}>
                  {badge}
                </span>
              )}
            </Link>
          );
        })}

        <div className="cond hidden px-3 pb-1 pt-5 text-[11px] text-white/30 md:block">Your software</div>
        <Link
          href="/office/legacy/outbounds"
          className={`cond group flex shrink-0 items-center gap-3 whitespace-nowrap px-3 py-2 text-sm transition-colors ${
            pathname.startsWith("/office/legacy") ? "bg-dock-yellow text-dock-ink" : "text-white/60 hover:bg-white/5 hover:text-white"
          }`}
        >
          <MonitorCog size={17} className={pathname.startsWith("/office/legacy") ? "text-dock-ink" : "text-white/40"} />
          <span className="flex-1">Gestión de almacén</span>
          <span className="mono rounded border border-white/20 px-1 text-[10px] text-white/40">v4.2</span>
        </Link>
      </nav>

      <div className="border-t border-white/10 p-1 md:p-3">
        <p className="cond hidden truncate px-3 pb-1 text-[11px] text-white/30 md:block">{userName}</p>
        <form action={logout}>
          <button className="cond flex w-full items-center gap-3 px-3 py-2 text-sm text-white/40 hover:text-white">
            <LogOut size={16} /> Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
