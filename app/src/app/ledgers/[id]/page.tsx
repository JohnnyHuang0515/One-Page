"use client";

// P-3 帳本主頁（核心）— Editorial Ledger 帳簿風（見 design/DESIGN-SPEC.md）
// 動效：切月方向滑動、淨額/合計滾動、花費列 stagger、記一筆成功淡綠 flash、
//       已付落章、月結四拍編排（淡出→列浮現→斜線封頁→已結清落章+紙面微震）。
// 全部過 useReducedMotion；動畫元件隔離在 components/anim/*。
import { startTransition, use, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CaretLeft, CaretRight, LockSimple, Check, Copy, ClockCounterClockwise, ArrowsLeftRight, SignOut } from "@phosphor-icons/react";
import { motion, AnimatePresence, useReducedMotion, useAnimationControls } from "motion/react";
import { api, ApiClientError, fmtMoney, currentYm, ymAdd, turnTo, copyText } from "@/lib/client";
import { localDate } from "@/lib/date";
import { useEscapeKey } from "@/lib/use-escape";
import { useToast } from "@/components/toast";
import { Avatar } from "@/components/avatar";
import { ExpenseFormModal, type ExpenseDraft, type Member } from "@/components/expense-form-modal";
import { RollingNumber } from "@/components/anim/rolling-number";
import { Stamp } from "@/components/anim/stamp";
import { CloseoutSlash } from "@/components/anim/closeout-slash";
import { ManageLedgerModal } from "@/components/manage-ledger-modal";
import { Breadcrumb } from "@/components/breadcrumb";
import { ActivityModal } from "@/components/activity-modal";
import { WhoOwesModal } from "@/components/who-owes-modal";
import { CarryOverModal } from "@/components/carry-over-modal";
import { ProfileModal } from "@/components/profile-modal";
import { Dialog } from "@/components/dialog";

type LedgerDetail = {
  id: string;
  name: string;
  owner_user_id: string;
  is_owner: boolean;
  members: { member_id: string; user_id: string; display_name: string; is_owner: boolean }[];
};
type PeriodView = {
  year_month: string;
  status: "OPEN" | "SETTLED";
  settled_at: string | null;
  balances: { member_id: string; display_name: string; net: number }[];
  expenses: {
    id: string;
    description: string;
    payer_id: string;
    payer_name: string;
    amount: number;
    spent_at: string;
    split_method: "EQUAL" | "EXACT_AMOUNT";
    shares: { member_id: string; share_amount: number }[];
  }[];
  settlements: {
    id: string;
    from_member_id: string;
    from_name: string;
    to_member_id: string;
    to_name: string;
    amount: number;
    status: "PENDING" | "PAID";
  }[];
};

