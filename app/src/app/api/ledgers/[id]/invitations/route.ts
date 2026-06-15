import { NextRequest, NextResponse } from "next/server";
import { randomUUID, randomBytes } from "crypto";
import os from "os";
import { db, schema } from "@/lib/db";
import { handle } from "@/lib/errors";
import { requireMembership } from "@/lib/guards";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/** 這台機器的第一個非內部 IPv4（區網 IP）。用來把 localhost 邀請連結換成室友連得到的位址。 */
function lanIp(): string | null {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return null;
}

/** 邀請連結用的對外基底：
 *  1) APP_BASE_URL 環境變數最優先（部署/反代時指定）；
 *  2) 否則用請求來源；若來源是 localhost/127.0.0.1（自己在本機開），自動換成區網 IP，
 *     否則室友收到的連結會指向他們自己的電腦而打不開。 */
function inviteOrigin(req: NextRequest): string {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, "");
  const origin = req.nextUrl.origin;
  if (/\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) {
    const ip = lanIp();
    if (ip) return origin.replace(/(localhost|127\.0\.0\.1)/, ip);
  }
  return origin;
}

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

  const url = new URL(`/join/${code}`, inviteOrigin(req)).toString();
  return NextResponse.json({ code, url, expires_at: expiresAt.toISOString() }, { status: 201 });
});
