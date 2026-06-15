import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { createSession } from "@/lib/session";

// FR-1 / SF-1: register
export const POST = handle(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError("INVALID_REQUEST", "Email 格式不正確");
  if (password.length < 8) throw new ApiError("INVALID_REQUEST", "密碼至少 8 碼");
  if (!displayName) throw new ApiError("INVALID_REQUEST", "請填顯示名稱");

  const existing = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  if (existing) throw new ApiError("EMAIL_ALREADY_EXISTS", "這個 Email 已註冊，請改用登入"); // EF-1 / BR-11

  const user = {
    id: randomUUID(),
    email,
    passwordHash: bcrypt.hashSync(password, 10), // NFR-3
    displayName,
    createdAt: new Date(),
  };
  db.insert(schema.users).values(user).run();
  await createSession(user.id);
  return NextResponse.json({ id: user.id, email: user.email, display_name: user.displayName }, { status: 201 });
});
