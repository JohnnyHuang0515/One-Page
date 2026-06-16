import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db, schema } from "./db";
import { ApiError } from "./errors";
import { requireUser } from "./session";

/** BR-10 / NFR-4: caller must be an ACTIVE member of an ACTIVE ledger (403/404 otherwise). */
export async function requireMembership(ledgerId: string) {
  const user = await requireUser();
  const ledger = db.select().from(schema.ledgers).where(eq(schema.ledgers.id, ledgerId)).get();
  if (!ledger || ledger.status === "ARCHIVED") throw new ApiError("LEDGER_NOT_FOUND", "找不到這本帳本"); // D-0006: 封存視同不存在
  const membership = db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.ledgerId, ledgerId), eq(schema.memberships.userId, user.id)))
    .get();
  if (!membership || membership.status === "REMOVED") throw new ApiError("FORBIDDEN", "你不是這個帳本的成員"); // EF-4 / D-0006
  return { user, ledger, membership };
}

/** D-0006 / NFR-4b: 破壞性動作限帳本擁有者（Ledger.created_by）。 */
export async function requireOwnership(ledgerId: string) {
  const ctx = await requireMembership(ledgerId);
  if (ctx.ledger.createdBy !== ctx.user.id) throw new ApiError("FORBIDDEN", "只有帳本擁有者可執行此動作");
  return ctx;
}

/** 某成員在某帳期的淨額（付 − 分攤）。 */
function memberNetInPeriod(periodId: string, membershipId: string): number {
  const exps = db.select().from(schema.expenses).where(eq(schema.expenses.billingPeriodId, periodId)).all();
  const paid = exps.filter((e) => e.payerId === membershipId).reduce((s, e) => s + e.amount, 0);
  const ids = exps.map((e) => e.id);
  const owed = ids.length
    ? db
        .select()
        .from(schema.expenseShares)
        .where(and(inArray(schema.expenseShares.expenseId, ids), eq(schema.expenseShares.memberId, membershipId)))
        .all()
        .reduce((s, sh) => s + sh.shareAmount, 0)
    : 0;
  return paid - owed;
}

/** D-0006 結清前置：移除成員 / 自退前，該成員須已結清
 *  （所有 OPEN 帳期淨額為 0，且無牽涉該成員的 PENDING 結清項）。 */
export function assertMemberSettled(ledgerId: string, membershipId: string) {
  const periods = db.select().from(schema.billingPeriods).where(eq(schema.billingPeriods.ledgerId, ledgerId)).all();
  for (const p of periods) {
    if (p.status === "OPEN" && memberNetInPeriod(p.id, membershipId) !== 0) {
      throw new ApiError("NOT_SETTLED", "這位成員還有未付清的款項，請先完成月結並付清再移除");
    }
  }
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
    if (pending.some((t) => t.fromMemberId === membershipId || t.toMemberId === membershipId)) {
      throw new ApiError("NOT_SETTLED", "這位成員還有未付清的結清項，請先標記已付再移除");
    }
  }
}

/** D-0006 結清前置：刪帳本前，全帳本無未結清
 *  （無 PENDING 結清項，且每個 OPEN 帳期淨額全為 0）。 */
export function assertLedgerSettled(ledgerId: string) {
  const periods = db.select().from(schema.billingPeriods).where(eq(schema.billingPeriods.ledgerId, ledgerId)).all();
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
    if (pending.length) throw new ApiError("NOT_SETTLED", "還有未付清的結清項，請先標記已付再刪除帳本");
  }
  for (const p of periods) {
    if (p.status !== "OPEN") continue;
    const exps = db.select().from(schema.expenses).where(eq(schema.expenses.billingPeriodId, p.id)).all();
    if (!exps.length) continue;
    const ids = exps.map((e) => e.id);
    const shares = db.select().from(schema.expenseShares).where(inArray(schema.expenseShares.expenseId, ids)).all();
    const net = new Map<string, number>();
    for (const e of exps) net.set(e.payerId, (net.get(e.payerId) ?? 0) + e.amount);
    for (const s of shares) net.set(s.memberId, (net.get(s.memberId) ?? 0) - s.shareAmount);
    if ([...net.values()].some((v) => v !== 0)) {
      throw new ApiError("NOT_SETTLED", `${p.yearMonth} 還有未付清的款項，請先完成月結並付清再刪除帳本`);
    }
  }
}

export function yearMonthOf(dateStr: string): string {
  return dateStr.slice(0, 7); // YYYY-MM-DD -> YYYY-MM
}

export function isValidYearMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Get the BillingPeriod row for (ledger, yearMonth), creating an OPEN one
 * lazily if absent (BR-8 unique constraint guards duplicates).
 */
export function getOrCreatePeriod(ledgerId: string, yearMonth: string) {
  const existing = db
    .select()
    .from(schema.billingPeriods)
    .where(and(eq(schema.billingPeriods.ledgerId, ledgerId), eq(schema.billingPeriods.yearMonth, yearMonth)))
    .get();
  if (existing) return existing;
  const row = {
    id: randomUUID(),
    ledgerId,
    yearMonth,
    status: "OPEN" as const,
    settledAt: null,
    settledBy: null,
    createdAt: new Date(),
  };
  try {
    db.insert(schema.billingPeriods).values(row).run();
    return row;
  } catch {
    // concurrent create hit BR-8 unique index — re-read
    return db
      .select()
      .from(schema.billingPeriods)
      .where(and(eq(schema.billingPeriods.ledgerId, ledgerId), eq(schema.billingPeriods.yearMonth, yearMonth)))
      .get()!;
  }
}

/** BR-4 / EF-7: writes only allowed while the period is OPEN. */
export function assertPeriodOpen(period: { status: string; yearMonth: string }) {
  if (period.status !== "OPEN") {
    throw new ApiError("PERIOD_LOCKED", `${period.yearMonth} 已結算、不能再改，請改記到還沒結算的月份`);
  }
}
