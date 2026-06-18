import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireMembership, requireOwnership, assertLedgerSettled } from "@/lib/guards";
import { publish } from "@/lib/realtime";
import { localYm } from "@/lib/date";

// FR-7,8 / SF-6: ledger detail (members + current period summary)
export const GET = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const { ledger, user } = await requireMembership(id);

  // 現役成員（D-0006：REMOVED 不列入可參與名單）
  const members = db
    .select({ membership: schema.memberships, user: schema.users })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.memberships.userId, schema.users.id))
    .where(and(eq(schema.memberships.ledgerId, id), eq(schema.memberships.status, "ACTIVE")))
    .all();

  const ym = localYm();
  const period = db
    .select()
    .from(schema.billingPeriods)
    .where(eq(schema.billingPeriods.ledgerId, id))
    .all()
    .find((p) => p.yearMonth === ym);

  return NextResponse.json({
    id: ledger.id,
    name: ledger.name,
    currency: ledger.currency,
    owner_user_id: ledger.createdBy, // D-0006: 前端用來判斷是否為擁有者
    is_owner: ledger.createdBy === user.id,
    members: members.map((m) => ({
      member_id: m.membership.id,
      user_id: m.user.id,
      display_name: m.user.displayName,
      is_owner: m.user.id === ledger.createdBy,
    })),
    current_period: { year_month: ym, status: period?.status ?? "OPEN" },
  });
});

// 改帳本名稱（擁有者）。非破壞性，但屬帳本層級設定，入口在管理面板 → 收歸擁有者。
export const PATCH = handle(async (req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwnership(id); // 非擁有者 → 403
  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) throw new ApiError("INVALID_REQUEST", "請填帳本名稱");
  db.update(schema.ledgers).set({ name }).where(eq(schema.ledgers.id, id)).run();
  publish(id, { type: "LEDGER_RENAMED", at: Date.now() }); // 索引/帳本頁即時更新（D-0010）
  return NextResponse.json({ id, name });
});

// FR-15 / D-0006: 擁有者軟刪除（封存）帳本。須全帳本已結清。
export const DELETE = handle(async (_req: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  await requireOwnership(id);
  assertLedgerSettled(id); // 未結清 → 409 NOT_SETTLED
  db.update(schema.ledgers).set({ status: "ARCHIVED", deletedAt: new Date() }).where(eq(schema.ledgers.id, id)).run();
  publish(id, { type: "LEDGER_DELETED", at: Date.now() }); // 其他成員的索引即時移除（D-0010）
  return NextResponse.json({ ok: true });
});
