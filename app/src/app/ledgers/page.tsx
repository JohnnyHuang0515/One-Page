"use client";

// P-2 帳本列表（帳本索引）— Editorial Ledger 帳簿風
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, CaretRight, LockSimple, Plus, SignOut } from "@phosphor-icons/react";
import { api, ApiClientError, fmtMoney, turnTo } from "@/lib/client";
import { useToast } from "@/components/toast";
import { Breadcrumb } from "@/components/breadcrumb";
import { Avatar } from "@/components/avatar";
import { ProfileModal } from "@/components/profile-modal";
import { Dialog } from "@/components/dialog";
import { useEscapeKey } from "@/lib/use-escape";

type LedgerCard = {
  id: string;
  name: string;
  member_count: number;
  month_total: number;
  current_period: { year_month: string; status: "OPEN" | "SETTLED" };
};

export default function LedgersPage() {
  const [me, setMe] = useState<{ id: string; display_name: string; email: string } | null>(null);
  const [ledgers, setLedgers] = useState<LedgerCard[] | null>(null);
  const [listErr, setListErr] = useState(false); // 載入失敗（非 401）→ 顯示重試，不卡無限骨架
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const [newName, setNewName] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      const [meRes, ledgersRes] = await Promise.all([
        api<{ id: string; display_name: string; email: string }>("/api/me"),
        api<LedgerCard[]>("/api/ledgers"),
      ]);
      setMe(meRes);
      setLedgers(ledgersRes);
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push("/login");
        return;
      }
      setListErr(true);
    }
  }, [router]);

  useEscapeKey(() => setCreating(false), creating);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void load();
    });
    return () => {
      active = false;
    };
  }, [load]);

  // 即時推播（D-0010）：對列表裡每本帳本各開一條 SSE，任何成員寫資料就靜默重抓列表
  // （花費→當月花費、月結→狀態、加入→人數、改名/刪除即時反映）。
  // 連線只跟「帳本 id 集合」走（用排序字串當 key）：資料刷新不重連，集合變動才重連。
  const reloadRef = useRef(load);
  useEffect(() => {
    reloadRef.current = load;
  }, [load]);
  const ledgerIds = (ledgers ?? []).map((l) => l.id).sort().join(",");
  useEffect(() => {
    if (!ledgerIds) return;
    // 每本帳本一條 SSE；伺服器關閉/4xx 時 EventSource 會永久關閉，故自己延遲重建並補抓。
    const cleanups = ledgerIds.split(",").map((lid) => {
      let es: EventSource | null = null;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let closed = false;
      let everConnected = false;
      function connect() {
        es = new EventSource(`/api/ledgers/${lid}/stream`);
        es.onmessage = (e) => {
          let ev: { type?: string } | null = null;
          try {
            ev = JSON.parse(e.data);
          } catch {
            return;
          }
          if (!ev) return;
          if (ev.type === "connected") {
            if (everConnected) reloadRef.current(); // 重連後補抓斷線期間漏掉的更新
            everConnected = true;
            return;
          }
          reloadRef.current();
        };
        es.onerror = () => {
          if (es && es.readyState === EventSource.CLOSED) {
            es.close();
            es = null;
            if (!closed) retry = setTimeout(connect, 3000);
          }
        };
      }
      connect();
      return () => {
        closed = true;
        if (retry) clearTimeout(retry);
        es?.close();
      };
    });
    // 輪詢備援：SSE 穿不過 Cloudflare 通道（會被緩衝），故每 8 秒靜默重抓一次列表
    // （分頁不可見時跳過）。SSE 能用時這只是便宜的保險。
    const poll = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") reloadRef.current();
    }, 8000);
    return () => {
      clearInterval(poll);
      cleanups.forEach((fn) => fn());
    };
  }, [ledgerIds]);

  async function createLedger(e: React.FormEvent) {
    e.preventDefault();
    setCreatingBusy(true);
    try {
      const ledger = await api<{ id: string }>("/api/ledgers", { method: "POST", body: { name: newName } });
      turnTo("forward");
      router.push(`/ledgers/${ledger.id}`, { transitionTypes: ["nav-forward"] });
    } catch (err) {
      toast("error", err instanceof ApiClientError ? err.message : "發生錯誤");
      setCreatingBusy(false);
    }
  }

  function openCreate() {
    setNewName("");
    setCreatingBusy(false);
    setCreating(true);
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    turnTo("back");
    router.push("/login", { transitionTypes: ["nav-back"] });
  }

  return (
    <div className="min-h-[100dvh] bg-paper">
      <div className="mx-auto max-w-[1200px] px-5 pb-12 sm:px-6 md:px-14">
        {/* 頂部列 */}
        <header className="flex h-[54px] items-center justify-between gap-4 border-b border-rule sm:h-16 sm:border-b-0">
          <Breadcrumb items={[{ label: "首頁", href: "/" }, { label: "帳本索引" }]} />
          <div className="flex shrink-0 items-center gap-3 text-sm">
            {me && (
              <button
                onClick={() => setShowProfile(true)}
                aria-label="個人資料"
                className="rounded-full transition hover:opacity-80 active:scale-95"
              >
                <Avatar id={me.id} name={me.display_name} size={30} />
              </button>
            )}
            <button onClick={logout} className="flex items-center gap-1 text-text-3 transition hover:text-ink" aria-label="登出">
              <SignOut size={16} />
            </button>
          </div>
        </header>

        {/* 標題列 */}
        <div className="mt-8 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs tracking-wide text-text-3">我的帳本</p>
            <h1 className="mt-1 text-[28px] font-bold leading-tight sm:text-3xl">帳本索引</h1>
          </div>
          <button
            onClick={openCreate}
            className="flex w-full items-center justify-center gap-1.5 rounded-[3px] bg-ink px-4 py-3 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] sm:w-auto sm:py-2.5"
          >
            <Plus size={16} weight="bold" /> 建立新帳本
          </button>
        </div>

        {/* 表頭 */}
        <div className="mt-7 hidden items-center gap-4 px-1 pb-2.5 text-[11px] tracking-wide text-text-3 sm:flex">
          <span className="flex-1">帳本</span>
          <span className="hidden w-36 sm:block">成員</span>
          <span className="hidden w-24 sm:block">狀態</span>
          <span className="w-28 text-right">當月花費</span>
          <span className="w-4" />
        </div>
        <div className="mt-8 h-px bg-rule-strong sm:mt-0" />

        {ledgers === null ? (
          listErr ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-text-2">帳本載入失敗，請檢查連線</p>
              <button
                onClick={() => { setListErr(false); load(); }}
                className="rounded-[3px] border border-rule-strong px-3.5 py-2 text-sm text-text-strong transition hover:bg-ink/[0.03]"
              >
                重試
              </button>
            </div>
          ) : (
            <div className="flex flex-col">
              {[0, 1].map((i) => (
                <div key={i} className="h-[72px] animate-pulse border-b border-rule bg-rule/30" />
              ))}
            </div>
          )
        ) : ledgers.length === 0 ? (
          // #6 首次引導：還沒有任何帳本
          <div className="flex flex-col items-center gap-4 py-20 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[3px] border border-rule-strong text-text-3">
              <BookOpen size={28} />
            </span>
            <div className="flex flex-col gap-1.5">
              <p className="text-lg font-bold">還沒有任何帳本</p>
              <p className="max-w-xs text-sm leading-relaxed text-text-3">
                建立第一本共同帳本，邀請室友，一起記帳、月底一鍵結清。
              </p>
            </div>
            <button
              onClick={openCreate}
              className="mt-1 flex items-center gap-1.5 rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98]"
            >
              <Plus size={16} weight="bold" /> 建立新帳本
            </button>
          </div>
        ) : (
          <div className="flex flex-col">
            {ledgers.map((l) => (
              <button
                key={l.id}
                onClick={() => { turnTo("forward"); router.push(`/ledgers/${l.id}`, { transitionTypes: ["nav-forward"] }); }}
                className="flex items-center gap-3 border-b border-rule py-5 text-left transition hover:bg-ink/[0.02] sm:gap-4 sm:px-1 sm:py-4"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] border border-rule-strong text-text-2">
                    <BookOpen size={17} />
                  </span>
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-bold">{l.name}</span>
                    <span className="flex items-center gap-2 text-xs text-text-3 sm:hidden">
                      <span>{l.member_count} 位成員</span>
                      <span aria-hidden>・</span>
                      {l.current_period.status === "OPEN" ? (
                        <span className="flex items-center gap-1 text-pos">
                          <span className="h-1.5 w-1.5 rounded-full bg-pos" /> 記帳中
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <LockSimple size={11} /> 已結算
                        </span>
                      )}
                    </span>
                  </span>
                </span>
                <span className="hidden w-36 text-sm text-text-2 sm:block">{l.member_count} 位成員</span>
                <span className="hidden w-24 sm:block">
                  {l.current_period.status === "OPEN" ? (
                    <span className="flex items-center gap-1.5 text-xs text-pos">
                      <span className="h-1.5 w-1.5 rounded-full bg-pos" /> 記帳中
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-text-3">
                      <LockSimple size={12} /> 已結算
                    </span>
                  )}
                </span>
                <span className="w-[104px] shrink-0 text-right text-lg font-bold tabular-nums sm:w-28">{fmtMoney(l.month_total)}</span>
                <CaretRight size={16} className="shrink-0 text-text-3" />
              </button>
            ))}

            {/* 建立新帳本：末列入口，開啟 modal */}
            <button
              onClick={openCreate}
              className="flex items-center gap-3 border border-rule bg-surface/35 px-3 py-4 text-left transition hover:bg-ink/[0.02] sm:border-0 sm:bg-transparent sm:px-1"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-[3px] border border-dashed border-rule-strong text-text-3">
                <Plus size={17} />
              </span>
              <span className="flex flex-col">
                <span className="font-medium">建立新帳本</span>
                <span className="text-xs text-text-3">開一本新的共同帳本，邀請室友加入</span>
              </span>
            </button>
          </div>
        )}
      </div>

      {/* 建立新帳本 modal（對齊 P-6） */}
      {creating && (
        <Dialog title="建立新帳本" onClose={() => setCreating(false)} maxWidth="max-w-md">
          <p className="text-sm leading-relaxed text-text-2">開一本新的共同帳本，邀請室友加入。</p>
          <form onSubmit={createLedger} className="mt-5 flex flex-col gap-4">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-text-2">帳本名稱</span>
              <input
                autoFocus
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="例：大安路3樓"
                className="rounded-[3px] border border-rule-strong px-3 py-2 outline-none focus:border-ink"
              />
            </label>
            <div className="flex items-center gap-3">
              <button
                disabled={creatingBusy}
                className="flex-1 rounded-[3px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-50"
              >
                {creatingBusy ? "建立中…" : "建立"}
              </button>
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="px-3 py-2.5 text-sm text-text-2 underline-offset-4 hover:underline"
              >
                取消
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {showProfile && me && (
        <ProfileModal
          user={{ id: me.id, display_name: me.display_name, email: me.email }}
          onClose={() => setShowProfile(false)}
          onUpdated={() => load()}
        />
      )}
    </div>
  );
}