const SIGN = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "");
const netClass = (n: number) => (n > 0 ? "text-pos" : n < 0 ? "text-neg" : "text-text-3");
const fmtNet = (n: number) => `${SIGN(n)}${fmtMoney(n)}`;
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export default function LedgerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const toast = useToast();
  const reduce = useReducedMotion();
  const shake = useAnimationControls();

  const [me, setMe] = useState<{ id: string; display_name: string; email: string } | null>(null);
  const [ledger, setLedger] = useState<LedgerDetail | null>(null);
  const [ym, setYm] = useState(currentYm());
  const [dir, setDir] = useState(1); // 切月方向：1=往後（next），-1=往前（prev）
  const [view, setView] = useState<PeriodView | null>(null);
  const [draft, setDraft] = useState<ExpenseDraft | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [confirmSettle, setConfirmSettle] = useState(false);
  const [settling, setSettling] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [showActivity, setShowActivity] = useState(false); // #2 動態
  const [showOverview, setShowOverview] = useState(false); // #4 目前誰欠誰
  const [showCarry, setShowCarry] = useState(false); // #1 從上月帶入
  const [showProfile, setShowProfile] = useState(false); // 個人資料
  const [unread, setUnread] = useState(0); // #2 動態未讀數
  const [justSettled, setJustSettled] = useState(false); // 剛在本頁按下月結 → 播放編排
  const [justPaidId, setJustPaidId] = useState<string | null>(null); // 剛標記已付的結清列
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set()); // 剛新增/編輯的花費列 → 淡綠 flash
  const [loadErr, setLoadErr] = useState<string | null>(null); // 帳本載入失敗（404/500/斷網）→ 出錯畫面
  const [periodErr, setPeriodErr] = useState(false); // 當月資料載入失敗 → 表格顯示重試

  // a11y：Esc 關閉本頁的浮層（記一筆/管理 modal 在各自元件內處理）
  useEscapeKey(() => setConfirmSettle(false), confirmSettle);
  useEscapeKey(() => setShowInvite(false), showInvite);

  const loadBase = useCallback(async () => {
    try {
      const [meRes, ledgerRes] = await Promise.all([
        api<{ id: string; display_name: string; email: string }>("/api/me"),
        api<LedgerDetail>(`/api/ledgers/${id}`),
      ]);
      setMe(meRes);
      setLedger(ledgerRes);
      // #2 動態未讀數（非關鍵，失敗不影響頁面）
      api<{ unread_count: number }>(`/api/ledgers/${id}/events`)
        .then((r) => setUnread(r.unread_count))
        .catch(() => {});
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        router.push("/login");
        return;
      }
      if (e instanceof ApiClientError && e.status === 403) {
        toast("error", "你不是這本帳本的成員");
        turnTo("back");
        router.push("/ledgers", { transitionTypes: ["nav-back"] });
        return;
      }
      // 404（已封存/壞 id）、500、斷網：不要卡在無限骨架，給出口
      setLoadErr(
        e instanceof ApiClientError && e.status === 404
          ? "找不到這本帳本，可能已被刪除或你已退出。"
          : "載入失敗，請檢查連線後重試。"
      );
    }
  }, [id, router, toast]);

  // goMonth 預載過的月份；用來讓 loadPeriod effect 跳過重複抓取（避免整頁翻頁後又閃骨架）
  const lastLoadedYm = useRef<string | null>(null);
  const reloadRef = useRef<() => void>(() => {}); // 給 SSE 用最新的 reloadPeriod（避免換月重連）
  const pendingReloadRef = useRef(false); // 有浮層開著時，SSE 來的刷新先記著、等關閉再補
  const overlayOpenRef = useRef(false);

  const fetchPeriod = useCallback(
    () => api<PeriodView>(`/api/ledgers/${id}/periods/${ym}`),
    [id, ym]
  );
  // 切月：清空再載入（翻頁會蓋過空窗）
  const loadPeriod = useCallback(async () => {
    setView(null);
    setPeriodErr(false);
    try {
      setView(await fetchPeriod());
      lastLoadedYm.current = ym;
    } catch {
      setPeriodErr(true); // 不要卡在無限骨架，表格內顯示重試
    }
  }, [fetchPeriod, ym]);
  // 同月內更新（新增/編輯/標記已付/月結）：不清空，讓數字滾動、列 flash、編排得以播放
  const reloadPeriod = useCallback(async () => {
    try {
      setView(await fetchPeriod());
    } catch {
      /* noop */
    }
  }, [fetchPeriod]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void loadBase();
    });
    return () => {
      active = false;
    };
  }, [loadBase]);
  useEffect(() => {
    if (lastLoadedYm.current === ym) return; // goMonth 已預載並用整頁 VT 切換，不重抓
    let active = true;
    queueMicrotask(() => {
      if (active) void loadPeriod();
    });
    return () => {
      active = false;
    };
  }, [ym, loadPeriod]);
  // 切月時重置一次性動畫旗標（章與斜線是既成事實，換月載入時靜態）
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setJustSettled(false);
      setJustPaidId(null);
    });
    return () => {
      active = false;
    };
  }, [ym]);
  // 即時推播（SSE）：其他成員一寫資料就靜默刷新本頁 + 更新未讀。
  // 用 reloadRef 拿最新 reloadPeriod；若使用者正開著任何 modal/確認框，先「記著待刷新」，
  // 等浮層關閉再補刷新——避免數字無故跳動、結清列在手下被換、月結確認框背景資料漂移。
  useEffect(() => {
    reloadRef.current = reloadPeriod;
  }, [reloadPeriod]);
  const anyOverlayOpen = !!(
    draft || showInvite || confirmSettle || showManage || showActivity || showOverview || showCarry || showProfile
  );
  useEffect(() => {
    overlayOpenRef.current = anyOverlayOpen;
    if (!anyOverlayOpen && pendingReloadRef.current) {
      pendingReloadRef.current = false;
      reloadRef.current();
    }
  }, [anyOverlayOpen]);
  useEffect(() => {
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let everConnected = false;
    // 未讀一律即時更新；花費資料若有浮層開著則延後刷新（關閉後補）。
    const refresh = () => {
      api<{ unread_count: number }>(`/api/ledgers/${id}/events`)
        .then((r) => setUnread(r.unread_count))
        .catch(() => {});
      if (overlayOpenRef.current) pendingReloadRef.current = true;
      else reloadRef.current();
    };
    function connect() {
      es = new EventSource(`/api/ledgers/${id}/stream`);
      es.onmessage = (e) => {
        let ev: { type?: string } | null = null;
        try {
          ev = JSON.parse(e.data);
        } catch {
          return;
        }
        if (!ev) return;
        if (ev.type === "connected") {
          if (everConnected) refresh(); // 重連後補抓斷線期間漏掉的更新
          everConnected = true;
          return;
        }
        refresh();
      };
      // CONNECTING：瀏覽器自動重連中，放著即可；CLOSED：伺服器關閉/4xx，自己延遲重建。
      es.onerror = () => {
        if (es && es.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          if (!closed) retry = setTimeout(connect, 3000);
        }
      };
    }
    connect();
    // 輪詢備援：SSE 穿不過某些反向代理 / Cloudflare 通道（text/event-stream 會被緩衝），
    // 故每 8 秒靜默補抓一次（分頁不可見時跳過，省資源）。SSE 能用時（LAN/直連）這只是便宜的保險。
    const poll = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") refresh();
    }, 8000);
    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      clearInterval(poll);
      es?.close();
    };
  }, [id]);

  const members: Member[] = ledger?.members ?? [];
  const myMembership = ledger?.members.find((m) => m.user_id === me?.id);
  const myBalance = view?.balances.find((b) => b.member_id === myMembership?.member_id);
  const isOpen = view?.status === "OPEN";
  const monthTotal = view?.expenses.reduce((s, e) => s + e.amount, 0) ?? 0;
  const canGoNext = ym < currentYm();
  const [yyyy, mm] = ym.split("-");

  // A（D-0007）：每筆花費顯示「分攤給誰・每人多少」。單人平分時依視角提示（你自己 / 某人一人），
  // 讓「平均分攤但其實只分到一人 → 不影響淨額」一眼可見（見 design/DESIGN-SPEC.md）。
  const nameByMember = new Map((view?.balances ?? []).map((b) => [b.member_id, b.display_name]));
  function splitSummary(e: PeriodView["expenses"][number]): { text: string; solo: boolean } {
    const nameOf = (mid: string) => nameByMember.get(mid) ?? "?";
    const parts = e.shares;
    if (parts.length === 0) return { text: "", solo: false };
    if (e.split_method === "EXACT_AMOUNT") {
      // 人多時不逐一列出（避免撐爆列高），改摘要為「指定金額・N 人」。
      const text =
        parts.length > 3
          ? `指定金額・${parts.length} 人`
          : `指定金額・${parts.map((s) => `${nameOf(s.member_id)} ${fmtMoney(s.share_amount)}`).join("、")}`;
      return { text, solo: false };
    }
    if (parts.length === 1) {
      const only = parts[0].member_id;
      const isMe = only === myMembership?.member_id;
      return { text: isMe ? "僅你自己・不影響其他人" : `僅 ${nameOf(only)} 一人・不影響其他人`, solo: true };
    }
    const names = parts.map((s) => nameOf(s.member_id)).join("、");
    // 除不盡時每人金額會差 1 元（零頭由付款人少出），標「約每人」以免與實際數字矛盾。
    const even = e.amount % parts.length === 0;
    return { text: `平分給 ${names}・${even ? "每人" : "約每人"} ${fmtMoney(Math.floor(e.amount / parts.length))}`, solo: false };
  }

  // 換月份：用整頁 View Transition（與路由換頁同一套 leaf-turn），整個畫面一起翻。
  // 關鍵：不手動開 VT（flushSync 會讓 React 的 <ViewTransition> 另開一個沒帶 type 的轉場蓋掉），
  // 改用 startTransition 讓 React 自己開 VT → 攔截器才會依 data-nav 注入方向 type。
  // 先預載新月資料，讓翻頁直接顯示完整新月。reduced-motion → 直接換月（effect 補抓）。
  async function goMonth(delta: number) {
    if (delta > 0 && !canGoNext) return;
    const newYm = ymAdd(ym, delta);
    if (reduce) {
      setDir(delta);
      setYm(newYm);
      return;
    }
    setDir(delta);
    turnTo(delta > 0 ? "forward" : "back"); // 方向 → 攔截器注入 vt type → CSS 決定左右翻向
    let nv: PeriodView | null = null;
    try {
      nv = await api<PeriodView>(`/api/ledgers/${id}/periods/${newYm}`);
      lastLoadedYm.current = newYm; // 預載成功才標記，失敗則讓 effect 補抓（退而求其次出骨架）
    } catch {
      /* 預載失敗：翻頁後由 effect 載入（會短暫出骨架） */
    }
    startTransition(() => {
      setYm(newYm);
      setView(nv);
    });
  }

  async function invite() {
    setShowInvite(true);
    if (inviteUrl) return;
    try {
      const res = await api<{ url: string }>(`/api/ledgers/${id}/invitations`, { method: "POST" });
      setInviteUrl(res.url);
    } catch {
      toast("error", "邀請連結產生失敗");
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    turnTo("back");
    router.push("/login", { transitionTypes: ["nav-back"] });
  }

  async function settle() {
    setSettling(true);
    try {
      await api(`/api/ledgers/${id}/periods/${ym}/settle`, { method: "POST" });
      setConfirmSettle(false);
      setJustSettled(true);
      await reloadPeriod();
      // 紙面微震：在已結清大章落下的時刻（編排尾段）
      if (!reduce) {
        shake.start({ x: [0, -1.5, 2, -1.5, 1, 0], transition: { duration: 0.32, delay: 0.78, ease: "easeOut" } });
      }
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "月結失敗");
    } finally {
      setSettling(false);
    }
  }

  async function togglePaid(txId: string, to: "PAID" | "PENDING") {
    if (to === "PAID") setJustPaidId(txId);
    try {
      await api(`/api/settlements/${txId}`, { method: "PATCH", body: { status: to } });
      reloadPeriod();
    } catch {
      toast("error", "更新失敗");
    }
  }

  function openCreate() {
    const today = localDate();
    setDraft({
      description: "",
      payer_id: myMembership?.member_id ?? "",
      amount: 0,
      spent_at: ym === currentYm() ? today : `${ym}-01`,
      split_method: "EQUAL",
    });
  }

  async function handleSaved(savedId?: string) {
    setDraft(null);
    await reloadPeriod();
    if (savedId) {
      setFlashIds(new Set([savedId]));
      window.setTimeout(() => setFlashIds(new Set()), 1200);
    }
  }

  // 正數＝你多付了、別人該還你（債主）；負數＝你少付了、該還別人。
  // 用主詞明確的說法，避免「被欠」讓正數的人誤讀成自己欠債。
  const netPhrase = !myBalance
    ? ""
    : myBalance.net > 0
      ? "別人欠你"
      : myBalance.net < 0
        ? "你欠別人"
        : "目前互不相欠";

  // 切月翻頁改由「整頁 View Transition」負責（見 goMonth），整個畫面一起翻。
  // 這裡的表格層 AnimatePresence 不再自己翻（否則會與整頁翻重複），設為無動畫；
  // 仍保留 key=ym 以重掛載、讓花費列 stagger 在翻頁快照背後播完。
  const monthVariants = {
    enter: { opacity: 1 },
    center: { opacity: 1 },
    exit: { opacity: 1, transition: { duration: 0 } },
  };
  const listVariants = {
    enter: {},
    center: { transition: { staggerChildren: reduce ? 0 : 0.03, delayChildren: reduce ? 0 : 0.04 } },
  };
  const rowVariants = {
    enter: { opacity: 0, y: reduce ? 0 : 8 },
    center: { opacity: 1, y: 0, transition: { duration: reduce ? 0 : 0.25, ease: EASE } },
  };

  // 帳本載入失敗（404/500/斷網）：不要卡無限骨架，給明確訊息與回索引出口。
  if (loadErr && !ledger) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center gap-5 bg-paper px-6 text-center">
        <div className="flex flex-col gap-2">
          <p className="text-lg font-bold text-ink">{loadErr}</p>
          <p className="text-sm text-text-3">{id.slice(0, 8)}…</p>
        </div>
        <button
          onClick={() => {
            turnTo("back");
            router.push("/ledgers", { transitionTypes: ["nav-back"] });
          }}
          className="rounded-[3px] bg-ink px-4 py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98]"
        >
          回帳本索引
        </button>
      </div>
    );
  }

  return (
    <motion.div animate={shake} className="flex min-h-[100dvh] flex-col bg-paper">
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col">
        {/* Masthead */}
        <div className="flex flex-col gap-3.5 px-5 pb-5 pt-4 sm:px-6 sm:pt-7 md:px-14">
          <div className="flex items-start justify-between gap-4">
            <Breadcrumb
              items={[
                { label: "首頁", href: "/" },
                { label: "帳本索引", href: "/ledgers" },
                { label: ledger?.name ?? "…" },
              ]}
            />
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-2 text-sm md:gap-x-5">
              {ledger && (
                <button
                  onClick={() => { setShowActivity(true); setUnread(0); }}
                  className="relative text-text-2 transition hover:text-ink"
                  aria-label={unread > 0 ? `動態（${unread} 筆未讀）` : "動態"}
                >
                  <ClockCounterClockwise size={20} />
                  {unread > 0 && (
                    <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ink px-1 text-[10px] font-bold text-white">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </button>
              )}
              <button onClick={invite} className="text-text-2 underline-offset-4 transition hover:text-ink hover:underline">
                邀請室友
              </button>
              {ledger && (
                <button
                  onClick={() => setShowManage(true)}
                  className="text-text-2 underline-offset-4 transition hover:text-ink hover:underline"
                >
                  管理
                </button>
              )}
              {myMembership && (
                <button
                  onClick={() => setShowProfile(true)}
                  aria-label="個人資料"
                  className="rounded-full transition hover:opacity-80 active:scale-95"
                >
                  <Avatar id={myMembership.user_id} name={myMembership.display_name} size={30} />
                </button>
              )}
              <button onClick={logout} aria-label="登出" className="text-text-2 transition hover:text-ink">
                <SignOut size={18} />
              </button>
            </div>
          </div>

          {/* MonthRow */}
          <div className="flex items-center gap-4">
            <button
              onClick={() => goMonth(-1)}
              className="text-text-3 transition hover:text-ink active:scale-90"
              aria-label="上個月"
            >
              <CaretLeft size={22} />
            </button>
            <div className="flex items-end gap-3.5 tabular-nums">
              <span className="text-3xl font-medium text-text-3">{yyyy}</span>
              <span className="text-3xl font-light text-text-3">/</span>
              <span className="text-3xl font-bold text-ink">{mm}</span>
            </div>
            {view &&
              (isOpen ? (
                <span className="flex items-center gap-1.5 pt-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-pos" />
                  <span className="text-xs font-semibold tracking-[0.1em] text-pos">記帳中</span>
                </span>
              ) : (
                <span className="flex items-center gap-1.5 pt-1.5 text-text-3">
                  <LockSimple size={13} />
                  <span className="text-xs font-semibold tracking-[0.1em]">已結算</span>
                </span>
              ))}
            <div className="flex-1" />
            <button
              onClick={() => canGoNext && goMonth(1)}
              disabled={!canGoNext}
              className="text-text-2 transition hover:text-ink active:scale-90 disabled:opacity-25"
              aria-label="下個月"
            >
              <CaretRight size={22} />
            </button>
          </div>
        </div>

        <div className="h-px bg-rule" />

        {/* Body */}
        <div className="grid flex-1 grid-cols-1 lg:grid-cols-[1fr_392px]">
          {/* LedgerCol */}
          <div className="flex flex-col gap-8 px-5 py-7 sm:px-6 sm:py-9 md:px-14">
            {/* NetBlock（持續存在，淨額滾動到位） */}
            <div className="flex flex-col gap-2">
              <p className="text-xs tracking-wide text-text-3">我的淨額 ・ {ym}</p>
              {myBalance ? (
                <div className="flex flex-wrap items-end gap-x-3.5 gap-y-1">
                  <RollingNumber
                    value={myBalance.net}
                    format={fmtNet}
                    className={`text-[40px] font-bold leading-none tracking-normal tabular-nums sm:text-[46px] ${netClass(myBalance.net)}`}
                  />
                  <span className="pb-2 text-sm font-medium text-text-2">{netPhrase}</span>
                </div>
              ) : (
                <div className="h-12 w-56 animate-pulse rounded bg-rule" />
              )}
              <p className="text-[13px] text-text-3">
                本月 {view?.expenses.length ?? 0} 筆花費，共 <span className="tabular-nums">{fmtMoney(monthTotal)}</span>
                {!isOpen && view && " ・ 帳目已鎖定"}
              </p>
            </div>

            {/* LedgerTable */}
            <div className="flex flex-col">
              <div className="flex items-end justify-between pb-2">
                <h2 className="font-bold">花費明細</h2>
                {isOpen && (
                  <button
                    onClick={openCreate}
                    className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98]"
                  >
                    ＋ 記一筆
                  </button>
                )}
              </div>

              <AnimatePresence mode="wait" custom={dir} initial={false}>
                <motion.div
                  key={ym}
                  custom={dir}
                  variants={monthVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  className="flex flex-col"
                >
                  {!view ? (
                    periodErr ? (
                      <div className="flex flex-col items-center gap-3 border-t border-rule py-16 text-center">
                        <p className="text-sm text-text-2">這個月的資料載入失敗</p>
                        <button
                          onClick={loadPeriod}
                          className="rounded-[3px] border border-rule-strong px-3.5 py-2 text-sm text-text-strong transition hover:bg-ink/[0.03]"
                        >
                          重試
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 pt-4">
                        {[0, 1, 2].map((i) => (
                          <div key={i} className="h-10 animate-pulse rounded bg-rule/60" />
                        ))}
                      </div>
                    )
                  ) : view.expenses.length === 0 ? (
                    isOpen && members.length === 1 ? (
                      // #6 首次引導：帳本只有你一人（還沒邀請、還沒記帳）→ 三步驟
                      <div className="border-t border-rule py-10">
                        <div className="mx-auto max-w-md rounded-[3px] border border-rule bg-paper p-5">
                          <p className="font-bold">開始使用 ・ 3 步驟</p>
                          <div className="mt-4 flex flex-col gap-3.5">
                            {[
                              { n: 1, title: "邀請室友", desc: "把連結傳給室友，一起記帳", on: invite, label: "邀請" },
                              { n: 2, title: "記第一筆", desc: "記下第一筆共同花費", on: openCreate, label: "記一筆" },
                              { n: 3, title: "月底結清", desc: "月底執行月結，自動算出最少筆數的結清建議", on: null, label: "" },
                            ].map((s) => (
                              <div key={s.n} className="flex items-center gap-3">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-[13px] font-bold text-white">
                                  {s.n}
                                </span>
                                <span className="flex flex-1 flex-col">
                                  <span className="text-sm font-medium">{s.title}</span>
                                  <span className="text-[12px] text-text-3">{s.desc}</span>
                                </span>
                                {s.on && (
                                  <button
                                    onClick={s.on}
                                    className="shrink-0 rounded-[3px] border border-rule-strong px-3 py-1.5 text-[13px] text-text-strong transition hover:bg-ink/[0.03]"
                                  >
                                    {s.label}
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="border-t border-rule py-16 text-center">
                        <p className="font-medium">這個月還沒有任何花費</p>
                        {isOpen && (
                          <>
                            <p className="mt-1 text-sm text-text-3">記下第一筆，或把上個月的固定花費帶進來</p>
                            <div className="mt-4 flex items-center justify-center gap-3">
                              <button
                                onClick={openCreate}
                                className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98]"
                              >
                                ＋ 記一筆
                              </button>
                              <button
                                onClick={() => setShowCarry(true)}
                                className="rounded-[3px] border border-rule-strong px-3.5 py-2 text-sm text-text-strong transition hover:bg-ink/[0.03] active:scale-[0.98]"
                              >
                                從上月帶入
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  ) : (
                    <>
                      {/* col header */}
                      <div className="flex items-center gap-3 px-0.5 pb-2.5 text-[11px] tracking-wide text-text-3 sm:gap-3.5">
                        <span className="w-[52px]">日期</span>
                        <span className="flex-1">品項</span>
                        <span className="w-[30px] sm:w-[128px]"><span className="hidden sm:inline">付款人</span></span>
                        <span className="w-20 text-right sm:w-[118px]">金額</span>
                      </div>
                      <div className="h-px bg-rule-strong" />

                      {/* 花費列（stagger + 新增 flash） */}
                      <motion.div variants={listVariants} initial="enter" animate="center" className="flex flex-col">
                        {view.expenses.map((e, i) => {
                          const flash = flashIds.has(e.id);
                          return (
                            <div key={e.id}>
                              <motion.button
                                variants={rowVariants}
                                onClick={() => isOpen && setDraft({ ...e })}
                                disabled={!isOpen}
                                className="relative flex w-full items-center gap-3 px-0.5 py-4 text-left transition enabled:hover:bg-ink/[0.02] disabled:cursor-default sm:gap-3.5"
                              >
                                <motion.span
                                  aria-hidden
                                  className="pointer-events-none absolute inset-y-0 inset-x-[-8px] rounded-[3px] bg-pos-bg"
                                  initial={false}
                                  animate={{ opacity: flash ? [0.9, 0] : 0 }}
                                  transition={{ duration: 1.1, ease: "easeOut" }}
                                />
                                <span className="w-[52px] text-sm tabular-nums text-text-3">
                                  {e.spent_at.slice(5).replace("-", "/")}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-1">
                                  <span className="flex min-w-0 items-center gap-2.5">
                                    <span className="truncate font-medium">{e.description}</span>
                                    <span className="shrink-0 rounded-[3px] border border-rule-strong px-2 py-0.5 text-[11px] text-text-2">
                                      {e.split_method === "EQUAL" ? "平均分攤" : "指定金額"}
                                    </span>
                                  </span>
                                  {(() => {
                                    const s = splitSummary(e);
                                    return s.text ? (
                                      <span className={`truncate text-[12px] ${s.solo ? "text-text-2" : "text-text-3"}`}>{s.text}</span>
                                    ) : null;
                                  })()}
                                </span>
                                <span className="flex w-[30px] shrink-0 items-center gap-2.5 sm:w-[128px]">
                                  <Avatar id={e.payer_id} name={e.payer_name} size={26} />
                                  <span className="hidden text-[13px] text-text-2 sm:inline">{e.payer_name}</span>
                                </span>
                                <span className="w-20 shrink-0 text-right font-semibold tabular-nums sm:w-[118px]">{fmtMoney(e.amount)}</span>
                              </motion.button>
                              {i < view.expenses.length - 1 && <div className="h-px bg-rule" />}
                            </div>
                          );
                        })}
                      </motion.div>

                      {/* 空白行格線（帳簿頁）+ 已結算斜線封頁 */}
                      <div className="relative">
                        {Array.from({ length: Math.max(2, 7 - view.expenses.length) }).map((_, i) => (
                          <div key={i} className="h-[52px] border-b border-rule" />
                        ))}
                        {!isOpen && <CloseoutSlash play={justSettled} delay={0.45} />}
                      </div>

                      {/* double-rule total */}
                      <div className="flex flex-col gap-[3px] pt-2.5">
                        <div className="h-px bg-ink" />
                        <div className="h-px bg-ink" />
                      </div>
                      <div className="flex items-center gap-3.5 px-0.5 pt-3.5">
                        <span className="w-[52px]" />
                        <span className="flex-1 text-[13px] font-semibold tracking-[0.2em]">合計</span>
                        <span className="w-[30px] sm:w-[128px]" />
                        <RollingNumber
                          value={monthTotal}
                          format={fmtMoney}
                          className="w-20 text-right text-lg font-bold tabular-nums text-ink sm:w-[118px]"
                        />
                      </div>
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* vertical hairline + SideCol */}
          <div className="border-t border-rule lg:border-l lg:border-t-0">
            <div className="flex min-h-full flex-col justify-between gap-10 px-5 py-7 sm:px-6 sm:py-9 md:px-10">
              {/* 成員淨額 */}
              <div>
                <div className="flex items-end justify-between">
                  <h2 className="font-bold">成員淨額 <span className="text-xs font-normal text-text-3">・ 本月</span></h2>
                  {ledger && (
                    <button
                      onClick={() => setShowOverview(true)}
                      className="flex items-center gap-1 text-[13px] text-text-2 underline-offset-4 transition hover:text-ink hover:underline"
                    >
                      <ArrowsLeftRight size={13} /> 跨月誰欠誰
                    </button>
                  )}
                </div>
                <ul className="mt-4 flex flex-col gap-3.5">
                  {(view?.balances ?? []).map((b) => {
                    const paid = view!.expenses.filter((e) => e.payer_id === b.member_id).reduce((s, e) => s + e.amount, 0);
                    return (
                      <li key={b.member_id} className="flex items-center justify-between">
                        <span className="flex items-center gap-2.5">
                          <Avatar id={b.member_id} name={b.display_name} size={28} />
                          <span className="flex flex-col">
                            <span className="text-sm">
                              {b.display_name}
                              {b.member_id === myMembership?.member_id && <span className="text-text-3">（你）</span>}
                            </span>
                            <span className="text-[11px] tabular-nums text-text-3">付了 {fmtMoney(paid)}</span>
                          </span>
                        </span>
                        <RollingNumber
                          value={b.net}
                          format={fmtNet}
                          className={`font-semibold tabular-nums ${netClass(b.net)}`}
                        />
                      </li>
                    );
                  })}
                </ul>
              </div>

              {/* 月結 / 結清建議 */}
              <div>
                {isOpen ? (
                  <>
                    <h2 className="flex items-center gap-1.5 font-bold">
                      <LockSimple size={15} /> 月結
                    </h2>
                    <p className="mt-2 text-[13px] leading-relaxed text-text-3">
                      月結後將鎖定 {ym} 的帳目，並產生最少筆數的結清建議。鎖定後不可修改，補登記到下個月。
                    </p>
                    <button
                      onClick={() => setConfirmSettle(true)}
                      disabled={!view}
                      className="mt-4 w-full rounded-[3px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-40"
                    >
                      執行月結
                    </button>
                  </>
                ) : view ? (
                  <motion.div
                    initial={justSettled && !reduce ? { opacity: 0 } : false}
                    animate={{ opacity: 1 }}
                    transition={{ duration: justSettled && !reduce ? 0.25 : 0 }}
                  >
                    <div>
                      <h2 className="font-bold">結清建議</h2>
                      <p className="text-[11px] text-text-3">最少筆數結清</p>
                    </div>
                    {view.settlements.length === 0 ? (
                      <p className="mt-3 text-sm text-text-3">這個月大家互不相欠，沒有要結清的款項。</p>
                    ) : (
                      <motion.ul
                        className="mt-4 flex flex-col"
                        variants={listVariants}
                        initial={justSettled ? "enter" : false}
                        animate="center"
                      >
                        {view.settlements.map((t, i) => (
                          <motion.li key={t.id} variants={justSettled ? rowVariants : undefined}>
                            <div className="flex items-center justify-between gap-2 py-3">
                              <button
                                onClick={() => togglePaid(t.id, t.status === "PAID" ? "PENDING" : "PAID")}
                                className="flex items-center gap-2.5 text-sm"
                                aria-label={t.status === "PAID" ? "取消已付" : "標記已付"}
                              >
                                <span
                                  className={`flex h-5 w-5 items-center justify-center rounded-full border transition ${
                                    t.status === "PAID"
                                      ? "border-pos bg-pos text-white"
                                      : "border-rule-strong text-transparent hover:border-text-3"
                                  }`}
                                >
                                  <Check size={12} weight="bold" />
                                </span>
                                <Avatar id={t.from_member_id} name={t.from_name} size={22} />
                                <span>{t.from_name}</span>
                                <span className="text-text-3">→</span>
                                <Avatar id={t.to_member_id} name={t.to_name} size={22} />
                                <span>{t.to_name}</span>
                              </button>
                              <span className="flex items-center gap-2">
                                {t.status === "PAID" && (
                                  <Stamp play={justPaidId === t.id} rotate={-6} className="stamp stamp-ink px-2 py-0.5 text-[10px] font-bold tracking-[0.15em]">
                                    已付
                                  </Stamp>
                                )}
                                <span
                                  className={`font-semibold tabular-nums ${t.status === "PAID" ? "text-text-3 line-through" : "text-ink"}`}
                                >
                                  {fmtMoney(t.amount)}
                                </span>
                              </span>
                            </div>
                            {i < view.settlements.length - 1 && <div className="h-px bg-rule" />}
                          </motion.li>
                        ))}
                      </motion.ul>
                    )}
                    {/* 已結清大章：標記月結鎖帳不可逆 */}
                    <div className="mt-6 flex flex-col items-end gap-2">
                      <Stamp
                        play={justSettled}
                        rotate={-5}
                        delay={0.75}
                        className="stamp stamp-ink px-4 py-2 text-center leading-none"
                      >
                        <span className="block text-xl font-bold tracking-[0.25em]">已結清</span>
                      </Stamp>
                      <p className="flex items-center gap-1.5 text-[11px] text-text-3">
                        <LockSimple size={12} />{" "}
                        {view.settled_at ? `於 ${view.settled_at.slice(0, 10)} 完成月結，本月帳目已鎖定` : "本月帳目已鎖定"}
                      </p>
                    </div>
                  </motion.div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* RWD：手機/平板（單欄）拇指熱區的記一筆浮動鈕（桌機雙欄用表頭按鈕即可） */}
      {isOpen && view && (
        <button
          onClick={openCreate}
          aria-label="記一筆"
          className="fixed bottom-5 right-5 z-30 flex items-center gap-1.5 rounded-[3px] bg-ink px-5 py-3 text-sm font-medium text-white shadow-[0_4px_16px_rgba(35,31,25,0.22)] transition active:scale-95 lg:hidden"
        >
          ＋ 記一筆
        </button>
      )}

      <ExpenseFormModal
        ledgerId={id}
        members={members}
        draft={draft}
        defaultDate={ym === currentYm() ? localDate() : `${ym}-01`}
        onClose={() => setDraft(null)}
        onSaved={handleSaved}
        onInvite={() => { setDraft(null); invite(); }}
      />

      {showManage && ledger && (
        <ManageLedgerModal
          ledgerId={id}
          ledgerName={ledger.name}
          members={ledger.members}
          isOwner={ledger.is_owner}
          myUserId={me?.id}
          netByMember={Object.fromEntries((view?.balances ?? []).map((b) => [b.member_id, b.net]))}
          onClose={() => setShowManage(false)}
          onMembersChanged={() => {
            loadBase();
            loadPeriod();
          }}
          onExit={() => {
            setShowManage(false);
            turnTo("back");
            router.push("/ledgers", { transitionTypes: ["nav-back"] });
          }}
        />
      )}

      {showActivity && <ActivityModal ledgerId={id} onClose={() => setShowActivity(false)} />}
      {showOverview && <WhoOwesModal ledgerId={id} onClose={() => setShowOverview(false)} />}
      {showProfile && me && (
        <ProfileModal
          user={{ id: me.id, display_name: me.display_name, email: me.email }}
          onClose={() => setShowProfile(false)}
          onUpdated={() => loadBase()}
        />
      )}
      {showCarry && (
        <CarryOverModal
          ledgerId={id}
          targetYm={ym}
          onClose={() => setShowCarry(false)}
          onDone={() => {
            setShowCarry(false);
            reloadPeriod();
          }}
        />
      )}

      {confirmSettle && (
        <Dialog title={`確定執行 ${ym} 月結？`} onClose={() => setConfirmSettle(false)}>
          <p className="text-sm leading-relaxed text-text-2">
            月結後本月帳目將永久鎖定、不可再修改，並產生結清建議。這個動作無法復原。
          </p>
          <div className="mt-5 flex gap-3">
            <button
              onClick={settle}
              disabled={settling}
              className="flex-1 rounded-[3px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-50"
            >
              {settling ? "月結中…" : "確定執行月結"}
            </button>
            <button onClick={() => setConfirmSettle(false)} className="px-3 py-2.5 text-sm text-text-2 underline-offset-4 hover:underline">
              取消
            </button>
          </div>
        </Dialog>
      )}

      {showInvite && (
        <Dialog title="邀請室友" onClose={() => setShowInvite(false)}>
          <p className="text-sm text-text-2">把連結傳給室友，對方註冊登入後即可加入這本帳本。</p>
          {!inviteUrl ? (
            <div className="mt-4 h-10 animate-pulse rounded-[3px] bg-rule" />
          ) : (
            <div className="mt-4 flex items-center gap-2">
              <input readOnly value={inviteUrl} className="flex-1 truncate rounded-[3px] border border-rule bg-paper px-3 py-2 text-xs" />
              <button
                onClick={async () => {
                  const ok = await copyText(inviteUrl);
                  toast(ok ? "success" : "error", ok ? "已複製連結" : "複製失敗，請手動選取連結");
                }}
                className="flex items-center gap-1 rounded-[3px] bg-ink px-3 py-2 text-sm text-white transition hover:bg-ink/85 active:scale-[0.98]"
              >
                <Copy size={14} /> 複製
              </button>
            </div>
          )}
        </Dialog>
      )}
    </motion.div>
  );
}
