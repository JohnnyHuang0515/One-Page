"use client";

import { useEffect } from "react";

/** a11y：當 active 時，按 Esc 觸發 onEscape（modal 關閉）。 */
export function useEscapeKey(onEscape: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onEscape();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onEscape, active]);
}
