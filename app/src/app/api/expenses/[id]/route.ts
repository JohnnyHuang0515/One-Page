import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { assertPeriodOpen, getOrCreatePeriod, requireMembership, yearMonthOf } from "@/lib/guards";
import { parseExpenseBody } from "@/lib/expense-input";
import { recordEvent, fmtAmt } from "@/lib/events";

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
    summary: `把「${payload.description}」改成 ${fmtAmt(payload.amount)}`,
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
    summary: `刪除了一筆「${expense.description}」 ${fmtAmt(expense.amount)}`,
  });
  return new NextResponse(null, { status: 204 });
});
