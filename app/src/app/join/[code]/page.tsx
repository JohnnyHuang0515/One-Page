"use client";

// P-4 加入帳本（邀請函）— Editorial Ledger 帳簿風
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen } from "@phosphor-icons/react";
import { api, ApiClientError, turnTo } from "@/lib/client";
import { AuthForm } from "@/components/auth-form";
import { Avatar } from "@/components/avatar";
import { useToast } from "@/components/toast";

type InvitePreview = {
  ledger_name: string;
  inviter_name: string | null;
  member_count: number;
  members?: { member_id: string; display_name: string }[];
  member_names: string[];
  current_period: { year_month: string; status: "OPEN" | "SETTLED" };
};

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ id: string; email: string } | null | undefined>(undefined);
  const [joining, setJoining] = useState(false);
  const router = useRouter();
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setPreview(await api<InvitePreview>(`/api/invitations/${code}`));
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "發生錯誤");
    }
    try {
      setMe(await api<{ id: string; email: string }>("/api/me"));
    } catch {
      setMe(null);
    }
  }, [code]);

  useEffect(() => {
    load();
  }, [load]);

  async function join() {
    setJoining(true);
    try {
      const res = await api<{ ledger_id: string }>(`/api/invitations/${code}/accept`, { method: "POST" });
      toast("success", "已加入帳本！");
      turnTo("forward");
      router.push(`/ledgers/${res.ledger_id}`, { transitionTypes: ["nav-forward"] });
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "發生錯誤");
      setJoining(false);
    }
  }

  // 頭像身分色需要穩定 id；preview 可能只有名字，退而用名字當 key
  const memberList =
    preview?.members ?? preview?.member_names.map((n) => ({ member_id: n, display_name: n })) ?? [];

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-6 bg-paper p-6">
      <div className="flex items-center gap-2 font-bold">
        <span className="flex h-7 w-7 items-center justify-center rounded-[3px] border border-ink/15 text-ink">
          <BookOpen size={15} weight="bold" />
        </span>
        室友分帳
      </div>

      <div className="w-full max-w-md rounded-[3px] border border-rule bg-paper p-8">
        {error ? (
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="font-medium">這個邀請無法使用</p>
            <p className="text-sm text-text-3">{error}</p>
          </div>
        ) : !preview ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-6 w-48 animate-pulse rounded bg-rule" />
            <div className="h-10 w-full animate-pulse rounded-[3px] bg-rule" />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex w-full items-center gap-3 text-[11px] tracking-[0.18em] text-text-3">
              <span className="h-px flex-1 bg-rule" />
              邀請函
              <span className="h-px flex-1 bg-rule" />
            </div>
            <div>
              {preview.inviter_name && (
                <p className="flex items-center justify-center gap-2 text-sm text-text-2">
                  <Avatar id={preview.inviter_name} name={preview.inviter_name} size={22} />
                  {preview.inviter_name} 邀請你加入帳本
                </p>
              )}
              <p className="mt-2 text-2xl font-bold">{preview.ledger_name}</p>
              <p className="mt-1 text-xs text-text-3">
                {preview.member_count} 位成員 ・{" "}
                <span className={preview.current_period.status === "OPEN" ? "text-pos" : ""}>
                  {preview.current_period.year_month} {preview.current_period.status === "OPEN" ? "記帳中" : "已結算"}
                </span>
              </p>
            </div>

            <div className="h-px w-full bg-rule" />

            <div className="flex gap-4">
              {memberList.map((m) => (
                <span key={m.member_id} className="flex flex-col items-center gap-1.5">
                  <Avatar id={m.member_id} name={m.display_name} size={44} />
                  <span className="text-xs text-text-2">{m.display_name}</span>
                </span>
              ))}
            </div>

            <p className="text-sm leading-relaxed text-text-3">
              加入後即可一起記錄共同花費、查看即時淨額，月底自動產生最少筆數的結清建議。
            </p>

            {me === undefined ? null : me ? (
              <button
                onClick={join}
                disabled={joining}
                className="flex w-full items-center justify-center gap-2 rounded-[3px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-50"
              >
                <BookOpen size={15} /> {joining ? "加入中…" : "加入帳本"}
              </button>
            ) : (
              <div className="w-full">
                <p className="mb-4 text-sm font-medium text-text-2">先登入或註冊，再加入帳本</p>
                <AuthForm initialMode="register" onSuccess={load} />
              </div>
            )}
            {me && <p className="text-xs text-text-3">目前以 {me.email} 登入</p>}
          </div>
        )}
      </div>
      <p className="text-xs text-text-3">邀請連結僅供受邀室友使用，加入後即可看到帳本內所有記錄</p>
    </main>
  );
}
