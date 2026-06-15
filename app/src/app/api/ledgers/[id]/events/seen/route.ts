import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handle } from "@/lib/errors";
import { requireMembership } from "@/lib/guards";

// #2 動態：標記已讀（更新此人的 activity_seen_at → 清掉未讀數）。
export const POST = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { membership } = await requireMembership(id);
  db.update(schema.memberships)
    .set({ activitySeenAt: new Date() })
    .where(eq(schema.memberships.id, membership.id))
    .run();
  return NextResponse.json({ ok: true });
});
