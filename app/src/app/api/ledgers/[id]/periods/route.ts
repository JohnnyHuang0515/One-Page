import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handle } from "@/lib/errors";
import { requireMembership } from "@/lib/guards";

// FR-12 / SF-9: list billing periods (history)
export const GET = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireMembership(id);
  const rows = db
    .select()
    .from(schema.billingPeriods)
    .where(eq(schema.billingPeriods.ledgerId, id))
    .all()
    .sort((a, b) => (a.yearMonth < b.yearMonth ? 1 : -1));
  return NextResponse.json(
    rows.map((p) => ({
      year_month: p.yearMonth,
      status: p.status,
      settled_at: p.settledAt?.toISOString() ?? null,
    }))
  );
});
