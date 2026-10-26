import type { InboundStatus, OutboundStatus } from "@prisma/client";

// Row colours mimic the old software: one colour per status.
export const OUTBOUND_STATUS: Record<OutboundStatus, { label: string; row: string }> = {
  REQUESTED: { label: "Pdte. preparar", row: "#ffffff" },
  PREPARED: { label: "Preparada", row: "#ffffc0" },
  SHIPPED: { label: "Expedida", row: "#c8f0c8" },
  CLOSED: { label: "Cerrada", row: "#e4e4e4" },
};

export const INBOUND_STATUS: Record<InboundStatus, { label: string; row: string }> = {
  EXPECTED: { label: "Prevista", row: "#ffffff" },
  RECEIVING: { label: "En descarga", row: "#ffffc0" },
  RECEIVED: { label: "Recibida", row: "#c8f0c8" },
  CLOSED: { label: "Cerrada", row: "#e4e4e4" },
};

export const UNIT_LABEL = { PALLET: "palés", BOX: "cajas", BAG: "sacos" } as const;
