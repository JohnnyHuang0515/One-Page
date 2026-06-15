import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { ApiError, handle } from "@/lib/errors";
import { requireUser } from "@/lib/session";

// FR-1: current user
export const GET = handle(async () => {
  const user = await requireUser();
  return NextResponse.json({ id: user.id, email: user.email, display_name: user.displayName });
});

// FR-1: update own profile (display name)
export const PATCH = handle(async (req: NextRequest) => {
  const user = await requireUser();

  const body = await req.json().catch(() => null);
  const displayName = typeof body?.display_name === "string" ? body.display_name.trim() : "";
  if (!displayName) throw new ApiError("INVALID_REQUEST", "請填顯示名稱");
  if (displayName.length > 40) throw new ApiError("INVALID_REQUEST", "顯示名稱請在 40 字以內");

  db.update(schema.users)
    .set({ displayName })
    .where(eq(schema.users.id, user.id))
    .run();

  return NextResponse.json({ id: user.id, display_name: displayName, email: user.email });
});
