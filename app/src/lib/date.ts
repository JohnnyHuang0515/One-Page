// 本地時間日期工具（部署機 / 使用者瀏覽器所在時區）。
// 不用 toISOString()，因為它會轉成 UTC——台灣（UTC+8）凌晨 00:00–07:59 會算成「昨天」，
// 跨月當天甚至會把帳記到上一個月。改用本地時間元件即可根治。

/** 本地日期字串 YYYY-MM-DD（預設今天）。 */
export function localDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 本地年月字串 YYYY-MM（預設本月）。 */
export function localYm(d: Date = new Date()): string {
  return localDate(d).slice(0, 7);
}
