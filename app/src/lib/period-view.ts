import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { computeNets } from "./settle";

/** Build the §6.2 GET period response: balances + expenses + settlements. */
export function buildPeriodView(ledgerId: string, yearMonth: string) {
  const period = db
    .select()
    .from(schema.billingPeriods)
    .where(and(eq(schema.billingPeriods.ledgerId, ledgerId), eq(schema.billingPeriods.yearMonth, yearMonth)))
    .get();

  // 所有 membership（含 REMOVED）：供歷史名稱解析
  const members = db
    .select({ membership: schema.memberships, user: schema.users })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.ledgerId, ledgerId))
    .all();
  const nameOf = new Map(members.map((m) => [m.membership.id, m.user.displayName]));

  const expenses = period
    ? db.select().from(schema.expenses).where(eq(schema.expenses.billingPeriodId, period.id)).all()
    : [];
  const shares = expenses.length
    ? db
        .select()
        .from(schema.expenseShares)
        .where(inArray(schema.expenseShares.expenseId, expenses.map((e) => e.id)))
        .all()
    : [];
  const sharesByExpense = new Map<string, typeof shares>();
  for (const s of shares) {
    const list = sharesByExpense.get(s.expenseId) ?? [];
    list.push(s);
    sharesByExpense.set(s.expenseId, list);
  }

  // D-0006: balances 顯示「現役成員」∪「本期有參與者」——
  // 當前/未來月排除已移除者；過去月仍含當時參與的已移除成員（歷史正確）。
  const participantIds = new Set<string>([
    ...expenses.map((e) => e.payerId),
    ...shares.map((s) => s.memberId),
  ]);
  const viewMembers = members.filter(
    (m) => m.membership.status === "ACTIVE" || participantIds.has(m.membership.id)
  );

  // FR-8 / BR-9: net = paid - owed; sum(net) === 0
  const nets = computeNets(
    expenses.map((e) => ({ payerId: e.payerId, amount: e.amount })),
    shares.map((s) => ({ memberId: s.memberId, shareAmount: s.shareAmount })),
    viewMembers.map((m) => m.membership.id)
  );

  const settlements = period
    ? db
        .select()
        .from(schema.settlementTransactions)
        .where(eq(schema.settlementTransactions.billingPeriodId, period.id))
        .all()
    : [];

  return {
    period, // null = no row yet (virtual OPEN month)
    view: {
      year_month: yearMonth,
      status: period?.status ?? "OPEN",
      settled_at: period?.settledAt?.toISOString() ?? null,
      balances: viewMembers.map((m) => ({
        member_id: m.membership.id,
        display_name: m.user.displayName,
        net: nets.get(m.membership.id) ?? 0,
      })),
      expenses: expenses
        .sort((a, b) => (a.spentAt < b.spentAt ? 1 : a.spentAt > b.spentAt ? -1 : 0))
        .map((e) => ({
          id: e.id,
          description: e.description,
          payer_id: e.payerId,
          payer_name: nameOf.get(e.payerId) ?? "?",
          amount: e.amount,
          spent_at: e.spentAt,
          split_method: e.splitMethod,
          shares: (sharesByExpense.get(e.id) ?? []).map((s) => ({
            member_id: s.memberId,
            member_name: nameOf.get(s.memberId) ?? "?",
            share_amount: s.shareAmount,
          })),
        })),
      settlements: settlements.map((t) => ({
        id: t.id,
        from_member_id: t.fromMemberId,
        from_name: nameOf.get(t.fromMemberId) ?? "?",
        to_member_id: t.toMemberId,
        to_name: nameOf.get(t.toMemberId) ?? "?",
        amount: t.amount,
        status: t.status,
      })),
    },
  };
}
