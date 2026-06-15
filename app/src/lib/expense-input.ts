import { and, eq } from "drizzle-orm";
import { db, schema } from "./db";
import { ApiError } from "./errors";
import { isValidDate } from "./guards";
import { computeShares } from "./split";

export type ExpensePayload = {
  payerId: string;
  description: string;
  amount: number;
  spentAt: string;
  splitMethod: "EQUAL" | "EXACT_AMOUNT";
  participants: { memberId: string; shareAmount?: number }[];
  shares: { memberId: string; shareAmount: number }[];
};

/** Validate the request body for create/edit expense (SF-4 / SF-5). */
export function parseExpenseBody(body: unknown, ledgerId: string): ExpensePayload {
  const b = body as Record<string, unknown> | null;
  if (!b || typeof b !== "object") throw new ApiError("INVALID_REQUEST", "缺少請求內容");

  const payerId = typeof b.payer_id === "string" ? b.payer_id : "";
  const description = typeof b.description === "string" ? b.description.trim() : "";
  const amount = typeof b.amount === "number" ? b.amount : NaN;
  const spentAt = typeof b.spent_at === "string" ? b.spent_at : "";
  const splitMethod = b.split_method === "EXACT_AMOUNT" ? "EXACT_AMOUNT" : b.split_method === "EQUAL" ? "EQUAL" : null;
  const rawParticipants = Array.isArray(b.participants) ? b.participants : null;

  if (!description) throw new ApiError("INVALID_REQUEST", "請填品項");
  if (!isValidDate(spentAt)) throw new ApiError("INVALID_REQUEST", "日期格式不對（需為 YYYY-MM-DD）");
  if (!splitMethod) throw new ApiError("INVALID_REQUEST", "請選擇分攤方式（平均分攤或指定金額）");
  if (!rawParticipants || rawParticipants.length === 0) throw new ApiError("INVALID_REQUEST", "至少一位分攤者");
  if (!Number.isInteger(amount) || amount <= 0) throw new ApiError("INVALID_AMOUNT", "金額必須為正整數（元）"); // EF-6 / BR-2

  const participants = rawParticipants.map((p) => {
    const pp = p as Record<string, unknown>;
    return {
      memberId: typeof pp.member_id === "string" ? pp.member_id : "",
      shareAmount: typeof pp.share_amount === "number" ? pp.share_amount : undefined,
    };
  });

  // BR-7 / EF-8 / D-0006：付款人 + 分攤者必須是這個帳本的「現役」成員。
  // 只認 ACTIVE → 已移除(REMOVED)的人不能被加回花費（否則會復活餘額、甚至再生債務反卡移除）。
  // 後來才加入的成員是 ACTIVE，仍可被納入（D 重新分攤）。
  const memberIds = new Set(
    db
      .select()
      .from(schema.memberships)
      .where(and(eq(schema.memberships.ledgerId, ledgerId), eq(schema.memberships.status, "ACTIVE")))
      .all()
      .map((m) => m.id)
  );
  if (!memberIds.has(payerId)) throw new ApiError("INVALID_MEMBER", "付款人不是這個帳本的成員");
  for (const p of participants) {
    if (!memberIds.has(p.memberId)) throw new ApiError("INVALID_MEMBER", "分攤者包含非帳本成員");
  }

  const shares = computeShares({ amount, payerId, splitMethod, participants }); // BR-1 / BR-3 / EF-5
  return { payerId, description, amount, spentAt, splitMethod, participants, shares };
}
