"use client";

import { useEffect, useRef, useState } from "react";
import { Eraser } from "lucide-react";

/** Sign with a finger. Hands back a PNG data URL, or null while empty. */
export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const stroked = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#15130f";
  }, []);

  const point = (e: React.PointerEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div>
      <div className="relative border-[1.5px] border-dock-ink bg-white">
        <canvas
          ref={canvas}
          className="block h-40 w-full touch-none"
          onPointerDown={(e) => {
            drawing.current = true;
            canvas.current!.setPointerCapture(e.pointerId);
            const ctx = canvas.current!.getContext("2d")!;
            const p = point(e);
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
          }}
          onPointerMove={(e) => {
            if (!drawing.current) return;
            const ctx = canvas.current!.getContext("2d")!;
            const p = point(e);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
            stroked.current = true;
          }}
          onPointerUp={() => {
            // Only a real stroke counts: a finger lifted over the pad without drawing is not a signature.
            if (!drawing.current) return;
            drawing.current = false;
            if (!stroked.current) return;
            setEmpty(false);
            onChange(canvas.current!.toDataURL("image/png"));
          }}
        />
        {empty && <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-dock-ink/30">Sign here</span>}
        <span className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-dashed border-dock-ink/30" />
      </div>
      <button
        type="button"
        onClick={() => {
          const c = canvas.current!;
          c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
          stroked.current = false;
          setEmpty(true);
          onChange(null);
        }}
        className="cond mt-1.5 flex items-center gap-1 text-xs text-dock-ink/50"
      >
        <Eraser size={12} /> Clear
      </button>
    </div>
  );
}
