import { ApiError } from "./errors";

export type SplitInput = {
  amount: number; // integer TWD, > 0 (BR-2)
  payerId: string;
  splitMethod: "EQUAL" | "EXACT_AMOUNT";
  participants: { memberId: string; shareAmount?: number }[];
};

/**
 * Compute expense shares. Invariant BR-1: sum(shares) === amount.
 *
 * EQUAL (BR-3 / D-0003): payer pays LESS — payer gets floor(amount/n);
 * the remainder is distributed +1 per person to NON-payer participants
 * in input order. e.g. 100 / 3 (payer included) -> payer 33, others 33, 34.
 *
 * EXACT_AMOUNT: shares are caller-provided; must sum to amount (else EF-5).
 */
export function computeShares(input: SplitInput): { memberId: string; shareAmount: number }[] {
  const { amount, payerId, splitMethod, participants } = input;

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError("INVALID_AMOUNT", "金額必須為正整數（元）"); // EF-6
  }
  if (participants.length === 0) {
    throw new ApiError("INVALID_REQUEST", "至少需要一位分攤者");
  }
  const ids = participants.map((p) => p.memberId);
  if (new Set(ids).size !== ids.length) {
    throw new ApiError("INVALID_REQUEST", "分攤者重複");
  }

  if (splitMethod === "EXACT_AMOUNT") {
    const shares = participants.map((p) => {
      if (p.shareAmount == null || !Number.isInteger(p.shareAmount) || p.shareAmount < 0) {
        throw new ApiError("INVALID_REQUEST", "指定金額時，每位分攤者都要填金額（非負整數）");
      }
      return { memberId: p.memberId, shareAmount: p.shareAmount };
    });
    const sum = shares.reduce((s, x) => s + x.shareAmount, 0);
    if (sum !== amount) {
      throw new ApiError("SPLIT_SUM_MISMATCH", "分攤金額加總與花費金額不符", {
        expected: amount,
        actual: sum,
        diff: amount - sum,
      }); // EF-5 / BR-1
    }
    return shares;
  }

  // EQUAL
  const n = participants.length;
  const base = Math.floor(amount / n);
  let remainder = amount - base * n; // 0..n-1
  return participants.map((p) => {
    if (p.memberId === payerId) return { memberId: p.memberId, shareAmount: base }; // payer pays less
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { memberId: p.memberId, shareAmount: base + extra };
  });
}
