import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { assertPeriodOpen, getOrCreatePeriod, isValidYearMonth, requireMembership } from "@/lib/guards";
import { computeShares } from "@/lib/split";
import { recordEvent } from "@/lib/events";

// #1 從上月帶入：把選定的來源花費複製進目標 OPEN 月（伺服器端複製，不信任前端 shares）。
//   平均分攤 → 用「目前現役成員」重新平分（金額可由前端覆寫）；
//   指定金額 → 沿用各人原金額、只帶現役者（金額 = 現役者原金額總和，不另改）。
//   付款人已離開（非 ACTIVE）的來源花費 → 跳過。
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string; yearMonth: string }> }) => {
  const { id: ledgerId, yearMonth } = await ctx.params;
  if (!isValidYearMonth(yearMonth)) throw new ApiError("PERIOD_NOT_FOUND", "月份格式不對（需為 YYYY-MM）");
  const { user, membership } = await requireMembership(ledgerId);

  const target = getOrCreatePeriod(ledgerId, yearMonth);
  assertPeriodOpen(target); // 只能帶入未鎖定的月

  const body = await req.json().catch(() => null);
  const items: { expense_id: string; amount?: number }[] = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) throw new ApiError("INVALID_REQUEST", "請選擇要帶入的花費");

  const activeIds = new Set(
    db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.ledgerId, ledgerId), eq(schema.memberships.status, "ACTIVE")))
      .all()
      .map((m) => m.id)
  );
  const activeList = [...activeIds];
  const spentAt = `${yearMonth}-01`;
  const now = new Date();
  let created = 0;
  let skipped = 0;

  db.transaction((tx) => {
    for (const it of items) {
      const srcId = typeof it?.expense_id === "string" ? it.expense_id : "";
      const src = tx.select().from(schema.expenses).where(eq(schema.expenses.id, srcId)).get();
      if (!src || src.ledgerId !== ledgerId || !activeIds.has(src.payerId)) {
        skipped++;
        continue;
      }
      let amount: number;
      let shares: { memberId: string; shareAmount: number }[];
      if (src.splitMethod === "EQUAL") {
        if (!activeList.length) {
          skipped++;
          continue;
        }
        amount = Number.isInteger(it.amount) && (it.amount as number) > 0 ? (it.amount as number) : src.amount;
        shares = computeShares({
          amount,
          payerId: src.payerId,
          splitMethod: "EQUAL",
          participants: activeList.map((mid) => ({ memberId: mid })),
        });
      } else {
        const srcShares = tx
          .select()
          .from(schema.expenseShares)
          .where(eq(schema.expenseShares.expenseId, src.id))
          .all()
          .filter((s) => activeIds.has(s.memberId));
        if (!srcShares.length) {
          skipped++;
          continue;
        }
        amount = srcShares.reduce((a, s) => a + s.shareAmount, 0);
        shares = srcShares.map((s) => ({ memberId: s.memberId, shareAmount: s.shareAmount }));
      }
      const expId = randomUUID();
      tx.insert(schema.expenses)
        .values({
          id: expId,
          ledgerId,
          billingPeriodId: target.id,
          payerId: src.payerId,
          description: src.description,
          amount,
          spentAt,
          splitMethod: src.splitMethod,
          createdBy: membership.id,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const s of shares) {
        tx.insert(schema.expenseShares)
          .values({ id: randomUUID(), expenseId: expId, memberId: s.memberId, shareAmount: s.shareAmount })
          .run();
      }
      created++;
    }
  });

  if (created) {
    recordEvent({
      ledgerId,
      actorUserId: user.id,
      actorName: user.displayName,
      type: "EXPENSE_ADDED",
      summary: `從上月帶入 ${created} 筆花費`,
    });
  }
  return NextResponse.json({ created, skipped });
});
