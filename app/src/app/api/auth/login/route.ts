import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { createSession } from "@/lib/session";

// FR-1 / SF-1: login — D-0004 session cookie
export const POST = handle(async (req: NextRequest) => {
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body?.password === "string" ? body.password : "";

  const user = db.select().from(schema.users).where(eq(schema.users.email, email)).get();
  // EF-2: do not reveal which side is wrong
  if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
    throw new ApiError("INVALID_CREDENTIALS", "Email 或密碼錯誤");
  }
  await createSession(user.id);
  return NextResponse.json({ id: user.id, display_name: user.displayName });
});
