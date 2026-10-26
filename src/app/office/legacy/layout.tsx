import { LegacyTabs } from "@/components/legacy-tabs";

// The warehouse's existing software, simulated. DockClerk writes into it after human approval.
export default function LegacyLayout({ children }: LayoutProps<"/office/legacy">) {
  return (
    <main className="p-6">
      <p className="mb-3 text-xs text-zinc-500">
        Simulated legacy warehouse software (built for the demo, invented data). This is where approved work lands.
      </p>
      <div className="legacy overflow-hidden shadow-2xl shadow-black/50">
        <div className="legacy-titlebar">ALMACENES DEL VINALOPÓ — Gestión de almacén v4.2</div>
        <LegacyTabs />
        <div className="legacy-panel mx-2 mb-2 max-h-[calc(100vh-140px)] overflow-auto">{children}</div>
      </div>
    </main>
  );
}
