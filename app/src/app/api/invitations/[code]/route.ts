import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { localYm } from "@/lib/date";

// FR-3 / SF-3: preview invitation (landing page, no auth)
// Extended for P-4: inviter name + member initials + current period
export const GET = handle(async (_req: NextRequest, ctx: { params: Promise<{ code: string }> }) => {
  const { code } = await ctx.params;
  const inv = db.select().from(schema.invitations).where(eq(schema.invitations.code, code)).get();
  if (!inv) throw new ApiError("INVITATION_NOT_FOUND", "找不到這個邀請");
  if (inv.expiresAt && inv.expiresAt.getTime() < Date.now()) {
    throw new ApiError("INVITATION_EXPIRED", "邀請已過期，請成員重新產生"); // EF-3
  }
  if (inv.status !== "PENDING") {
    throw new ApiError("INVITATION_NOT_PENDING", "邀請已被使用或撤銷"); // EF-3
  }
  const ledger = db.select().from(schema.ledgers).where(eq(schema.ledgers.id, inv.ledgerId)).get();

  const members = db
    .select({ membership: schema.memberships, user: schema.users })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(eq(schema.memberships.ledgerId, inv.ledgerId))
    .all();
  const inviter = members.find((m) => m.membership.id === inv.createdBy);

  const ym = localYm();
  const period = db
    .select()
    .from(schema.billingPeriods)
    .where(eq(schema.billingPeriods.ledgerId, inv.ledgerId))
    .all()
    .find((p) => p.yearMonth === ym);

  return NextResponse.json({
    ledger_name: ledger?.name ?? "",
    status: inv.status,
    inviter_name: inviter?.user.displayName ?? null,
    member_count: members.length,
    member_names: members.map((m) => m.user.displayName),
    current_period: { year_month: ym, status: period?.status ?? "OPEN" },
  });
});
