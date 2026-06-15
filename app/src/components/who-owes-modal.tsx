"use client";

// #4 目前誰欠誰：跨所有月份、目前還沒結清的款項彙整（從我的視角）。
// 唯讀總覽；要「標記已付」請到該月的結清建議（具體結清項在那裡）。
import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { api, fmtMoney } from "@/lib/client";
import { Avatar } from "@/components/avatar";
import { useEscapeKey } from "@/lib/use-escape";
import { useDialog } from "@/lib/use-dialog";

type Pair = { member_id: string; user_id: string; display_name: string; net: number };
type Overview = { my_net: number; pairs: Pair[] };

const SIGN = (n: number) => (n > 0 ? "+" : n < 0 ? "-" : "");
const fmtNet = (n: number) => `${SIGN(n)}${fmtMoney(n)}`;

export function WhoOwesModal({ ledgerId, onClose }: { ledgerId: string; onClose: () => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef);
  useEscapeKey(onClose);

  useEffect(() => {
    let alive = true;
    api<Overview>(`/api/ledgers/${ledgerId}/overview`)
      .then((d) => alive && setData(d))
      .catch(() => alive && setData({ my_net: 0, pairs: [] }));
    return () => {
      alive = false;
    };
  }, [ledgerId]);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="who-owes-title"
        tabIndex={-1}
        className="max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-rule bg-surface p-6 sm:rounded-[3px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div className="flex flex-col">
            <h2 id="who-owes-title" className="text-lg font-bold">目前誰欠誰</h2>
            <p className="mt-0.5 text-[12px] text-text-3">跨所有月份、目前還沒結清的款項</p>
          </div>
          <button onClick={onClose} aria-label="關閉" className="rounded-[3px] p-1.5 text-text-3 transition hover:bg-ink/[0.04]">
            <X size={18} />
          </button>
        </div>

        {data === null ? (
          <div className="mt-5 flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-rule/60" />
            ))}
          </div>
        ) : (
          <>
            <div className="mt-4 flex flex-col gap-1">
              <p className="text-[12px] tracking-wide text-text-3">{data.my_net > 0 ? "目前別人總共欠你" : data.my_net < 0 ? "目前你總共欠別人" : "目前互不相欠"}</p>
              <p className={`text-[40px] font-bold leading-none tabular-nums ${data.my_net > 0 ? "text-pos" : data.my_net < 0 ? "text-neg" : "text-text-3"}`}>
                {fmtNet(data.my_net)}
              </p>
            </div>

            <div className="mt-5 flex flex-col">
              {data.pairs.length === 0 ? (
                <p className="py-8 text-center text-sm text-text-3">目前大家互不相欠</p>
              ) : (
                data.pairs.map((p, i) => (
                  <div key={p.member_id}>
                    <div className="flex items-center justify-between py-3.5">
                      <span className="flex items-center gap-2.5">
                        <Avatar id={p.member_id} name={p.display_name} size={30} />
                        <span className="text-sm">
                          {p.net > 0 ? (
                            <>
                              <span className="font-medium">{p.display_name}</span> 還你
                            </>
                          ) : p.net < 0 ? (
                            <>
                              你還 <span className="font-medium">{p.display_name}</span>
                            </>
                          ) : (
                            <>你和 {p.display_name}</>
                          )}
                        </span>
                      </span>
                      <span className={`font-semibold tabular-nums ${p.net > 0 ? "text-pos" : p.net < 0 ? "text-neg" : "text-text-3"}`}>
                        {p.net === 0 ? "互不相欠" : fmtNet(p.net)}
                      </span>
                    </div>
                    {i < data.pairs.length - 1 && <div className="h-px bg-rule" />}
                  </div>
                ))
              )}
            </div>

            <p className="mt-4 text-[11px] leading-relaxed text-text-3">
              每月「執行月結」會把當月結算鎖定；這裡彙整跨月還沒付清的款項。要把某筆標記已付，請到該月的結清建議。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
