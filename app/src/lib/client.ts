"use client";

// 換頁翻頁方向：導航前在 <html> 掛 data-nav，CSS（globals.css）依此決定 3D 翻頁方向。
// React 的 transitionTypes 不會設定瀏覽器 vt.types，CSS :active-view-transition-type() 看不到，
// 故改用自掛 data 屬性。約 1.3s 後（> 翻頁時長）清除，避免影響後續無方向導航。
export function turnTo(dir: "forward" | "back") {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.nav = dir;
  // 導航通常觸發兩次 view transition（路由切換 + 載入 settle，間隔約一個翻頁時長）。
  // 翻頁動畫的 pseudo 在第一次轉場開始時就建立、跑完即移除，因此翻頁結束後清除 data-nav
  // 不會截斷第一次翻頁；趕在第二次轉場前清除，第二次便退回 UA 預設快速淡入，不會翻第二下。
  const durMs = parseFloat(getComputedStyle(root).getPropertyValue("--vt-dur")) || 900;
  window.setTimeout(() => {
    if (root.dataset.nav === dir) delete root.dataset.nav;
  }, durMs + 40);
}

// Client-side fetch wrapper for the §6.5 error model
export class ApiClientError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
    public details?: Record<string, unknown>
  ) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(path, {
    method: opts?.method ?? "GET",
    headers: opts?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 204) return null as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const e = json?.error;
    throw new ApiClientError(e?.code ?? "INTERNAL_ERROR", e?.message ?? "發生錯誤", res.status, e?.details);
  }
  return json as T;
}

export function fmtMoney(n: number): string {
  return `$${Math.abs(n).toLocaleString("zh-TW")}`;
}

/** 頭像縮寫：中文名取最後一字（小明→明），其他取首字母大寫 */
export function nameInitial(name: string): string {
  return /[一-鿿]/.test(name) ? name.slice(-1) : name.slice(0, 1).toUpperCase();
}

/** 成員身分色（資料編碼）：依 id 穩定雜湊到一組固定的低飽和色盤 */
const MEMBER_PALETTE = [
  { bg: "#dde3ea", ink: "#4a5568" }, // 藍灰
  { bg: "#f0e6d8", ink: "#8a6d3b" }, // 杏
  { bg: "#dde7dd", ink: "#4a6048" }, // 苔綠
  { bg: "#e8dde6", ink: "#6b4a64" }, // 藕
  { bg: "#e6e1d4", ink: "#6b6248" }, // 卡其
  { bg: "#dce4e6", ink: "#456066" }, // 霧青
];

export function memberColor(id: string): { bg: string; ink: string } {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return MEMBER_PALETTE[h % MEMBER_PALETTE.length];
}

export function ymAdd(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function currentYm(): string {
  return new Date().toISOString().slice(0, 7);
}
