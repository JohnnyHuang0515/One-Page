"use client";

// C-13 AuthForm — Editorial Ledger 帳簿風（底線輸入框、tab 底線）
import { useState } from "react";
import { useRouter } from "next/navigation";
import { WarningCircle } from "@phosphor-icons/react";
import { api, ApiClientError, turnTo } from "@/lib/client";

export function AuthForm({
  initialMode = "login",
  onSuccess,
}: {
  initialMode?: "login" | "register";
  onSuccess?: () => void;
}) {
  const [mode, setMode] = useState(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  // 失敗訊息改成表單內聯（取代右下角 toast）：就在視線焦點上，不會錯過。
  const [formErr, setFormErr] = useState<string | null>(null);
  const router = useRouter();

  // 切換登入/註冊或重新輸入時清掉錯誤
  function switchMode(m: "login" | "register") {
    setMode(m);
    setFormErr(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormErr(null);
    try {
      if (mode === "register") {
        await api("/api/auth/register", { method: "POST", body: { email, password, display_name: displayName } });
      } else {
        await api("/api/auth/login", { method: "POST", body: { email, password } });
      }
      // 成功不發 toast：跳轉 / onSuccess 的畫面變化本身就是回饋。
      if (onSuccess) onSuccess();
      else { turnTo("forward"); router.push("/ledgers", { transitionTypes: ["nav-forward"] }); }
      router.refresh();
    } catch (err) {
      setFormErr(err instanceof ApiClientError ? err.message : "發生錯誤");
      setBusy(false);
    }
  }

  const field = "w-full border-b border-rule-strong bg-transparent py-2 outline-none transition focus:border-ink placeholder:text-text-3";

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-6">
      {/* tab：底線 */}
      <div className="flex gap-8 border-b border-rule text-sm">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => switchMode(m)}
            className={`-mb-px border-b-2 pb-2.5 transition ${
              mode === m ? "border-ink font-semibold text-ink" : "border-transparent text-text-3"
            }`}
          >
            {m === "login" ? "登入" : "註冊"}
          </button>
        ))}
      </div>

      {formErr && (
        <div
          role="alert"
          className="flex items-center gap-2 rounded-[3px] border border-rule-red bg-[#fbeaed] px-3 py-2.5 text-sm text-[#8e1230]"
        >
          <WarningCircle size={17} weight="bold" className="shrink-0 text-neg" />
          <span>{formErr}</span>
        </div>
      )}

      {mode === "register" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-xs tracking-wide text-text-3">顯示名稱</span>
          <input required value={displayName} onChange={(e) => { setDisplayName(e.target.value); if (formErr) setFormErr(null); }} placeholder="小明" className={field} />
        </label>
      )}
      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-text-3">Email</span>
        <input required type="email" value={email} onChange={(e) => { setEmail(e.target.value); if (formErr) setFormErr(null); }} placeholder="you@example.com" className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-xs tracking-wide text-text-3">密碼{mode === "register" && "（至少 8 碼）"}</span>
        <input
          required
          type="password"
          minLength={mode === "register" ? 8 : undefined}
          value={password}
          onChange={(e) => { setPassword(e.target.value); if (formErr) setFormErr(null); }}
          className={field}
        />
      </label>

      <button
        disabled={busy}
        className="mt-1 rounded-[3px] bg-ink py-3 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.99] disabled:opacity-50"
      >
        {busy ? "處理中…" : mode === "login" ? "登入" : "建立帳號"}
      </button>

      <p className="text-center text-sm text-text-3">
        {mode === "login" ? "還沒有帳號？" : "已經有帳號了？"}
        <button
          type="button"
          onClick={() => switchMode(mode === "login" ? "register" : "login")}
          className="ml-1 font-semibold text-ink underline-offset-4 hover:underline"
        >
          {mode === "login" ? "立即註冊" : "改用登入"}
        </button>
      </p>
    </form>
  );
}
