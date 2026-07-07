"use client";

import { useEffect, useRef, useState } from "react";

export function NotaBadge({ nota }: { nota: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent | TouchEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-sm leading-none cursor-pointer"
        aria-label="Ver nota"
      >
        📝
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-20 w-56 rounded-lg border border-neutral-200 bg-white p-3 text-xs text-neutral-600 shadow-lg text-left whitespace-pre-wrap">
          {nota}
        </div>
      )}
    </div>
  );
}
