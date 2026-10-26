// Spanish formats, as the legacy software shows them.
export const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Madrid" }) : "";

export const fmtTime = (d: Date | null | undefined) =>
  d ? d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" }) : "";

export const fmtNumber = (n: number | null | undefined) => (n == null ? "" : n.toLocaleString("es-ES"));
