// Photos from the dock: Muse Spark reads the delivery note, SAM 3.1 finds the boxes.
// Every function returns null when the model is not configured or fails; the screen
// then asks a person to type or count, so receiving never stops.

import { chat, dataUrl, parseJson, providers } from "./client";

type Image = { mime: string; base64: string };

export type NoteReading = {
  docRef: string | null;
  supplier: string | null;
  lines: { sku: string | null; description: string; lot: string | null; pallets: number | null; units: number | null }[];
  totalPallets: number | null;
};

export async function readDeliveryNote(image: Image, context: { customer: string; items: { sku: string; description: string }[] }) {
  const p = providers.vision();
  if (!p) return null;
  try {
    const message = await chat(
      p,
      [
        {
          role: "system",
          content:
            "You read photos of Spanish delivery notes (albaranes) at a warehouse dock. Answer only with JSON: " +
            '{"docRef": string|null, "supplier": string|null, "totalPallets": number|null, "lines": [{"sku": string|null, "description": string, "lot": string|null, "pallets": number|null, "units": number|null}]}. ' +
            "Map each line to one of the customer's SKUs when the description clearly matches; otherwise sku is null. Never invent numbers you cannot read: use null.",
        },
        {
          role: "user",
          content: [
            { type: "text", text: `Customer: ${context.customer}. Its SKUs: ${context.items.map((i) => `${i.sku} = ${i.description}`).join("; ")}.` },
            { type: "image_url", image_url: { url: dataUrl(image) } },
          ],
        },
      ],
      { json: true },
    );
    const reading = parseJson<NoteReading>(message.content);
    const known = new Set(context.items.map((i) => i.sku));
    return { ...reading, lines: reading.lines.map((l) => ({ ...l, sku: l.sku && known.has(l.sku) ? l.sku : null })) };
  } catch (error) {
    console.error("readDeliveryNote", error);
    return null;
  }
}

export type LoadCount = {
  /** Boxes found, in 0..1 image coordinates, for the numbered overlay. */
  boxes: { x: number; y: number; w: number; h: number; damaged: boolean }[];
  pallets: number | null;
  by: "sam-3.1" | "muse-spark";
};

/** SAM 3.1 segments every "cardboard box"; Muse Spark then says which look damaged. Falls back to Muse Spark alone. */
export async function countLoad(image: Image): Promise<LoadCount | null> {
  const sam = providers.segment();
  if (sam) {
    try {
      const res = await fetch(sam.baseUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${sam.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: sam.model, image: dataUrl(image), prompts: ["cardboard box", "pallet"] }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) throw new Error(`SAM 3.1 answered ${res.status}`);
      const data = (await res.json()) as { detections?: { label: string; box: [number, number, number, number]; score: number }[] };
      const found = (data.detections ?? []).filter((d) => d.score >= 0.5);
      const boxes = found.filter((d) => d.label.includes("box")).map((d) => ({ x: d.box[0], y: d.box[1], w: d.box[2], h: d.box[3], damaged: false }));
      const pallets = found.filter((d) => d.label.includes("pallet")).length || null;
      const damaged = await spotDamage(image, boxes.length);
      damaged.forEach((i) => boxes[i] && (boxes[i].damaged = true));
      return { boxes, pallets, by: "sam-3.1" };
    } catch (error) {
      console.error("countLoad SAM", error);
    }
  }

  const p = providers.vision();
  if (!p) return null;
  try {
    const message = await chat(
      p,
      [
        {
          role: "system",
          content:
            "You count cardboard boxes in a photo of pallets at a warehouse dock. Answer only with JSON: " +
            '{"pallets": number|null, "boxes": [{"x": number, "y": number, "w": number, "h": number, "damaged": boolean}]} ' +
            "with each visible box as a rectangle in 0..1 image coordinates (x, y = top-left). damaged = crushed, torn or wet.",
        },
        { role: "user", content: [{ type: "image_url", image_url: { url: dataUrl(image) } }] },
      ],
      { json: true, maxTokens: 3000 },
    );
    const result = parseJson<{ pallets: number | null; boxes: LoadCount["boxes"] }>(message.content);
    return { boxes: result.boxes ?? [], pallets: result.pallets ?? null, by: "muse-spark" };
  } catch (error) {
    console.error("countLoad vision", error);
    return null;
  }
}

/** Indexes of the boxes that look damaged, asked to Muse Spark with the numbered list. */
async function spotDamage(image: Image, boxes: number) {
  const p = providers.vision();
  if (!p || !boxes) return [];
  try {
    const message = await chat(
      p,
      [
        { role: "system", content: 'Look at this photo of boxes on pallets. Answer only with JSON {"damaged": number[]}: positions (0-based, reading left to right, top to bottom) of boxes that are crushed, torn or wet.' },
        { role: "user", content: [{ type: "text", text: `There are ${boxes} boxes.` }, { type: "image_url", image_url: { url: dataUrl(image) } }] },
      ],
      { json: true },
    );
    return parseJson<{ damaged: number[] }>(message.content).damaged ?? [];
  } catch {
    return [];
  }
}
