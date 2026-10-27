// Photos, signatures and voice notes, stored in the database (no storage service needed for the demo).
// The browser shrinks photos before sending them, so rows stay small.

import { db } from "@/lib/db";

const MAX_BYTES = 3 * 1024 * 1024;

export type Media = { mime: string; base64: string };

/** Parses a data URL from the browser, accepting only images and audio. */
export function parseDataUrl(value: unknown): Media | null {
  if (typeof value !== "string") return null;
  const match = /^data:((?:image|audio)\/[\w.+-]+)(?:;[\w=-]+)*;base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!match) return null;
  if ((match[2].length * 3) / 4 > MAX_BYTES) return null;
  return { mime: match[1], base64: match[2] };
}

export async function saveUpload(kind: "note" | "load" | "signature" | "voice", media: Media) {
  const row = await db.upload.create({ data: { kind, mime: media.mime, data: Buffer.from(media.base64, "base64") } });
  return `/api/uploads/${row.id}`;
}
