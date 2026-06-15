"use client";

// 數字滾動到位（淨額 / 合計 / 成員淨額）。切月、新增花費後播放。
// 用 motion value + spring，不走 useState 逐幀 re-render（§3.B）。reduced-motion 直接定值。
import { useEffect } from "react";
import { motion, useMotionValue, useSpring, useTransform, useReducedMotion } from "motion/react";

export function RollingNumber({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value);
  const spring = useSpring(mv, { stiffness: 90, damping: 18, mass: 0.8 });
  const text = useTransform(spring, (v) => format(Math.round(v)));

  useEffect(() => {
    mv.set(value);
  }, [value, mv]);

  if (reduce) return <span className={className}>{format(value)}</span>;
  return <motion.span className={className}>{text}</motion.span>;
}
