"use client";

// 帳本管理 modal（D-0006）：P-7 成員管理 / P-9 轉移擁有權 / P-8 刪除帳本（軟刪除）。
// 擁有者才看得到移除/轉移/刪除；任何人都可「退出帳本」。結清前置由後端 409 NOT_SETTLED 把關，
// 前端用當月淨額做即時提示（變灰 +「需先結清」）。
import { useRef, useState } from "react";
import { X, CaretLeft, CaretRight } from "@phosphor-icons/react";
import { api, ApiClientError } from "@/lib/client";
import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
import { useEscapeKey } from "@/lib/use-escape";
import { useDialog } from "@/lib/use-dialog";

export type ManageMember = { member_id: string; user_id: string; display_name: string; is_owner: boolean };

export function ManageLedgerModal({
  ledgerId,
  ledgerName,
  members,
  isOwner,
  myUserId,
  netByMember,
  onClose,
  onMembersChanged,
  onExit,
}: {
  ledgerId: string;
  ledgerName: string;
  members: ManageMember[];
  isOwner: boolean;
  myUserId: string | undefined;
  netByMember: Record<string, number>;
  onClose: () => void;
  onMembersChanged: () => void; // 成員/擁有者變動 → 重新載入
  onExit: () => void; // 自己退出 / 刪帳本 → 離開到帳本索引
}) {
  const toast = useToast();
  const [pane, setPane] = useState<"main" | "transfer" | "delete">("main");
  const [pick, setPick] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const [name, setName] = useState(ledgerName); // 改帳本名稱（擁有者）

  const others = members.filter((m) => m.user_id !== myUserId);
  const settled = (m: ManageMember) => (netByMember[m.member_id] ?? 0) === 0;
  const nameChanged = name.trim().length > 0 && name.trim() !== ledgerName;

  async function rename() {
    if (busy || !nameChanged) return;
    setBusy(true);
    try {
      await api(`/api/ledgers/${ledgerId}`, { method: "PATCH", body: { name: name.trim() } });
      toast("success", "已更新帳本名稱");
      onMembersChanged();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "更新失敗");
    } finally {
      setBusy(false);
    }
  }

  // a11y：Esc 在子面板先退回主面板，主面板則關閉整個 modal。
  useEscapeKey(() => (pane === "main" ? onClose() : setPane("main")));
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef);

  async function removeMember(m: ManageMember) {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/ledgers/${ledgerId}/members/${m.member_id}`, { method: "DELETE" });
      toast("success", `已移除 ${m.display_name}`);
      onMembersChanged();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "移除失敗");
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (busy) return;
    setBusy(true);
    try {
      await api(`/api/ledgers/${ledgerId}/leave`, { method: "POST" });
      toast("success", "已退出帳本");
      onExit();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "退出失敗");
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    if (busy || !pick) return;
    setBusy(true);
    try {
      await api(`/api/ledgers/${ledgerId}/transfer-ownership`, { method: "POST", body: { member_id: pick } });
      const name = members.find((m) => m.member_id === pick)?.display_name ?? "";
      toast("success", `已把擁有權轉移給 ${name}`);
      setPane("main");
      onMembersChanged();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "轉移失敗");
    } finally {
      setBusy(false);
    }
  }

  async function del() {
    if (busy) return;
    setBusy(true);
    setDeleteErr(null);
    try {
      await api(`/api/ledgers/${ledgerId}`, { method: "DELETE" });
      toast("success", "已刪除帳本");
      onExit();
    } catch (e) {
      const msg = e instanceof ApiClientError ? e.message : "刪除失敗";
      if (e instanceof ApiClientError && e.code === "NOT_SETTLED") setDeleteErr(msg);
      else toast("error", msg);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-title"
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-rule bg-surface sm:rounded-[3px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 主面板：成員 + 轉移 + 危險區 ── */}
        {pane === "main" && (
          <>
            <div className="flex items-center justify-between px-6 pb-4 pt-[22px]">
              <h2 id="manage-title" className="text-lg font-bold">帳本管理</h2>
              <button onClick={onClose} aria-label="關閉" className="rounded-[3px] p-1.5 text-text-3 transition hover:bg-ink/[0.04]">
                <X size={18} />
              </button>
            </div>

            {isOwner && (
              <div className="flex flex-col gap-2 px-6 pb-2">
                <p className="text-[11px] font-semibold tracking-[0.15em] text-text-3">帳本名稱</p>
                <div className="flex items-center gap-2">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={40}
                    className="flex-1 rounded-[3px] border border-rule-strong px-3 py-2 text-sm outline-none focus:border-ink"
                  />
                  <button
                    onClick={rename}
                    disabled={busy || !nameChanged}
                    className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-30"
                  >
                    儲存
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-0.5 px-6 py-2">
              <p className="text-[11px] font-semibold tracking-[0.15em] text-text-3">成員</p>
              {members.map((m, i) => (
                <div key={m.member_id}>
                  <div className="flex items-center justify-between py-3">
                    <span className="flex items-center gap-2.5">
                      <Avatar id={m.member_id} name={m.display_name} size={30} />
                      <span className="flex flex-col">
                        <span className="text-sm">{m.display_name}</span>
                        {m.is_owner ? null : !settled(m) ? (
                          <span className="text-[11px] text-neg">尚有欠款</span>
                        ) : (
                          <span className="text-[11px] text-text-3">目前無欠款</span>
                        )}
                      </span>
                    </span>
                    {m.is_owner ? (
                      <span className="rounded-[3px] bg-chip px-2.5 py-1 text-[11px] font-semibold text-text-strong">
                        擁有者{m.user_id === myUserId ? "（你）" : ""}
                      </span>
                    ) : isOwner ? (
                      settled(m) ? (
                        <button
                          onClick={() => removeMember(m)}
                          disabled={busy}
                          className="px-1 text-[13px] text-neg underline-offset-4 hover:underline disabled:opacity-50"
                        >
                          移除
                        </button>
                      ) : (
                        <span className="flex flex-col items-end">
                          <span className="text-[13px] text-text-3">移除</span>
                          <span className="text-[10px] text-text-3">需先結清</span>
                        </span>
                      )
                    ) : null}
                  </div>
                  {i < members.length - 1 && <div className="h-px bg-rule" />}
                </div>
              ))}
            </div>

            {isOwner && others.length > 0 && (
              <>
                <div className="h-px bg-rule" />
                <button
                  onClick={() => {
                    setPick(others[0]?.member_id ?? "");
                    setPane("transfer");
                  }}
                  className="flex w-full items-center justify-between px-6 py-4 text-left transition hover:bg-ink/[0.02]"
                >
                  <span className="flex flex-col">
                    <span className="text-sm">轉移擁有權</span>
                    <span className="text-[11px] text-text-3">把擁有者讓給另一位成員</span>
                  </span>
                  <CaretRight size={16} className="text-text-3" />
                </button>
              </>
            )}

            <div className="h-px bg-rule" />
            <div className="flex flex-col gap-3.5 px-6 pb-[22px] pt-4">
              <p className="text-[11px] font-semibold tracking-[0.15em] text-text-3">危險操作</p>
              <div className="flex items-center justify-between">
                <span className="flex flex-col">
                  <span className="text-sm font-medium">退出帳本</span>
                  <span className="text-[11px] text-text-3">你自己離開（需先結清）</span>
                </span>
                <button
                  onClick={leave}
                  disabled={busy}
                  className="rounded-[3px] border border-rule-strong px-3.5 py-1.5 text-[13px] font-medium text-text-strong transition hover:bg-ink/[0.03] disabled:opacity-50"
                >
                  退出帳本
                </button>
              </div>
              {isOwner && (
                <div className="flex items-center justify-between">
                  <span className="flex flex-col">
                    <span className="text-sm font-medium text-neg">刪除帳本</span>
                    <span className="text-[11px] text-text-3">從索引移除，資料保留可救回</span>
                  </span>
                  <button
                    onClick={() => {
                      setDeleteErr(null);
                      setPane("delete");
                    }}
                    className="rounded-[3px] border border-neg px-3.5 py-1.5 text-[13px] font-medium text-neg transition hover:bg-neg/5"
                  >
                    刪除帳本
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* ── 轉移擁有權 ── */}
        {pane === "transfer" && (
          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center gap-2">
              <button onClick={() => setPane("main")} className="text-text-3 transition hover:text-ink">
                <CaretLeft size={18} />
              </button>
              <h2 className="text-lg font-bold">轉移擁有權</h2>
            </div>
            <p className="text-sm leading-relaxed text-text-2">
              選擇要接手的成員。轉移後你會變成一般成員，對方成為新的擁有者。
            </p>
            <div className="flex flex-col rounded-[3px] border border-rule">
              {others.map((m, i) => (
                <button
                  key={m.member_id}
                  onClick={() => setPick(m.member_id)}
                  className={`flex items-center gap-2.5 px-3.5 py-3 text-left ${i > 0 ? "border-t border-rule" : ""} ${
                    pick === m.member_id ? "bg-chip" : ""
                  }`}
                >
                  <Avatar id={m.member_id} name={m.display_name} size={30} />
                  <span className="flex-1 text-sm">{m.display_name}</span>
                  <span
                    className={`h-[18px] w-[18px] rounded-full border transition ${
                      pick === m.member_id ? "border-[5px] border-ink" : "border-[1.5px] border-rule-strong"
                    }`}
                  />
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={transfer}
                disabled={busy || !pick}
                className="flex-1 rounded-[3px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? "轉移中…" : `轉移給 ${members.find((m) => m.member_id === pick)?.display_name ?? ""}`}
              </button>
              <button onClick={() => setPane("main")} className="px-3 py-2.5 text-sm text-text-2 underline-offset-4 hover:underline">
                取消
              </button>
            </div>
          </div>
        )}

        {/* ── 刪除帳本確認（軟刪除） ── */}
        {pane === "delete" && (
          <div className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">刪除帳本？</h2>
              <button onClick={() => setPane("main")} aria-label="返回" className="rounded-[3px] p-1.5 text-text-3 transition hover:bg-ink/[0.04]">
                <X size={18} />
              </button>
            </div>
            <p className="text-sm leading-relaxed text-text-2">
              「{ledgerName}」將被刪除：從所有成員的帳本索引消失。資料會保留，需要時可救回。
            </p>
            {deleteErr && (
              <p className="rounded-[3px] bg-neg/5 px-3 py-2.5 text-[13px] text-neg">{deleteErr}</p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={del}
                disabled={busy}
                className="flex-1 rounded-[3px] bg-neg py-2.5 text-sm font-medium text-white transition hover:bg-neg/90 active:scale-[0.98] disabled:opacity-50"
              >
                {busy ? "處理中…" : "刪除帳本"}
              </button>
              <button onClick={() => setPane("main")} className="px-3 py-2.5 text-sm text-text-2 underline-offset-4 hover:underline">
                取消
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
