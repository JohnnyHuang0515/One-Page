import { NextResponse } from "next/server";
import { handle } from "@/lib/errors";
import { destroySession } from "@/lib/session";

// FR-1 / SF-1: logout
export const POST = handle(async () => {
  await destroySession();
  return new NextResponse(null, { status: 204 });
});
