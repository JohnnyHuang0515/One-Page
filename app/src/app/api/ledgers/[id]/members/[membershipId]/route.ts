import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireOwnership, assertMemberSettled } from "@/lib/guards";

// FR-13 / D-0006: 擁有者移除成員（標記 REMOVED、保留歷史）。成員須先結清。
export const DELETE = handle(
  async (_req: NextRequest, ctx: { params: Promise<{ id: string; membershipId: string }> }) => {
    const { id, membershipId } = await ctx.params;
    const { ledger } = await requireOwnership(id);

    const target = db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.id, membershipId), eq(schema.memberships.ledgerId, id)))
      .get();
    if (!target || target.status === "REMOVED") throw new ApiError("MEMBER_NOT_FOUND", "找不到這位成員");
    if (target.userId === ledger.createdBy)
      throw new ApiError("OWNER_MUST_TRANSFER", "擁有者不能被移除，請先轉移擁有權");

    assertMemberSettled(id, membershipId); // 未結清 → 409 NOT_SETTLED

    db.update(schema.memberships)
      .set({ status: "REMOVED", removedAt: new Date() })
      .where(eq(schema.memberships.id, membershipId))
      .run();
    return NextResponse.json({ ok: true });
  }
);
