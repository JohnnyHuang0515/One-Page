import { NextRequest, NextResponse } from "next/server";
import { ApiError, handle } from "@/lib/errors";
import { isValidYearMonth, requireMembership } from "@/lib/guards";
import { buildPeriodView } from "@/lib/period-view";

// FR-7,8,9,12 / SF-6,9: month detail = balances + expenses + settlements
// A month with no row yet is a virtual OPEN month (empty data).
export const GET = handle(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string; yearMonth: string }> }) => {
    const { id, yearMonth } = await ctx.params;
    if (!isValidYearMonth(yearMonth)) throw new ApiError("PERIOD_NOT_FOUND", "月份格式不對（需為 YYYY-MM）");
    await requireMembership(id);
    const { view } = buildPeriodView(id, yearMonth);
    return NextResponse.json(view);
  }
);
