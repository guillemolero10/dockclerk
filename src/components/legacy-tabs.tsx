"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/office/outbounds", label: "Salidas" },
  { href: "/office/inbounds", label: "Entradas" },
  { href: "/office/stock", label: "Existencias" },
];

export function LegacyTabs() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 px-2 pt-2">
      {TABS.map((t) => (
        <Link key={t.href} href={t.href} className="legacy-tab" aria-current={pathname.startsWith(t.href) ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
