import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db, schema } from "@/lib/db";
import { handle } from "@/lib/errors";
import { assertPeriodOpen, getOrCreatePeriod, requireMembership, yearMonthOf } from "@/lib/guards";
import { parseExpenseBody } from "@/lib/expense-input";
import { recordEvent, fmtAmt } from "@/lib/events";

// FR-4,5 / SF-4: record expense + compute shares
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id: ledgerId } = await ctx.params;
  const { membership, user } = await requireMembership(ledgerId);
  const payload = parseExpenseBody(await req.json().catch(() => null), ledgerId);

  const period = getOrCreatePeriod(ledgerId, yearMonthOf(payload.spentAt));
  assertPeriodOpen(period); // EF-7 / EC-8 / BR-4

  const now = new Date();
  const expense = {
    id: randomUUID(),
    ledgerId,
    billingPeriodId: period.id,
    payerId: payload.payerId,
    description: payload.description,
    amount: payload.amount,
    spentAt: payload.spentAt,
    splitMethod: payload.splitMethod,
    createdBy: membership.id,
    createdAt: now,
    updatedAt: now,
  };
  db.transaction((tx) => {
    tx.insert(schema.expenses).values(expense).run();
    for (const s of payload.shares) {
      tx.insert(schema.expenseShares)
        .values({ id: randomUUID(), expenseId: expense.id, memberId: s.memberId, shareAmount: s.shareAmount })
        .run();
    }
  });
  // #2 動態（ExpenseRecorded）
  recordEvent({
    ledgerId,
    actorUserId: user.id,
    actorName: user.displayName,
    type: "EXPENSE_ADDED",
    summary: `記了一筆「${payload.description}」 ${fmtAmt(payload.amount)}`,
  });

  return NextResponse.json(
    {
      id: expense.id,
      description: expense.description,
      payer_id: expense.payerId,
      amount: expense.amount,
      spent_at: expense.spentAt,
      split_method: expense.splitMethod,
      shares: payload.shares.map((s) => ({ member_id: s.memberId, share_amount: s.shareAmount })),
    },
    { status: 201 }
  );
});
