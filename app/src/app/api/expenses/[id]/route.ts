import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { assertPeriodOpen, getOrCreatePeriod, requireMembership, yearMonthOf } from "@/lib/guards";
import { parseExpenseBody } from "@/lib/expense-input";
import { recordEvent, fmtAmt, fmtYm, memberNames } from "@/lib/events";

function loadExpense(id: string) {
  const expense = db.select().from(schema.expenses).where(eq(schema.expenses.id, id)).get();
  if (!expense) throw new ApiError("EXPENSE_NOT_FOUND", "找不到這筆花費");
  return expense;
}

function loadPeriod(periodId: string) {
  return db.select().from(schema.billingPeriods).where(eq(schema.billingPeriods.id, periodId)).get()!;
}

// FR-6 / SF-5: edit expense (full replace, any member — D-0002; EC-6 last-write-wins)
export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const expense = loadExpense(id);
  const { user } = await requireMembership(expense.ledgerId);
  assertPeriodOpen(loadPeriod(expense.billingPeriodId)); // BR-4 / EF-7

  // POC: PATCH takes the full expense payload (same shape as create)
  const payload = parseExpenseBody(await req.json().catch(() => null), expense.ledgerId);

  // spent_at may move the expense to another month — target period must be OPEN too
  const targetPeriod = getOrCreatePeriod(expense.ledgerId, yearMonthOf(payload.spentAt));
  assertPeriodOpen(targetPeriod);

  // 比對「更新前」狀態 vs payload，組出真正改了什麼 —— 趕在交易刪除舊 shares 之前先讀舊 shares。
  const oldShares = db
    .select()
    .from(schema.expenseShares)
    .where(eq(schema.expenseShares.expenseId, id))
    .all();
  const changes: string[] = [];
  // 名字（付款人改動時用）：把可能涉及的成員 id 都查出來，REMOVED 也查得到。
  const names = memberNames(expense.ledgerId, [expense.payerId, payload.payerId]);
  if (expense.amount !== payload.amount) {
    changes.push(`金額 ${fmtAmt(expense.amount)} → ${fmtAmt(payload.amount)}`);
  }
  if (expense.payerId !== payload.payerId) {
    changes.push(`付款人改為 ${names.get(payload.payerId) ?? "?"}`);
  }
  if (expense.splitMethod !== payload.splitMethod) {
    changes.push(`分攤方式改為${payload.splitMethod === "EQUAL" ? "平均分攤" : "指定金額"}`);
  }
  if (yearMonthOf(expense.spentAt) !== yearMonthOf(payload.spentAt)) {
    changes.push(`月份改到 ${fmtYm(payload.spentAt)}`);
  } else if (expense.spentAt !== payload.spentAt) {
    changes.push(`日期改為 ${payload.spentAt.slice(5)}`); // MM-DD
  }
  // 分攤對象/各人金額有變：比對 memberId → shareAmount 的對應。
  const oldShareMap = new Map(oldShares.map((s) => [s.memberId, s.shareAmount]));
  const newShareMap = new Map(payload.shares.map((s) => [s.memberId, s.shareAmount]));
  const sharesChanged =
    oldShareMap.size !== newShareMap.size ||
    [...newShareMap].some(([mid, amt]) => oldShareMap.get(mid) !== amt);
  if (sharesChanged) changes.push("分攤明細");

  db.transaction((tx) => {
    tx.update(schema.expenses)
      .set({
        payerId: payload.payerId,
        description: payload.description,
        amount: payload.amount,
        spentAt: payload.spentAt,
        splitMethod: payload.splitMethod,
        billingPeriodId: targetPeriod.id,
        updatedAt: new Date(),
      })
      .where(eq(schema.expenses.id, id))
      .run();
    tx.delete(schema.expenseShares).where(eq(schema.expenseShares.expenseId, id)).run();
    for (const s of payload.shares) {
      tx.insert(schema.expenseShares)
        .values({ id: randomUUID(), expenseId: id, memberId: s.memberId, shareAmount: s.shareAmount })
        .run();
    }
  });
  recordEvent({
    ledgerId: expense.ledgerId,
    actorUserId: user.id,
    actorName: user.displayName,
    type: "EXPENSE_EDITED",
    summary: changes.length
      ? `改了 ${fmtYm(payload.spentAt)}的「${payload.description}」（${changes.join("、")}）`
      : `更新了 ${fmtYm(payload.spentAt)}的「${payload.description}」`,
  });

  return NextResponse.json({
    id,
    description: payload.description,
    payer_id: payload.payerId,
    amount: payload.amount,
    spent_at: payload.spentAt,
    split_method: payload.splitMethod,
    shares: payload.shares.map((s) => ({ member_id: s.memberId, share_amount: s.shareAmount })),
  });
});

// FR-6 / SF-5: delete expense
export const DELETE = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const expense = loadExpense(id);
  const { user } = await requireMembership(expense.ledgerId);
  assertPeriodOpen(loadPeriod(expense.billingPeriodId)); // BR-4 / EF-7

  db.transaction((tx) => {
    tx.delete(schema.expenseShares).where(eq(schema.expenseShares.expenseId, id)).run();
    tx.delete(schema.expenses).where(eq(schema.expenses.id, id)).run();
  });
  recordEvent({
    ledgerId: expense.ledgerId,
    actorUserId: user.id,
    actorName: user.displayName,
    type: "EXPENSE_DELETED",
    summary: `刪除了 ${fmtYm(expense.spentAt)}的「${expense.description}」${fmtAmt(expense.amount)}`,
  });
  return new NextResponse(null, { status: 204 });
});
