"use client";

// 斜線封頁：覆在空白行區、左下到右上的紅墨斜線。
// play=true（剛月結）時用 pathLength 繪製 0→1（約 0.3s）；已結算月載入時靜態呈現。
import { motion, useReducedMotion } from "motion/react";

export function CloseoutSlash({ play, delay = 0.1 }: { play: boolean; delay?: number }) {
  const reduce = useReducedMotion();
  const animated = play && !reduce;

  return (
    <svg
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      aria-hidden
    >
      <motion.line
        x1="0%"
        y1="100%"
        x2="100%"
        y2="0%"
        stroke="var(--color-rule-red)"
        strokeWidth={1.5}
        initial={animated ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={animated ? { duration: 0.3, ease: "easeInOut", delay } : { duration: 0 }}
      />
    </svg>
  );
}
