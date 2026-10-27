"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/portal", label: "Home", exact: true },
  { href: "/portal/stock", label: "Stock" },
  { href: "/portal/movements", label: "Movements" },
  { href: "/portal/ask", label: "Ask & request" },
];

export function PortalNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1">
      {NAV.map((n) => {
        const active = n.exact ? pathname === n.href : pathname.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} className={`cond px-3 py-1.5 text-sm ${active ? "bg-dock-ink text-dock-yellow" : "text-dock-ink/60 hover:text-dock-ink"}`}>
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
