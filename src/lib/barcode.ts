// Code 128 bars for the labels (the handheld reads them like a keyboard). Wraps jsbarcode's encoder; no canvas, no DOM.
import JsBarcode from "jsbarcode";

/** The modules of a Code 128 barcode as "1" (bar) and "0" (space), quiet zone not included. Empty if the text cannot be encoded. */
export function code128Modules(text: string): string {
  const out: { encodings?: { data: string }[] } = {};
  try {
    JsBarcode(out, text, { format: "CODE128", flat: true });
  } catch {
    return "";
  }
  return (out.encodings ?? []).map((e) => e.data).join("");
}

/** SVG path of the bars: each run of 1s is one rectangle of `height` high, a module is 1 unit wide. */
export function barsPath(modules: string, height: number): string {
  let d = "";
  for (let i = 0; i < modules.length; ) {
    if (modules[i] !== "1") { i++; continue; }
    let j = i;
    while (modules[j] === "1") j++;
    d += `M${i} 0h${j - i}v${height}h-${j - i}z`;
    i = j;
  }
  return d;
}
