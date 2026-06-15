import { randomUUID } from "crypto";
import { db, schema } from "./db";

// #2 動態：append-only 活動事件流。每個變動的 route 寫一筆。
export type EventType =
  | "EXPENSE_ADDED"
  | "EXPENSE_EDITED"
  | "EXPENSE_DELETED"
  | "SETTLEMENT_PAID"
  | "PERIOD_SETTLED"
  | "MEMBER_JOINED";

/** 動態敘述用的金額格式（千分位，無小數）。 */
export function fmtAmt(n: number) {
  return `$${n.toLocaleString("en-US")}`;
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
}
