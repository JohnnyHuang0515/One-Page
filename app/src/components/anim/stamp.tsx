"use client";

// 印章落下：scale 2.2→1、blur 3→0、rotate -14°→靜止角，spring(400/22)。
// play=true 才演（標記已付 / 剛月結的當下）；已結算月載入時 play=false 靜態呈現，不重播（動效有動機）。
// reduced-motion 直接靜態。墨感由 .stamp-ink 濾鏡負責（材質層，非動作，照常保留）。
import { motion, useReducedMotion } from "motion/react";

export function Stamp({
  play,
  rotate = 6,
  delay = 0,
  className,
  children,
}: {
  play: boolean;
  rotate?: number;
  delay?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();

  if (reduce || !play) {
    return (
      <span className={className} style={{ display: "inline-block", transform: `rotate(${rotate}deg)` }}>
        {children}
      </span>
    );
  }

  return (
    <motion.span
      className={className}
      style={{ display: "inline-block" }}
      initial={{ scale: 2.2, opacity: 0, filter: "blur(3px)", rotate: -14 }}
      animate={{ scale: 1, opacity: 1, filter: "blur(0px)", rotate }}
      transition={{ type: "spring", stiffness: 400, damping: 22, delay }}
    >
      {children}
    </motion.span>
  );
}
