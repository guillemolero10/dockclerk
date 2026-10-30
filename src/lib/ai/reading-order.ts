// Boxes found in a photo, put in reading order (rows top to bottom, each row left to right).
// SAM returns them by score; the numbered overlay, the receipt ("box 3 damaged") and the
// question to Muse Spark ("positions reading left to right, top to bottom") need this order.

export type Rect = { x: number; y: number; w: number; h: number };

export function readingOrder<T extends Rect>(boxes: T[]): T[] {
  if (boxes.length < 2) return [...boxes];
  const heights = boxes.map((b) => b.h).sort((a, b) => a - b);
  const tolerance = heights[Math.floor(heights.length / 2)] / 2; // same row = centres closer than half a typical box
  const byTop = [...boxes].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2));
  const rows: T[][] = [];
  for (const box of byTop) {
    const row = rows[rows.length - 1];
    const centre = box.y + box.h / 2;
    if (row && centre - (row[0].y + row[0].h / 2) < tolerance) row.push(box);
    else rows.push([box]);
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x));
}
