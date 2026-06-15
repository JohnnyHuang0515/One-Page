import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireUser } from "@/lib/session";
import { recordEvent } from "@/lib/events";

// FR-3 / SF-3: accept invitation -> Membership; Invitation -> ACCEPTED
export const POST = handle(async (_req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const user = await requireUser();

  const inv = db.select().from(schema.invitations).where(eq(schema.invitations.code, code)).get();
  if (!inv) throw new ApiError("INVITATION_NOT_FOUND", "找不到這個邀請");
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
    throw new ApiError("INVITATION_EXPIRED", "邀請已過期，請成員重新產生"); // EF-3
  }
  if (inv.status !== "PENDING") {
    throw new ApiError("INVITATION_NOT_PENDING", "邀請已被使用或撤銷"); // EF-3
  }

  // BR-6 / AC-BR.6: already a member -> return existing membership, invitation stays usable for others? POC: idempotent join
  const existing = db
    .select()
    .from(schema.memberships)
    .where(and(eq(schema.memberships.ledgerId, inv.ledgerId), eq(schema.memberships.userId, user.id)))
    .get();
  if (existing) {
    // D-0006：被移除(REMOVED)的成員可透過邀請重新加入 → 重新啟用既有 membership 並消耗邀請。
    if (existing.status === "REMOVED") {
      db.transaction((tx) => {
        tx.update(schema.memberships)
          .set({ status: "ACTIVE", removedAt: null })
          .where(eq(schema.memberships.id, existing.id))
          .run();
        tx.update(schema.invitations).set({ status: "ACCEPTED" }).where(eq(schema.invitations.id, inv.id)).run();
      });
      recordEvent({ ledgerId: inv.ledgerId, actorUserId: user.id, actorName: user.displayName, type: "MEMBER_JOINED", summary: "重新加入帳本" });
    }
    return NextResponse.json({ ledger_id: inv.ledgerId, membership_id: existing.id });
  }

  const membershipId = randomUUID();
  db.transaction((tx) => {
    tx.insert(schema.memberships)
      .values({ id: membershipId, ledgerId: inv.ledgerId, userId: user.id, joinedAt: new Date() })
      .run();
    tx.update(schema.invitations)
      .set({ status: "ACCEPTED" })
      .where(eq(schema.invitations.id, inv.id))
      .run();
  });
  // #2 動態（MemberJoined）
  recordEvent({ ledgerId: inv.ledgerId, actorUserId: user.id, actorName: user.displayName, type: "MEMBER_JOINED", summary: "加入帳本" });
  return NextResponse.json({ ledger_id: inv.ledgerId, membership_id: membershipId });
});
