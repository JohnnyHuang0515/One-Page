import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";
import { db, schema } from "@/lib/db";
import { handle } from "@/lib/errors";
import { requireMembership } from "@/lib/guards";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// FR-3 / SF-3: create invitation (any member, D-0002)
export const POST = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { membership } = await requireMembership(id);

  const code = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  db.insert(schema.invitations)
    .values({
      id: randomUUID(),
      ledgerId: id,
      code,
      createdBy: membership.id,
      status: "PENDING",
      expiresAt,
      createdAt: new Date(),
    })
    .run();

  const url = new URL(`/join/${code}`, req.nextUrl.origin).toString();
  return NextResponse.json({ code, url, expires_at: expiresAt.toISOString() }, { status: 201 });
});
