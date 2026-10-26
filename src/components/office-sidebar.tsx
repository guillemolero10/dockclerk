"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, LayoutDashboard, LogOut, MonitorCog, Truck } from "lucide-react";

const NAV = [
  { href: "/office", label: "Today", icon: LayoutDashboard, exact: true },
  { href: "/office/inbox", label: "AI inbox", icon: Inbox, badgeKey: "inbox" as const },
  { href: "/office/dock", label: "Dock", icon: Truck },
];

export function OfficeSidebar({ inboxCount }: { inboxCount: number }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) => (exact ? pathname === href : pathname.startsWith(href));

  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-dock-line bg-dock-panel/80 backdrop-blur">
      <div className="hazard h-1.5" />
      <Link href="/office" className="flex items-center gap-2.5 px-5 py-5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-dock-amber font-mono text-sm font-bold text-black">DC</span>
        <span>
          <span className="block text-[15px] font-semibold tracking-tight text-white">DockClerk</span>
          <span className="block text-[11px] text-zinc-500">AI back office</span>
        </span>
      </Link>

      <nav className="flex-1 space-y-1 px-3">
        {NAV.map(({ href, label, icon: Icon, exact, badgeKey }) => {
          const active = isActive(href, exact);
          return (
            <Link
              key={href}
              href={href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "bg-white/[0.06] text-white" : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
              }`}
            >
              <Icon size={17} className={active ? "text-dock-amber" : "text-zinc-500 group-hover:text-zinc-300"} />
              <span className="flex-1">{label}</span>
              {badgeKey === "inbox" && inboxCount > 0 && (
                <span className="rounded-full bg-dock-amber px-1.5 font-mono text-[11px] font-semibold text-black">{inboxCount}</span>
              )}
            </Link>
          );
        })}

        <div className="px-3 pb-1 pt-5 text-[11px] uppercase tracking-wider text-zinc-600">Your software</div>
        <Link
          href="/office/legacy/outbounds"
          className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
            pathname.startsWith("/office/legacy") ? "bg-white/[0.06] text-white" : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
          }`}
        >
          <MonitorCog size={17} className="text-zinc-500" />
          <span className="flex-1">Gestión de almacén</span>
          <span className="rounded border border-zinc-700 px-1 font-mono text-[10px] text-zinc-500">v4.2</span>
        </Link>
      </nav>

      <div className="border-t border-dock-line p-3">
        <Link href="/" className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-500 hover:text-zinc-300">
          <LogOut size={16} /> Switch role
        </Link>
      </div>
    </aside>
  );
}
