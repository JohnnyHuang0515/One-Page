import { NextResponse } from "next/server";
import { randomUUID } from "crypto";

// §6.5 Error Model — code catalog
export type ErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "INVALID_CREDENTIALS"
  | "FORBIDDEN"
  | "LEDGER_NOT_FOUND"
  | "EXPENSE_NOT_FOUND"
  | "PERIOD_NOT_FOUND"
  | "SETTLEMENT_NOT_FOUND"
  | "INVITATION_NOT_FOUND"
  | "EMAIL_ALREADY_EXISTS"
  | "PERIOD_LOCKED"
  | "PERIOD_ALREADY_SETTLED"
  | "NOT_SETTLED"
  | "OWNER_MUST_TRANSFER"
  | "MEMBER_NOT_FOUND"
  | "INVITATION_NOT_PENDING"
  | "INVITATION_EXPIRED"
  | "INVALID_AMOUNT"
  | "SPLIT_SUM_MISMATCH"
  | "INVALID_MEMBER"
  | "INTERNAL_ERROR";

const STATUS: Record<ErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  INVALID_CREDENTIALS: 401,
  FORBIDDEN: 403,
  LEDGER_NOT_FOUND: 404,
  EXPENSE_NOT_FOUND: 404,
  PERIOD_NOT_FOUND: 404,
  SETTLEMENT_NOT_FOUND: 404,
  INVITATION_NOT_FOUND: 404,
  EMAIL_ALREADY_EXISTS: 409,
  PERIOD_LOCKED: 409,
  PERIOD_ALREADY_SETTLED: 409,
  NOT_SETTLED: 409,
  OWNER_MUST_TRANSFER: 409,
  MEMBER_NOT_FOUND: 404,
  INVITATION_NOT_PENDING: 409,
  INVITATION_EXPIRED: 410,
  INVALID_AMOUNT: 422,
  SPLIT_SUM_MISMATCH: 422,
  INVALID_MEMBER: 422,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  constructor(
    public code: ErrorCode,
    message?: string,
    public details?: Record<string, unknown>
  ) {
    super(message ?? code);
  }
}

export function errorResponse(code: ErrorCode, message?: string, details?: Record<string, unknown>) {
  return NextResponse.json(
    { error: { code, message: message ?? code, details: details ?? {}, trace_id: randomUUID() } },
    { status: STATUS[code] }
  );
}

/** Wrap a route handler: ApiError -> spec error response, anything else -> 500 */
export function handle<Args extends unknown[]>(
  fn: (...args: Args) => Promise<NextResponse>
): (...args: Args) => Promise<NextResponse> {
  return async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      if (e instanceof ApiError) return errorResponse(e.code, e.message, e.details);
      console.error(e);
      return errorResponse("INTERNAL_ERROR", "系統發生未預期的錯誤，請稍後再試");
    }
  };
}
