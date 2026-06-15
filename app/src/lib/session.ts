import { cookies } from "next/headers";
import { randomBytes } from "crypto";
import { eq } from "drizzle-orm";
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
