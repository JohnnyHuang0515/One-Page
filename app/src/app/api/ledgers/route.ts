import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireUser } from "@/lib/session";

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

// FR-2 / SF-2: create ledger (creator auto-joins)
export const POST = handle(async (req: NextRequest) => {
  const user = await requireUser();
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw new ApiError("INVALID_REQUEST", "請填帳本名稱");

  const ledger = { id: randomUUID(), name, createdBy: user.id, currency: "TWD", createdAt: new Date() };
  db.transaction((tx) => {
    tx.insert(schema.ledgers).values(ledger).run();
    tx.insert(schema.memberships)
      .values({ id: randomUUID(), ledgerId: ledger.id, userId: user.id, joinedAt: new Date() })
      .run();
  });
  return NextResponse.json(
    { id: ledger.id, name: ledger.name, currency: ledger.currency, created_by: ledger.createdBy },
    { status: 201 }
  );
});

// FR-2 / SF-6: my ledgers
export const GET = handle(async () => {
  const user = await requireUser();
  const rows = db
    .select({ ledger: schema.ledgers })
    .from(schema.memberships)
    .innerJoin(schema.ledgers, eq(schema.memberships.ledgerId, schema.ledgers.id))
    .where(and(eq(schema.memberships.userId, user.id), eq(schema.memberships.status, "ACTIVE")))
    .all()
    // D-0006: 封存帳本不出現在索引
    .filter(({ ledger }) => ledger.status !== "ARCHIVED");

  const result = rows.map(({ ledger }) => {
    const memberCount = db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.ledgerId, ledger.id), eq(schema.memberships.status, "ACTIVE")))
      .all().length;
    const ym = currentYearMonth();
    const period = db
      .select()
      .from(schema.billingPeriods)
      .where(eq(schema.billingPeriods.ledgerId, ledger.id))
      .all()
      .find((p) => p.yearMonth === ym);
    // P-2 card: current-month spend total
    const monthTotal = period
      ? db
          .select()
          .from(schema.expenses)
          .where(eq(schema.expenses.billingPeriodId, period.id))
          .all()
          .reduce((s, e) => s + e.amount, 0)
      : 0;
    return {
      id: ledger.id,
      name: ledger.name,
      currency: ledger.currency,
      member_count: memberCount,
      month_total: monthTotal,
      current_period: { year_month: ym, status: period?.status ?? "OPEN" },
    };
  });
  return NextResponse.json(result);
});
