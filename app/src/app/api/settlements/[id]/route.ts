import { NextRequest, NextResponse } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireMembership } from "@/lib/guards";
import { recordEvent, fmtAmt } from "@/lib/events";

// FR-11 / SF-8: mark settlement PAID / undo (idempotent, PENDING<->PAID)
export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const tx = db.select().from(schema.settlementTransactions).where(eq(schema.settlementTransactions.id, id)).get();
  if (!tx) throw new ApiError("SETTLEMENT_NOT_FOUND", "找不到這筆結清項");

  const period = db
    .select()
    .from(schema.billingPeriods)
    .where(eq(schema.billingPeriods.id, tx.billingPeriodId))
    .get()!;
  const { membership, user } = await requireMembership(period.ledgerId); // BR-10

  const body = await req.json().catch(() => null);
  const status = body?.status === "PAID" ? "PAID" : body?.status === "PENDING" ? "PENDING" : null;
  if (!status) throw new ApiError("INVALID_REQUEST", "付款狀態不正確");

  db.update(schema.settlementTransactions)
    .set(
      status === "PAID"
        ? { status, paidAt: new Date(), paidBy: membership.id }
        : { status, paidAt: null, paidBy: null }
    )
    .where(eq(schema.settlementTransactions.id, id))
    .run();
  // #2 動態：僅在 PENDING→PAID 轉換時記一筆（避免重複標記洗版）
  if (status === "PAID" && tx.status !== "PAID") {
    const names = db
      .select({ mid: schema.memberships.id, name: schema.users.displayName })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
      .where(inArray(schema.memberships.id, [tx.fromMemberId, tx.toMemberId]))
      .all();
    const nameOf = (mid: string) => names.find((n) => n.mid === mid)?.name ?? "?";
    recordEvent({
      ledgerId: period.ledgerId,
      actorUserId: user.id,
      actorName: user.displayName,
      type: "SETTLEMENT_PAID",
      summary: `標記「${nameOf(tx.fromMemberId)} → ${nameOf(tx.toMemberId)} ${fmtAmt(tx.amount)}」已付`,
    });
  }

  const updated = db
    .select()
    .from(schema.settlementTransactions)
    .where(eq(schema.settlementTransactions.id, id))
    .get()!;
  return NextResponse.json({
    id: updated.id,
    from_member_id: updated.fromMemberId,
    to_member_id: updated.toMemberId,
    amount: updated.amount,
    status: updated.status,
    paid_at: updated.paidAt?.toISOString() ?? null,
  });
});
