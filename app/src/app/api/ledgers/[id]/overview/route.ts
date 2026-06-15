import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handle } from "@/lib/errors";
import { requireMembership } from "@/lib/guards";
import { computeNets, minimizeDebts } from "@/lib/settle";

// #4 目前誰欠誰：跨所有月份、目前還沒結清的款項，彙整成「我」對每位成員的 pairwise 淨額。
// 來源 = 已結算月的 PENDING 結清項（具體）+ OPEN 月依淨額推算的結清計畫（投影）。
// 正數 = 對方還你；負數 = 你還對方。語意與「逐月結清建議」一致（同一套最小化），只是跨月彙整。
export const GET = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { membership } = await requireMembership(id);
  const myMid = membership.id;

  const memberRows = db
    .select({ m: schema.memberships, u: schema.users })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.ledgerId, id))
    .all();
  const nameOf = new Map(memberRows.map((r) => [r.m.id, r.u.displayName]));
  const userIdOf = new Map(memberRows.map((r) => [r.m.id, r.u.id]));
  const allMemberIds = memberRows.map((r) => r.m.id);
  const activeOthers = memberRows.filter((r) => r.m.status === "ACTIVE" && r.m.id !== myMid);

  const periods = db.select().from(schema.billingPeriods).where(eq(schema.billingPeriods.ledgerId, id)).all();

  const transfers: { fromMemberId: string; toMemberId: string; amount: number }[] = [];

  // 已結算月：未付清的 PENDING 結清項（具體存在）
  if (periods.length) {
    const pending = db
      .select()
      .from(schema.settlementTransactions)
      .where(
        and(
          inArray(schema.settlementTransactions.billingPeriodId, periods.map((p) => p.id)),
          eq(schema.settlementTransactions.status, "PENDING")
        )
      )
      .all();
    for (const t of pending) transfers.push({ fromMemberId: t.fromMemberId, toMemberId: t.toMemberId, amount: t.amount });
  }

  // OPEN 月：尚未結算 → 依當月淨額推算結清計畫（投影）
  for (const p of periods.filter((p) => p.status === "OPEN")) {
    const exps = db.select().from(schema.expenses).where(eq(schema.expenses.billingPeriodId, p.id)).all();
    if (!exps.length) continue;
    const shares = db
      .select()
      .from(schema.expenseShares)
      .where(inArray(schema.expenseShares.expenseId, exps.map((e) => e.id)))
      .all();
    const nets = computeNets(
      exps.map((e) => ({ payerId: e.payerId, amount: e.amount })),
      shares.map((s) => ({ memberId: s.memberId, shareAmount: s.shareAmount })),
      allMemberIds
    );
    for (const t of minimizeDebts(nets)) transfers.push(t);
  }

  // 從「我」的視角彙整 pairwise（正數＝對方還我）
  const pair = new Map<string, number>();
  for (const t of transfers) {
    if (t.fromMemberId === myMid) pair.set(t.toMemberId, (pair.get(t.toMemberId) ?? 0) - t.amount);
    else if (t.toMemberId === myMid) pair.set(t.fromMemberId, (pair.get(t.fromMemberId) ?? 0) + t.amount);
  }

  // 列出：現役其他成員 ∪ 任何有非零未結的對象（含已移除但仍有債務者）
  const ids = new Set<string>([
    ...activeOthers.map((r) => r.m.id),
    ...[...pair.entries()].filter(([, v]) => v !== 0).map(([k]) => k),
  ]);
  const pairs = [...ids]
    .map((mid) => ({
      member_id: mid,
      user_id: userIdOf.get(mid) ?? mid,
      display_name: nameOf.get(mid) ?? "?",
      net: pair.get(mid) ?? 0,
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

  const my_net = [...pair.values()].reduce((a, b) => a + b, 0);
  return NextResponse.json({ my_net, pairs });
});
