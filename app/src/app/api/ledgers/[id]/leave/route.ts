import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireMembership, assertMemberSettled } from "@/lib/guards";

// FR-14 / D-0006: 成員主動退出（標記 REMOVED）。擁有者須先轉移擁有權；須先結清。
export const POST = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { ledger, membership, user } = await requireMembership(id);

  if (ledger.createdBy === user.id)
    throw new ApiError("OWNER_MUST_TRANSFER", "你是擁有者，請先把擁有權轉移給其他成員再退出");

  assertMemberSettled(id, membership.id); // 未結清 → 409 NOT_SETTLED

  db.update(schema.memberships)
    .set({ status: "REMOVED", removedAt: new Date() })
    .where(eq(schema.memberships.id, membership.id))
    .run();
  return NextResponse.json({ ok: true });
});
