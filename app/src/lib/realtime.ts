// #2 動態：程序內 pub/sub（給 SSE 即時推播用）。
// 注意：只在「單一 Node 程序」內有效——所有 SSE 連線與寫入都在同一個程序裡才收得到。
// 若日後要多實例 / 多機部署，需改用 Redis pub/sub 之類的外部通道（POC 區網單機用不到）。

type Listener = (payload: unknown) => void;

// 用 globalThis 存註冊表，沿用 db.ts 的做法：dev 熱重載時模組會被重新求值，
// 若用一般模組變數會被清空、導致既有連線漏訂閱。
declare global {
  var __realtimeListeners: Map<string, Set<Listener>> | undefined;
}

const listeners: Map<string, Set<Listener>> =
  globalThis.__realtimeListeners ?? (globalThis.__realtimeListeners = new Map());

/**
 * 訂閱某本帳本的即時事件。
 * @returns unsubscribe 函式——呼叫後即停止接收，並在無人訂閱時自動清掉該 ledger 的 Set。
 */
export function subscribe(ledgerId: string, fn: Listener): () => void {
  let set = listeners.get(ledgerId);
  if (!set) {
    set = new Set();
    listeners.set(ledgerId, set);
  }
  set.add(fn);
  return () => {
    const s = listeners.get(ledgerId);
    if (!s) return;
    s.delete(fn);
    if (s.size === 0) listeners.delete(ledgerId); // 沒人聽就回收，避免 Map 無限長大
  };
}

/**
 * 對某本帳本的所有訂閱者廣播一筆事件。
 * 單一 listener 拋錯不影響其他 listener，也不影響呼叫端（例如 recordEvent 主流程）。
 */
export function publish(ledgerId: string, payload: unknown): void {
  const set = listeners.get(ledgerId);
  if (!set) return;
  // 先複製一份再迭代：listener 內可能 unsubscribe（改動到原 Set）。
  for (const fn of [...set]) {
    try {
      fn(payload);
    } catch (err) {
      console.error("[realtime] listener 拋錯，已略過", err);
    }
  }
}
