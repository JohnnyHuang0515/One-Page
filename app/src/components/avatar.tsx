"use client";

import { memberColor, nameInitial } from "@/lib/client";

// 成員頭像：身分色底（資料編碼），縮寫取名字末字
export function Avatar({
  id,
  name,
  size = 26,
  ring = false,
}: {
  id: string;
  name: string;
  size?: number;
  ring?: boolean;
}) {
  const c = memberColor(id);
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-full font-medium ${ring ? "ring-2 ring-paper" : ""}`}
      style={{
        width: size,
        height: size,
        background: c.bg,
        color: c.ink,
        fontSize: Math.round(size * 0.42),
      }}
    >
      {nameInitial(name)}
    </span>
  );
}
