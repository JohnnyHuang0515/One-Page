import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireOwnership } from "@/lib/guards";

// FR-16 / D-0006: 擁有者把擁有權轉移給另一位現役成員（更新 Ledger.created_by）。
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { user } = await requireOwnership(id);

  const body = await req.json().catch(() => null);
  const memberId = typeof body?.member_id === "string" ? body.member_id : "";
  if (!memberId) throw new ApiError("INVALID_REQUEST", "請選擇要接手的成員");

  const target = db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.id, memberId), eq(schema.memberships.ledgerId, id)))
    .get();
  if (!target || target.status === "REMOVED") throw new ApiError("MEMBER_NOT_FOUND", "找不到這位成員");
  if (target.userId === user.id) throw new ApiError("INVALID_MEMBER", "你已經是擁有者了");

  db.update(schema.ledgers).set({ createdBy: target.userId }).where(eq(schema.ledgers.id, id)).run();
  return NextResponse.json({ ok: true });
});
