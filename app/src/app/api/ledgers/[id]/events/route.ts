import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { handle } from "@/lib/errors";
import { requireMembership } from "@/lib/guards";

// #2 動態：最近事件（新→舊，上限 40）+ 未讀數（我上次查看後、且非我本人的事件）。
export const GET = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { user, membership } = await requireMembership(id);
  const rows = db
    .select()
    .from(schema.events)
    .where(eq(schema.events.ledgerId, id))
    .orderBy(desc(schema.events.createdAt))
    .limit(40)
    .all();
  const seen = membership.activitySeenAt?.getTime() ?? 0;
  const isUnread = (e: (typeof rows)[number]) => e.createdAt.getTime() > seen && e.actorUserId !== user.id;
  return NextResponse.json({
    unread_count: rows.filter(isUnread).length,
    events: rows.map((e) => ({
      id: e.id,
      actor_user_id: e.actorUserId,
      actor_name: e.actorName,
      type: e.type,
      summary: e.summary,
      created_at: e.createdAt.toISOString(),
      unread: isUnread(e),
    })),
  });
});
