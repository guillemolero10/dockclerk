/* eslint-disable @next/next/no-img-element -- photos come from our own upload route */

/** Photo of the load with every box found numbered on top; damaged ones in red. */
export function LoadPhoto({ src, boxes }: { src: string; boxes: { x: number; y: number; w: number; h: number; damaged: boolean }[] | null }) {
  return (
    <div className="relative overflow-hidden border-[1.5px] border-dock-ink bg-dock-ink">
      <img src={src} alt="Load at the dock" className="block w-full" />
      {boxes && boxes.length > 0 && (
        <svg viewBox="0 0 1 1" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {boxes.map((b, i) => (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} fill={b.damaged ? "rgba(210,58,42,0.25)" : "rgba(255,209,0,0.12)"} stroke={b.damaged ? "#d23a2a" : "#ffd100"} strokeWidth={0.004} />
          ))}
        </svg>
      )}
      {boxes?.map((b, i) => (
        <span
          key={i}
          className={`mono absolute -translate-x-1/2 -translate-y-1/2 px-1 text-[10px] font-bold ${b.damaged ? "bg-dock-red text-white" : "bg-dock-yellow text-dock-ink"}`}
          style={{ left: `${(b.x + b.w / 2) * 100}%`, top: `${(b.y + b.h / 2) * 100}%` }}
        >
          {i + 1}
        </span>
      ))}
    </div>
  );
}
