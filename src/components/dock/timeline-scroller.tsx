"use client";

import { useEffect, useRef } from "react";

/** Horizontal scroller that opens on the interesting part of the day (now, or the first truck). */
export function TimelineScroller({ focusX, children }: { focusX: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = Math.max(0, focusX - el.clientWidth / 3);
  }, [focusX]);
  return (
    <div ref={ref} className="overflow-x-auto">
      {children}
    </div>
  );
}
