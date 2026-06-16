"use client";

// 個人資料 modal（P-13）：改顯示名稱、改密碼。
// Email 唯讀（無法修改）。改名成功發 toast；改密碼失敗（目前密碼不對／太短）走改密碼區的內聯錯誤條（不發 toast）。
import { useRef, useState } from "react";
import { X, WarningCircle, Eye, EyeSlash } from "@phosphor-icons/react";
import { api, ApiClientError } from "@/lib/client";
import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";
import { useEscapeKey } from "@/lib/use-escape";
import { useDialog } from "@/lib/use-dialog";

export function ProfileModal({
  user,
  onClose,
  onUpdated,
}: {
  user: { display_name: string; email: string; id: string };
  onClose: () => void;
  onUpdated?: (u: { display_name: string }) => void;
}) {
  const toast = useToast();
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef);

  // 顯示名稱
  const [name, setName] = useState(user.display_name);
  const [savingName, setSavingName] = useState(false);
  const nameChanged = name.trim().length > 0 && name.trim() !== user.display_name;

  // 改密碼
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [showCurrent, setShowCurrent] = useState(false); // 顯示/隱藏「目前密碼」
  const [showNew, setShowNew] = useState(false); // 顯示/隱藏「新密碼」
  const pwValid = currentPw.length > 0 && newPw.length >= 8;

  // 底線輸入框：與 auth-form 同款（focus 變深、placeholder 用 text-3）
  const field =
    "w-full border-b border-rule-strong bg-transparent py-2 outline-none transition focus:border-ink placeholder:text-text-3";

  async function saveName() {
    if (savingName || !nameChanged) return;
    setSavingName(true);
    try {
      await api("/api/me", { method: "PATCH", body: { display_name: name.trim() } });
      onUpdated?.({ display_name: name.trim() });
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "更新失敗");
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword() {
    if (savingPw || !pwValid) return;
    setSavingPw(true);
    setPwErr(null);
    try {
      await api("/api/me/password", {
        method: "PATCH",
        body: { current_password: currentPw, new_password: newPw },
      });
      setCurrentPw("");
      setNewPw("");
    } catch (e) {
      // 失敗（目前密碼不對／密碼至少 8 碼）走內聯錯誤條，留在視線焦點上。
      setPwErr(e instanceof ApiClientError ? e.message : "更新密碼失敗");
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-5" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
        className="max-h-[calc(100dvh-40px)] w-full max-w-md overflow-y-auto rounded-[3px] border border-rule bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 標題 ── */}
        <div className="flex items-center justify-between px-6 pb-4 pt-[22px]">
          <h2 id="profile-title" className="text-lg font-bold">個人資料</h2>
          <button onClick={onClose} aria-label="關閉" className="rounded-[3px] p-1.5 text-text-3 transition hover:bg-ink/[0.04]">
            <X size={18} />
          </button>
        </div>

        {/* ── 身分列 ── */}
        <div className="flex items-center gap-3 px-6 pb-5">
          <Avatar id={user.id} name={user.display_name} size={42} />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm text-text-2">{user.email}</span>
            <span className="text-[11px] text-text-3">Email 無法修改</span>
          </span>
        </div>

        <div className="h-px bg-rule" />

        {/* ── 顯示名稱 ── */}
        <div className="flex flex-col gap-2 px-6 py-5">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-text-3">顯示名稱</p>
          <div className="flex items-end gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={40}
              aria-label="顯示名稱"
              className={`${field} flex-1`}
            />
            <button
              onClick={saveName}
              disabled={savingName || !nameChanged}
              className="rounded-[3px] bg-ink px-3.5 py-2 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-30"
            >
              {savingName ? "儲存中…" : "儲存"}
            </button>
          </div>
        </div>

        <div className="h-px bg-rule" />

        {/* ── 改密碼 ── */}
        <div className="flex flex-col gap-3.5 px-6 pb-[22px] pt-5">
          <p className="text-[11px] font-semibold tracking-[0.15em] text-text-3">改密碼</p>

          {pwErr && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-[3px] border border-rule-red bg-[#fbeaed] px-3 py-2.5 text-sm text-[#8e1230]"
            >
              <WarningCircle size={17} weight="bold" className="shrink-0 text-neg" />
              <span>{pwErr}</span>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs tracking-wide text-text-3">目前密碼</span>
            <div className="relative">
              <input
                type={showCurrent ? "text" : "password"}
                value={currentPw}
                onChange={(e) => {
                  setCurrentPw(e.target.value);
                  if (pwErr) setPwErr(null);
                }}
                className={`${field} pr-9`}
              />
              <button
                type="button"
                onClick={() => setShowCurrent((v) => !v)}
                aria-label={showCurrent ? "隱藏密碼" : "顯示密碼"}
                aria-pressed={showCurrent}
                className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-text-3 transition hover:text-ink"
              >
                {showCurrent ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs tracking-wide text-text-3">新密碼（至少 8 碼）</span>
            <div className="relative">
              <input
                type={showNew ? "text" : "password"}
                minLength={8}
                value={newPw}
                onChange={(e) => {
                  setNewPw(e.target.value);
                  if (pwErr) setPwErr(null);
                }}
                className={`${field} pr-9`}
              />
              <button
                type="button"
                onClick={() => setShowNew((v) => !v)}
                aria-label={showNew ? "隱藏密碼" : "顯示密碼"}
                aria-pressed={showNew}
                className="absolute right-0 top-1/2 -translate-y-1/2 p-1 text-text-3 transition hover:text-ink"
              >
                {showNew ? <EyeSlash size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          <button
            onClick={savePassword}
            disabled={savingPw || !pwValid}
            className="mt-1 rounded-[3px] bg-ink py-3 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.99] disabled:opacity-30"
          >
            {savingPw ? "更新中…" : "更新密碼"}
          </button>
        </div>

      </div>
    </div>
  );
}
