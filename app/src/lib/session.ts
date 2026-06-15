import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { and, eq, ne } from "drizzle-orm";
import { db, schema } from "./db";
import { ApiError } from "./errors";

const COOKIE = "session";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (POC)

// D-0004: httpOnly + SameSite session cookie
export async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  db.insert(schema.sessions)
    .values({ token, userId, expiresAt: new Date(Date.now() + TTL_MS) })
    .run();
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) db.delete(schema.sessions).where(eq(schema.sessions.token, token)).run();
  store.delete(COOKIE);
}

/**
 * 登出此使用者「其他裝置」的 session（保留目前這台）。
 * 改密碼時呼叫：把其餘已建立的 session 都作廢，自己這台不受影響。
 */
export async function destroyOtherSessions(userId: string): Promise<void> {
  const currentToken = (await cookies()).get(COOKIE)?.value;
  db.delete(schema.sessions)
    .where(
      currentToken
        ? and(eq(schema.sessions.userId, userId), ne(schema.sessions.token, currentToken))
        : eq(schema.sessions.userId, userId)
    )
    .run();
}

export async function getCurrentUser() {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const session = db.select().from(schema.sessions).where(eq(schema.sessions.token, token)).get();
  if (!session || session.expiresAt.getTime() < Date.now()) return null;
  return db.select().from(schema.users).where(eq(schema.users.id, session.userId)).get() ?? null;
}

/** 401 UNAUTHORIZED unless logged in */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new ApiError("UNAUTHORIZED", "請先登入");
  return user;
}
