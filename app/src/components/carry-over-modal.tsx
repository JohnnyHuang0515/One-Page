"use client";

// #1 從上月帶入：把上一個月的（固定）開銷挑進這個月。平均分攤可改金額；指定金額沿用原額。
import { useEffect, useRef, useState } from "react";
import { X, Calendar } from "@phosphor-icons/react";
import { api, ApiClientError, fmtMoney, ymAdd } from "@/lib/client";
import { useToast } from "@/components/toast";
import { useEscapeKey } from "@/lib/use-escape";
import { useDialog } from "@/lib/use-dialog";

type SrcExpense = { id: string; description: string; amount: number; split_method: "EQUAL" | "EXACT_AMOUNT" };

function ymLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

export function CarryOverModal({
  ledgerId,
  targetYm,
  onClose,
  onDone,
}: {
  ledgerId: string;
  targetYm: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const toast = useToast();
  const sourceYm = ymAdd(targetYm, -1);
  const [src, setSrc] = useState<SrcExpense[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEscapeKey(onClose);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef);

  useEffect(() => {
    let alive = true;
    api<{ expenses: SrcExpense[] }>(`/api/ledgers/${ledgerId}/periods/${sourceYm}`)
      .then((v) => {
        if (!alive) return;
        setSrc(v.expenses);
        setPicked(new Set(v.expenses.map((e) => e.id)));
        setAmounts(Object.fromEntries(v.expenses.map((e) => [e.id, String(e.amount)])));
      })
      .catch(() => alive && setSrc([]));
    return () => {
      alive = false;
    };
  }, [ledgerId, sourceYm]);

  function toggle(id: string) {
    const n = new Set(picked);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    setPicked(n);
  }

  async function confirm() {
    if (busy || picked.size === 0) return;
    setBusy(true);
    try {
      const items = [...picked].map((id) => ({ expense_id: id, amount: parseInt(amounts[id] ?? "", 10) || undefined }));
      const res = await api<{ created: number; skipped: number }>(`/api/ledgers/${ledgerId}/periods/${targetYm}/carry`, {
        method: "POST",
        body: { items },
      });
      toast("success", `已帶入 ${res.created} 筆${res.skipped ? `（略過 ${res.skipped} 筆）` : ""}`);
      onDone();
    } catch (e) {
      toast("error", e instanceof ApiClientError ? e.message : "帶入失敗");
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
        aria-labelledby="carry-title"
        className="max-h-[88dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-rule bg-surface p-6 sm:rounded-[3px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <h2 id="carry-title" className="text-lg font-bold">從上月帶入</h2>
            <p className="mt-0.5 text-[12px] text-text-3">把上個月的固定花費帶進這個月。取消不需要的，金額可改。</p>
          </div>
          <button onClick={onClose} aria-label="關閉" className="rounded-[3px] p-1.5 text-text-3 transition hover:bg-ink/[0.04]">
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 inline-flex items-center gap-1.5 self-start rounded-[3px] bg-chip px-2.5 py-1.5 text-[12px] font-medium text-text-2">
          <Calendar size={13} /> 來源 ・ {ymLabel(sourceYm)}
        </div>

        <div className="mt-4">
          {src === null ? (
            <div className="flex flex-col gap-2.5">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-rule/60" />
              ))}
            </div>
          ) : src.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-3">上個月（{ymLabel(sourceYm)}）沒有可帶入的花費。</p>
          ) : (
            <div className="flex flex-col gap-0.5 rounded-[3px] border border-rule p-2">
              {src.map((e) => {
                const on = picked.has(e.id);
                return (
                  <div key={e.id} className="flex items-center gap-3 py-2 pl-1 pr-1">
                    <input type="checkbox" checked={on} onChange={() => toggle(e.id)} className="h-4 w-4 accent-ink" />
                    <span className="flex flex-1 items-center gap-2">
                      <span className={`truncate text-sm ${on ? "" : "text-text-3"}`}>{e.description}</span>
                      <span className="shrink-0 rounded-[3px] border border-rule-strong px-1.5 py-0.5 text-[10px] text-text-2">
                        {e.split_method === "EQUAL" ? "平均分攤" : "指定金額"}
                      </span>
                    </span>
                    {e.split_method === "EQUAL" ? (
                      <span className="flex items-center gap-1">
                        <span className="text-text-3">$</span>
                        <input
                          type="number"
                          min={1}
                          step={1}
                          value={amounts[e.id] ?? ""}
                          onChange={(ev) => setAmounts({ ...amounts, [e.id]: ev.target.value })}
                          disabled={!on}
                          className="w-24 rounded-[3px] border border-rule-strong px-2 py-1 text-right text-[13px] tabular-nums outline-none focus:border-ink disabled:opacity-40"
                        />
                      </span>
                    ) : (
                      <span className={`w-[108px] text-right text-[13px] font-medium tabular-nums ${on ? "" : "text-text-3"}`}>
                        {fmtMoney(e.amount)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {src && src.length > 0 && (
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={confirm}
              disabled={busy || picked.size === 0}
              className="flex-1 rounded-[3px] bg-ink py-2.5 text-sm font-medium text-white transition hover:bg-ink/85 active:scale-[0.98] disabled:opacity-40"
            >
              {busy ? "帶入中…" : `帶入 ${picked.size} 筆`}
            </button>
            <button onClick={onClose} className="px-3 py-2.5 text-sm text-text-2 underline-offset-4 hover:underline">
              取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
