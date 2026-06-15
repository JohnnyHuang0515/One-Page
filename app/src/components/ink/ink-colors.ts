// 墨流し首頁專用墨色 — 帳本語意色的「深墨版」(粉彩身分色在米紙上看不見,見 DESIGN-SPEC)。
// 順序即控制列順序;成員依加入順序循環對應(server 端 home-replay.ts 指派 colorIndex)。
export const INK_COLORS = [
  { name: "墨黑", hex: "#231f19" }, // = ink token,記帳之墨
  { name: "深藍", hex: "#25527e" }, // sky 加深(藍墨)
  { name: "朱紅", hex: "#c2362b" }, // 印章朱肉色(neg 系)
  { name: "松葉綠", hex: "#2e5e4e" }, // pos 系深松葉
] as const;

export type InkVec3 = [number, number, number];

/** Beer–Lambert 吸光度:display 端以 paper * exp(-A) 合成,墨疊墨自然變深變濁 */
export function inkAbsorbance(hex: string): InkVec3 {
  const v = (i: number) => Math.max(parseInt(hex.slice(i, i + 2), 16) / 255, 0.02);
  return [-Math.log(v(1)), -Math.log(v(3)), -Math.log(v(5))];
}

export const INK_ABSORBANCE: InkVec3[] = INK_COLORS.map((c) => inkAbsorbance(c.hex));
