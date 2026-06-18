// P-0 墨流し首頁 — 自動演出的重播資料:「還沒結清的帳,才會被滴出來」。
// 範圍:使用者「所有帳本」中,當月(日曆月)OPEN 期間的全部花費。
// 順序:按帳本分組(最近有記帳的帳本先),本內照消費日期舊→新;客端在換本時多停一拍。
// 當月全結清或沒記帳 → 回傳 null,首頁退回純隨機滴墨(帳清了,紙就乾淨)。
// 位置/墨色由前端隨機決定,這裡只供帳目內容。
import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { localYm } from "./date";
import type { ReplayData } from "@/components/ink/suminagashi-canvas";

export function getHomeReplay(userId: string): ReplayData | null {
  const myMemberships = db
    .select()
    .from(schema.memberships)
    .where(eq(schema.memberships.userId, userId))
    .all();
  if (!myMemberships.length) return null;
  const ledgerIds = myMemberships.map((m) => m.ledgerId);

  const ym = localYm(); // 本地時間當月（與其他 route 同一慣例）
  const rows = db
    .select({ expense: schema.expenses })
    .from(schema.expenses)
    .innerJoin(schema.billingPeriods, eq(schema.expenses.billingPeriodId, schema.billingPeriods.id))
    .where(
      and(
        inArray(schema.expenses.ledgerId, ledgerIds),
        eq(schema.billingPeriods.status, "OPEN"),
        eq(schema.billingPeriods.yearMonth, ym)
      )
    )
    .orderBy(asc(schema.expenses.spentAt), asc(schema.expenses.createdAt))
    .all();
  if (!rows.length) return null;

  // 按帳本分組:最近有記帳的帳本先播;本內維持查詢的消費日期舊→新
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = groups.get(row.expense.ledgerId) ?? [];
    list.push(row);
    groups.set(row.expense.ledgerId, list);
  }
  const ordered = [...groups.values()]
    .sort(
      (a, b) =>
        Math.max(...b.map((r) => r.expense.createdAt.getTime())) -
        Math.max(...a.map((r) => r.expense.createdAt.getTime()))
    )
    .flat();

  // 帳本名:跨帳本演出,小字要標明出處
  const usedLedgerIds = [...new Set(rows.map(({ expense }) => expense.ledgerId))];
  const ledgers = db.select().from(schema.ledgers).where(inArray(schema.ledgers.id, usedLedgerIds)).all();
  const nameByLedgerId = new Map(ledgers.map((l) => [l.id, l.name]));

  // 付款人名:payerId 是 membership id(各帳本各自的),一次撈齊
  const payerIds = [...new Set(rows.map(({ expense }) => expense.payerId))];
  const payerMemberships = db
    .select()
    .from(schema.memberships)
    .where(inArray(schema.memberships.id, payerIds))
    .all();
  const users = db
    .select()
    .from(schema.users)
    .where(inArray(schema.users.id, [...new Set(payerMemberships.map((m) => m.userId))]))
    .all();
  const nameByUserId = new Map(users.map((u) => [u.id, u.displayName]));
  const userIdByMemberId = new Map(payerMemberships.map((m) => [m.id, m.userId]));

  return {
    title: `${Number(ym.slice(5, 7))}月 · 未結清`,
    drops: ordered.map(({ expense: e }) => ({
      ledger: nameByLedgerId.get(e.ledgerId) ?? "",
      amount: e.amount,
      label: e.description,
      payerName: nameByUserId.get(userIdByMemberId.get(e.payerId) ?? "") ?? "",
    })),
  };
}
