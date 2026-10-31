// Sends one photo to the SAM service (modal/sam_service.py) and prints what it finds.
// Usage: npx tsx --env-file=.env scripts/sam-check.ts path/to/photo.jpg
// Needs META_SAM_URL and SAM_API_KEY (Modal proxy token "wk-...\.ws-...") in the environment. Use an invented/permitted photo.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const url = process.env.META_SAM_URL;
const key = process.env.SAM_API_KEY;
if (!file || !url || !key) {
  console.error("Usage: sam-check.ts <photo.jpg>   (needs META_SAM_URL and SAM_API_KEY)");
  process.exit(2);
}

const mime = /\.png$/i.test(file) ? "image/png" : "image/jpeg";
const image = `data:${mime};base64,${readFileSync(file).toString("base64")}`;

async function call(label: string) {
  const t0 = Date.now();
  const res = await fetch(url!, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.META_SAM_MODEL ?? "sam-3.1", image, prompts: ["cardboard box", "pallet"] }),
    signal: AbortSignal.timeout(120_000),
  });
  const total = Date.now() - t0;
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { detections: { label: string; box: number[]; score: number }[]; ms?: number; model?: string; image?: { width: number; height: number } };
  console.log(`${label}: ${total} ms round trip, ${data.ms ?? "?"} ms inside, model ${data.model ?? "?"}, image ${data.image?.width}x${data.image?.height}`);
  return data;
}

(async () => {
  const first = await call("first call (may include cold start)");
  const found = first.detections.filter((d) => d.score >= 0.5);
  console.log(`boxes: ${found.filter((d) => d.label.includes("box")).length}, pallets: ${found.filter((d) => d.label.includes("pallet")).length} (score >= 0.5, same filter as the app)`);
  console.log("top 3:", JSON.stringify(first.detections.slice(0, 3), null, 1));
  await call("second call (warm)");
})().catch((e) => {
  console.error(String(e));
  process.exit(1);
});
