import { NextRequest } from "next/server";
import { ApiError, errorResponse } from "@/lib/errors";
import { requireMembership } from "@/lib/guards";
import { subscribe } from "@/lib/realtime";

// #2 動態：SSE 即時推播端點。同一本帳本有人寫資料時，正在看的成員會即時收到事件去刷新。
//
// better-sqlite3 需要 Node runtime（非 Edge）；且這條走串流，不能套 handle()
// （handle 回 NextResponse.json，不適合 text/event-stream）。
export const runtime = "nodejs";
// 串流端點必須每次即時執行，不可被靜態化或快取。
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000; // 每 25 秒送一個註解行防連線被中介層 / 瀏覽器中斷

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  // 驗證放在開串流之前：未登入 / 非成員 / 帳本不存在都丟 ApiError，
  // 此時尚未送任何 body，可正常回對應的 HTTP 狀態碼。
  try {
    await requireMembership(id);
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e.code, e.message, e.details);
    console.error(e);
    return errorResponse("INTERNAL_ERROR", "系統發生未預期的錯誤，請稍後再試");
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          // controller 已關閉（client 已斷線）——觸發清理即可。
          cleanup();
        }
      };

      // 先送一筆 connected，讓 client 確認連線已建立。
      send(`data: ${JSON.stringify({ type: "connected" })}\n\n`);

      // 訂閱：每筆 publish 直接轉成一個 SSE message。
      const unsubscribe = subscribe(id, (payload) => {
        send(`data: ${JSON.stringify(payload)}\n\n`);
      });

      // 心跳：SSE 註解行（以「:」開頭），client 會忽略，純粹保活。
      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // 已關閉，忽略。
        }
      };

      // client 斷線（關分頁 / 離開頁面）→ AbortSignal 觸發 → 解除訂閱、停心跳、關串流。
      if (req.signal.aborted) cleanup();
      else req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 關閉反向代理（如 Nginx）對串流的緩衝，否則事件會被卡住不即時送達。
      "X-Accel-Buffering": "no",
    },
  });
}
