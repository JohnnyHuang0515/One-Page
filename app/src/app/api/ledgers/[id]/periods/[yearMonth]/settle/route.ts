import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { getOrCreatePeriod, isValidYearMonth, requireMembership } from "@/lib/guards";
import { computeNets, minimizeDebts } from "@/lib/settle";
import { recordEvent, fmtYm } from "@/lib/events";

// FR-9,10 / SF-7: settle the month — atomic (NFR-6), optimistic-locked (EC-7)
export const POST = handle(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string; yearMonth: string }> }) => {
    const { id: ledgerId, yearMonth } = await ctx.params;
    if (!isValidYearMonth(yearMonth)) throw new ApiError("PERIOD_NOT_FOUND", "月份格式不對（需為 YYYY-MM）");
    const { membership, user } = await requireMembership(ledgerId); // BR-10, any member (D-0002)

    // EC-4: settling an empty month is allowed — create the row lazily
    const period = getOrCreatePeriod(ledgerId, yearMonth);
    if (period.status !== "OPEN") throw new ApiError("PERIOD_ALREADY_SETTLED", "這個月已經月結過了"); // EF-9 / BR-5

    const now = new Date();
    const result = db.transaction((tx) => {
      // Optimistic lock (§4.4): only the first concurrent settle succeeds
      const locked = tx
        .update(schema.billingPeriods)
        .set({ status: "SETTLED", settledAt: now, settledBy: membership.id })
        .where(and(eq(schema.billingPeriods.id, period.id), sql`status = 'OPEN'`))
        .run();
      if (locked.changes !== 1) throw new ApiError("PERIOD_ALREADY_SETTLED", "這個月已經月結過了"); // EC-7

      const expenses = tx.select().from(schema.expenses).where(eq(schema.expenses.billingPeriodId, period.id)).all();
      const shares = expenses.length
        ? tx
            .select()
            .from(schema.expenseShares)
            .where(inArray(schema.expenseShares.expenseId, expenses.map((e) => e.id)))
            .all()
        : [];
      const memberIds = tx
        .select()
        .from(schema.memberships)
        .where(eq(schema.memberships.ledgerId, ledgerId))
        .all()
        .map((m) => m.id);

      const nets = computeNets(
        expenses.map((e) => ({ payerId: e.payerId, amount: e.amount })),
        shares.map((s) => ({ memberId: s.memberId, shareAmount: s.shareAmount })),
        memberIds
      );
      // BR-9 invariant: nets must sum to 0 — violation means a bug, abort the tx
      const total = [...nets.values()].reduce((a, b) => a + b, 0);
      if (total !== 0) throw new ApiError("INTERNAL_ERROR", "月結未完成：系統發生未預期的錯誤，請稍後再試");

      const transfers = minimizeDebts(nets); // D-0005
      const rows = transfers.map((t) => ({
        id: randomUUID(),
        billingPeriodId: period.id,
        fromMemberId: t.fromMemberId,
        toMemberId: t.toMemberId,
        amount: t.amount,
        status: "PENDING" as const,
        paidAt: null,
        paidBy: null,
        createdAt: now,
      }));
      for (const r of rows) tx.insert(schema.settlementTransactions).values(r).run();
      return rows;
    });
    // #2 動態（BillingPeriodSettled）
    recordEvent({
      ledgerId,
      actorUserId: user.id,
      actorName: user.displayName,
      type: "PERIOD_SETTLED",
      summary: `完成 ${fmtYm(yearMonth)}月結`,
    });

    return NextResponse.json({
      period: { year_month: yearMonth, status: "SETTLED", settled_at: now.toISOString() },
      settlements: result.map((t) => ({
        id: t.id,
        from_member_id: t.fromMemberId,
        to_member_id: t.toMemberId,
        amount: t.amount,
        status: t.status,
      })),
    });
  }
);
