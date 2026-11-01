"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n/client";

const NAV = [
  { href: "/portal", key: "pt.nav.home", exact: true },
  { href: "/portal/stock", key: "pt.nav.stock" },
  { href: "/portal/movements", key: "pt.nav.movements" },
  { href: "/portal/ask", key: "pt.nav.ask" },
] as const;

export function PortalNav() {
  const pathname = usePathname();
  const { t } = useT();
  return (
    <nav className="flex min-w-0 flex-wrap gap-1">
      {NAV.map((n) => {
        const active = "exact" in n && n.exact ? pathname === n.href : pathname.startsWith(n.href);
        return (
          <Link key={n.href} href={n.href} className={`cond px-3 py-1.5 text-sm ${active ? "bg-dock-ink text-dock-yellow" : "text-dock-ink/60 hover:text-dock-ink"}`}>
            {t(n.key)}
          </Link>
        );
      })}
    </nav>
  );
}
