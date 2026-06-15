import { NextResponse } from "next/server";
import { handle } from "@/lib/errors";
import { requireUser } from "@/lib/session";

// FR-1: current user
export const GET = handle(async () => {
  const user = await requireUser();
  return NextResponse.json({ id: user.id, email: user.email, display_name: user.displayName });
});
