"use client";

import { Printer } from "lucide-react";
import { useT } from "@/lib/i18n/client";

export function PrintButton() {
  const { t } = useT();
  return (
    <button onClick={() => window.print()} className="cond flex items-center gap-2 bg-dock-ink px-4 py-2 text-sm text-dock-yellow">
      <Printer size={15} /> {t("rs.print")}
    </button>
  );
}
