"use client";

// C-7 ExpenseFormModal + C-8 SplitEditor（記帳 / 編輯花費）
import { useEffect, useMemo, useState } from "react";
import { X, Trash, Info, UsersThree, ArrowsClockwise, UserPlus } from "@phosphor-icons/react";
import { api, ApiClientError, fmtMoney } from "@/lib/client";
import { useToast } from "./toast";
import { useEscapeKey } from "@/lib/use-escape";

export type Member = { member_id: string; display_name: string };
export type ExpenseDraft = {
  id?: string; // 有 id = 編輯模式
  description: string;
  payer_id: string;
  amount: number;
  spent_at: string;
  split_method: "EQUAL" | "EXACT_AMOUNT";
  shares?: { member_id: string; share_amount: number }[];
};

export function ExpenseFormModal({
  ledgerId,
  members,
  draft,
  defaultDate,
  onClose,
  onSaved,
  onInvite,
}: {
  ledgerId: string;
  members: Member[];
  draft: ExpenseDraft | null; // null = 關閉
  defaultDate: string;
  onClose: () => void;
  onSaved: (savedId?: string) => void;
  onInvite?: () => void; // B：帳本只有你一人時，提示去邀請室友
}) {
  const toast = useToast();
  const editing = !!draft?.id;

  const [description, setDescription] = useState("");
  const [payerId, setPayerId] = useState("");
  const [amount, setAmount] = useState("");
  const [spentAt, setSpentAt] = useState(defaultDate);
  const [method, setMethod] = useState<"EQUAL" | "EXACT_AMOUNT">("EQUAL");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [exact, setExact] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false); // 站內刪除確認（取代原生 confirm）

  // 開啟時帶入 draft / 預設值
  useEffect(() => {
    if (!draft) return;
    setDescription(draft.description);
    setPayerId(draft.payer_id || members[0]?.member_id || "");
    setAmount(draft.amount ? String(draft.amount) : "");
    setSpentAt(draft.spent_at || defaultDate);
    setMethod(draft.split_method);
    const ids = draft.shares?.length
      ? draft.shares.map((s) => s.member_id)
      : members.map((m) => m.member_id); // 預設全員分攤
    setPicked(new Set(ids));
    setExact(Object.fromEntries((draft.shares ?? []).map((s) => [s.member_id, String(s.share_amount)])));
    setConfirmDelete(false);
  }, [draft, members, defaultDate]);

  const amountNum = parseInt(amount, 10) || 0;
  const exactSum = useMemo(
    () => [...picked].reduce((s, id) => s + (parseInt(exact[id] ?? "", 10) || 0), 0),
    [picked, exact]
  );
  const sumMismatch = method === "EXACT_AMOUNT" && amountNum > 0 && exactSum !== amountNum;

  // B：帳本只有你一人 → 沒有可分攤的對象，「怎麼分」整段換成提示。
  const soloLedger = members.length <= 1;
  // D：編輯時有現役成員尚未納入這筆分攤 → 顯示提示（兩種分法都顯示）；一鍵「全員平分」僅平均分攤時提供。
  const missing = members.filter((m) => !picked.has(m.member_id));
  const showResplitNotice = editing && !soloLedger && missing.length > 0;
  const perHead = members.length ? Math.floor(amountNum / members.length) : 0;
  const perHeadEven = members.length > 0 && amountNum % members.length === 0; // 除不盡 → 標「約」
  function resplitAll() {
    setMethod("EQUAL");
    setPicked(new Set(members.map((m) => m.member_id)));
  }

  // a11y：Esc 關閉
  useEscapeKey(onClose, !!draft);

  if (!draft) return null;

  function toggle(id: string) {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    // 只有你一人時，分攤一律收斂成你自己（避免編輯舊花費時帶著已離開成員的 picked 被後端 422）。
    const lone = members[0]?.member_id ?? payerId;
    const body = soloLedger
      ? {
          payer_id: lone,
          description,
          amount: amountNum,
          spent_at: spentAt,
          split_method: "EQUAL" as const,
          participants: [{ member_id: lone }],
        }
      : {
          payer_id: payerId,
          description,
          amount: amountNum,
          spent_at: spentAt,
          split_method: method,
          participants: [...picked].map((id) =>
            method === "EXACT_AMOUNT"
              ? { member_id: id, share_amount: parseInt(exact[id] ?? "", 10) || 0 }
              : { member_id: id }
          ),
        };
    try {
      let savedId = draft!.id;
      if (editing) {
        await api(`/api/expenses/${draft!.id}`, { method: "PATCH", body });
      } else {
        const created = await api<{ id?: string }>(`/api/ledgers/${ledgerId}/expenses`, { method: "POST", body });
        savedId = created?.id ?? savedId;
      }
      toast("success", editing ? "已更新" : "已記一筆");
      onSaved(savedId);
    } catch (err) {
      toast("error", err instanceof ApiClientError ? err.message : "發生錯誤");
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/expenses/${draft!.id}`, { method: "DELETE" });
      toast("success", "已刪除");
      onSaved();
    } catch (err) {
      toast("error", err instanceof ApiClientError ? err.message : "發生錯誤");
      setBusy(false);
      setConfirmDelete(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/30 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-rule bg-surface p-6 sm:rounded-[3px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">{editing ? "編輯花費" : "記一筆"}</h2>
          <button onClick={onClose} aria-label="關閉" className="rounded-[3px] p-1.5 text-text-3 transition hover:bg-ink/[0.04]">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={submit} className="mt-5 flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-2">品項</span>
            <input
              required
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="例：6月水費"
              className="rounded-[3px] border border-rule-strong px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-2">金額（元）</span>
              <input
                required
                type="number"
                min={1}
                step={1}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="900"
                className="rounded-[3px] border border-rule-strong px-3 py-2 tabular-nums outline-none focus:border-ink"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-text-2">日期</span>
              <input
                required
                type="date"
                value={spentAt}
                onChange={(e) => setSpentAt(e.target.value)}
                className="rounded-[3px] border border-rule-strong px-3 py-2 outline-none focus:border-ink"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="text-text-2">誰先付的</span>
            <select
              value={payerId}
              onChange={(e) => setPayerId(e.target.value)}
              className="rounded-[3px] border border-rule-strong bg-surface px-3 py-2 outline-none focus:border-ink"
            >
              {members.map((m) => (
                <option key={m.member_id} value={m.member_id}>
                  {m.display_name}
                </option>
              ))}
            </select>
          </label>

          {/* C-8 SplitEditor */}
          <div className="flex flex-col gap-2 text-sm">
            <span className="text-text-2">怎麼分</span>

            {soloLedger ? (
              /* B：只有你一人 → 沒有可分攤的對象 */
              <div className="flex flex-col gap-2.5 rounded-[3px] border border-rule bg-paper p-3.5">
                <span className="flex items-center gap-2">
                  <Info size={15} className="text-text-2" />
                  <span className="font-semibold">目前帳本只有你一人</span>
                </span>
                <span className="text-[12px] leading-relaxed text-text-2">
                  這筆會先記成你自己的花費，暫時不分攤給別人。邀請室友加入後，未鎖定的月份可以重新分攤。
                </span>
                {onInvite && (
                  <button
                    type="button"
                    onClick={onInvite}
                    className="flex items-center gap-1.5 text-[13px] font-semibold text-ink underline-offset-4 hover:underline"
                  >
                    <UserPlus size={13} /> 邀請室友
                  </button>
                )}
              </div>
            ) : (
              <>
            <div className="flex rounded-[3px] bg-paper p-1 border border-rule">
              {(
                [
                  ["EQUAL", "平均分攤"],
                  ["EXACT_AMOUNT", "指定金額"],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setMethod(v)}
                  className={`flex-1 rounded-[2px] py-1.5 transition ${
                    method === v ? "bg-surface font-medium shadow-sm" : "text-text-3"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {showResplitNotice && (
              /* D：有現役成員尚未納入這筆分攤。提示兩種分法都顯示；一鍵「全員平分」僅平均分攤時提供
                 （指定金額沒有單一正確的重分法，請手動勾選並填金額）。 */
              <div className="flex flex-col gap-2.5 rounded-[3px] border border-pos/30 bg-pos-bg p-3">
                <span className="flex items-start gap-2">
                  <UsersThree size={15} className="mt-0.5 shrink-0 text-pos" />
                  <span className="text-[12px] leading-relaxed text-text-2">
                    目前沒有分攤給 {missing.map((m) => m.display_name).join("、")}。
                    {method === "EQUAL" ? "要改成大家平均分攤嗎？" : "勾選成員並填金額即可一起分攤。"}
                  </span>
                </span>
                {method === "EQUAL" && (
                  <button
                    type="button"
                    onClick={resplitAll}
                    className="flex items-center justify-center gap-1.5 rounded-[3px] border border-pos/30 bg-surface py-2 text-[13px] font-semibold text-pos transition hover:bg-pos-bg active:scale-[0.98]"
                  >
                    <ArrowsClockwise size={13} /> 改成平均分攤{perHead > 0 ? `・${perHeadEven ? "每人" : "約每人"} ${fmtMoney(perHead)}` : ""}
                  </button>
                )}
              </div>
            )}

            <div className="flex flex-col gap-1.5 rounded-[3px] border border-rule p-3">
              {members.map((m) => (
                <div key={m.member_id} className="flex items-center justify-between gap-3">
                  <label className="flex flex-1 cursor-pointer items-center gap-2">
                    <input
                      type="checkbox"
                      checked={picked.has(m.member_id)}
                      onChange={() => toggle(m.member_id)}
                      className="h-4 w-4 accent-ink"
                    />
                    {m.display_name}
                    {m.member_id === payerId && <span className="text-xs text-text-3">（付款人）</span>}
                  </label>
                  {method === "EXACT_AMOUNT" && picked.has(m.member_id) && (
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={exact[m.member_id] ?? ""}
                      onChange={(e) => setExact({ ...exact, [m.member_id]: e.target.value })}
                      placeholder="0"
                      className="w-24 rounded-[3px] border border-rule-strong px-2 py-1 text-right tabular-nums outline-none focus:border-ink"
                    />
                  )}
                </div>
              ))}
              {method === "EQUAL" && (
                <p className="mt-1 text-xs text-text-3">除不盡的零頭由付款人少出，其餘的人多分 1 元</p>
              )}
              {method === "EXACT_AMOUNT" && (
                <p className={`mt-1 text-xs tabular-nums ${sumMismatch ? "text-neg" : "text-text-3"}`}>
                  目前加總 {fmtMoney(exactSum)} / 應為 {fmtMoney(amountNum)}
                  {sumMismatch && `（差 ${fmtMoney(amountNum - exactSum)}）`}
                </p>
              )}
            </div>
              </>
            )}
          </div>

          {confirmDelete ? (
            /* 站內刪除確認（取代原生 confirm，與其他破壞性動作的確認框一致） */
            <div className="mt-1 flex flex-col gap-2.5 rounded-[3px] border border-neg/30 bg-neg/5 p-3">
              <span className="text-[13px] text-text-2">確定刪除這筆花費？此動作無法復原。</span>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={remove}
                  disabled={busy}
                  className="flex-1 rounded-[3px] bg-neg py-2.5 text-sm font-medium text-white transition hover:bg-neg/90 active:scale-[0.98] disabled:opacity-50"
                >
                  {busy ? "刪除中…" : "確定刪除"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmDelete(false)}
                  disabled={busy}
                  className="px-3 py-2.5 text-sm text-text-2 underline-offset-4 hover:underline disabled:opacity-50"
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-3">
              <button
                disabled={busy || picked.size === 0 || sumMismatch}
                className="flex-1 rounded-[3px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-40"
              >
                {busy ? "處理中…" : editing ? "儲存" : "記一筆"}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-[3px] border border-rule-strong px-3 py-2.5 text-sm text-neg transition hover:bg-neg/5 active:scale-[0.98]"
                >
                  <Trash size={15} /> 刪除
                </button>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
