// Colours of the 3D warehouse. Yellow is kept for "act on this" (picks, signs),
// red for alerts, so customer colours avoid both.

export const CLIENT_COLORS = ["#3e7cb1", "#7d8e9c", "#8e5572", "#2a9d8f", "#d98c8c", "#6a994e", "#a77bc0", "#c06c3e"];
export const clientColor = (index: number) => CLIENT_COLORS[index % CLIENT_COLORS.length];

export const PICK = "#ffd100";
export const GHOST = "#dcd8cc";

export const AGE_BUCKETS = [
  { max: 7, color: "#efe3c4", label: "Up to 7 days" },
  { max: 14, color: "#e2b86f", label: "8–14 days" },
  { max: 21, color: "#cc803a", label: "15–21 days" },
  { max: Infinity, color: "#9c3f26", label: "Over 3 weeks" },
];

export const EXPIRY_BUCKETS = [
  { max: 30, color: "#d23a2a", label: "Expires in < 30 days" },
  { max: 90, color: "#e2a03f", label: "30–90 days" },
  { max: Infinity, color: "#8fae8a", label: "Over 90 days" },
];
export const NO_EXPIRY = "#d3cec1";

export const ageColor = (days: number) => AGE_BUCKETS.find((b) => days <= b.max)!.color;
export const expiryColor = (days: number | null) => (days === null ? NO_EXPIRY : EXPIRY_BUCKETS.find((b) => days < b.max)!.color);
