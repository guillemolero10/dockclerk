"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button onClick={() => window.print()} className="cond flex items-center gap-2 bg-dock-ink px-4 py-2 text-sm text-dock-yellow">
      <Printer size={15} /> Print or save as PDF
    </button>
  );
}
