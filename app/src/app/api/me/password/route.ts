import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireUser } from "@/lib/session";

// FR-1: change own password
export const PATCH = handle(async (req: NextRequest) => {
  const user = await requireUser();

  const body = await req.json().catch(() => null);
  const currentPassword = typeof body?.current_password === "string" ? body.current_password : "";
  const newPassword = typeof body?.new_password === "string" ? body.new_password : "";

  if (!bcrypt.compareSync(currentPassword, user.passwordHash)) {
    throw new ApiError("INVALID_CREDENTIALS", "目前密碼不對");
  }
  if (newPassword.length < 8) throw new ApiError("INVALID_REQUEST", "密碼至少 8 碼");

  db.update(schema.users)
    .set({ passwordHash: bcrypt.hashSync(newPassword, 10) }) // NFR-3
    .where(eq(schema.users.id, user.id))
    .run();

  return NextResponse.json({ ok: true });
});
