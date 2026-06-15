import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { publish } from "./realtime";

// #2 動態：append-only 活動事件流。每個變動的 route 寫一筆。
export type EventType =
  | "EXPENSE_ADDED"
  | "EXPENSE_EDITED"
  | "EXPENSE_DELETED"
  | "SETTLEMENT_PAID"
  | "PERIOD_SETTLED"
  | "MEMBER_JOINED";

/** 動態敘述用的金額格式（千分位，無小數）—— 與全站 fmtMoney 一致用 zh-TW locale。 */
export function fmtAmt(n: number) {
  return `$${n.toLocaleString("zh-TW")}`;
}

/** 動態敘述用的月份格式。收 "YYYY-MM" 或 "YYYY-MM-DD"（只取前 7 字）。
 *  同年 → 「6 月」；跨年 → 「2025 年 12 月」。server 端可直接用 Date 取今年。 */
export function fmtYm(ymOrDate: string): string {
  const ym = ymOrDate.slice(0, 7); // YYYY-MM
  const [yStr, mStr] = ym.split("-");
  const year = Number(yStr);
  const month = Number(mStr); // 1–12，去掉前導 0
  const thisYear = new Date().getFullYear();
  return year === thisYear ? `${month} 月` : `${year} 年 ${month} 月`;
}

/** join memberships × users，回 membershipId → displayName 的 Map。
 *  不過濾 status（REMOVED 的成員也要查得到名字）；查無的 id 一律回 "?"。 */
export function memberNames(ledgerId: string, ids: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const id of ids) map.set(id, "?"); // 預設值：查不到就維持 "?"
  if (!ids.length) return map;
  const rows = db
    .select({ mid: schema.memberships.id, name: schema.users.displayName })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(inArray(schema.memberships.id, ids))
    .all();
  for (const r of rows) map.set(r.mid, r.name);
  return map;
}

/** 寫一筆動態事件。actorName 去正規化保存 —— 成員之後被移除仍能正確顯示。 */
export function recordEvent(input: {
  ledgerId: string;
  actorUserId: string;
  actorName: string;
  type: EventType;
  summary: string;
}) {
  db.insert(schema.events)
    .values({
      id: randomUUID(),
      ledgerId: input.ledgerId,
      actorUserId: input.actorUserId,
      actorName: input.actorName,
      type: input.type,
      summary: input.summary,
      createdAt: new Date(),
    })
    .run();

  // 寫入成功後即時推播給正在看這本帳本的成員（SSE）。
  // 包 try/catch：推播失敗不影響記帳/編輯/刪除等主流程。
  try {
    publish(input.ledgerId, {
      type: input.type,
      summary: input.summary,
      actorName: input.actorName,
      at: Date.now(),
    });
  } catch (err) {
    console.error("[events] publish 推播失敗，已略過", err);
  }
}
