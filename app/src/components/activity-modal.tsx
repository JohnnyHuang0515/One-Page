"use client";

// #2 動態：帳本最近異動（記帳/編輯/刪除/標記已付/月結/加入）。開啟即標記已讀。
import { useEffect, useRef, useState, type ComponentType } from "react";
import { Check, LockSimple, PencilSimple, Plus, Trash, UserPlus, X, type IconProps } from "@phosphor-icons/react";
import { api } from "@/lib/client";
import { Avatar } from "@/components/avatar";
import { useEscapeKey } from "@/lib/use-escape";
import { useDialog } from "@/lib/use-dialog";

type ActivityEvent = {
  id: string;
  actor_user_id: string;
  actor_name: string;
  type: string;
  summary: string;
  created_at: string;
  unread: boolean;
};

// 事件類型 → 小圖示 + 語意色（帳簿風，低調輔助）。色只用既有 token。
const iconFor: Record<string, { Icon: ComponentType<IconProps>; cls: string }> = {
  EXPENSE_ADDED: { Icon: Plus, cls: "text-text-2" }, // 新增花費：中性
  EXPENSE_EDITED: { Icon: PencilSimple, cls: "text-text-2" }, // 編輯：中性
  EXPENSE_DELETED: { Icon: Trash, cls: "text-neg" }, // 刪除：破壞性，紅色明顯
  SETTLEMENT_PAID: { Icon: Check, cls: "text-pos" }, // 標記已付：綠色
  PERIOD_SETTLED: { Icon: LockSimple, cls: "text-text-2" }, // 月結封存：中性
  MEMBER_JOINED: { Icon: UserPlus, cls: "text-text-2" }, // 加入成員：中性
};

function relTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sec = (now.getTime() - d.getTime()) / 1000;
  if (sec < 60) return "剛剛";
  if (sec < 3600) return `${Math.floor(sec / 60)} 分鐘前`;
  const hhmm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return `今天 ${hhmm}`;
  const yest = new Date(now);
  yest.setDate(now.getDate() - 1);
  if (d.toDateString() === yest.toDateString()) return `昨天 ${hhmm}`;
  // 2~6 天前：相對天數（以日界線計，較直覺）。
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86_400_000);
  if (days >= 2 && days <= 6) return `${days} 天前`;
  // 更早：M/D；跨年（事件年份 ≠ 今年）顯示 YYYY/M/D 以消歧義。
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}/${md}`;
}

export function ActivityModal({ ledgerId, onClose }: { ledgerId: string; onClose: () => void }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useDialog(dialogRef);
  useEscapeKey(onClose);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api<{ events: ActivityEvent[] }>(`/api/ledgers/${ledgerId}/events`);
        if (alive) setEvents(res.events);
        api(`/api/ledgers/${ledgerId}/events/seen`, { method: "POST" }).catch(() => {}); // 標記已讀
      } catch {
        if (alive) setEvents([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ledgerId]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-5" onClick={onClose}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="activity-title"
        className="max-h-[calc(100dvh-40px)] w-full max-w-md overflow-y-auto rounded-[3px] border border-rule bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <h2 id="activity-title" className="text-lg font-bold">動態</h2>
          <button onClick={onClose} aria-label="關閉" className="rounded-[3px] p-1.5 text-text-3 transition hover:bg-ink/[0.04]">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-5">
          {events === null ? (
            <div className="flex flex-col gap-3 py-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-rule/60" />
              ))}
            </div>
          ) : events.length === 0 ? (
            <p className="py-10 text-center text-sm text-text-3">這個帳本還沒有任何動態</p>
          ) : (
            <ul className="flex flex-col">
              {events.map((e, i) => {
                const ev = iconFor[e.type];
                return (
                <li key={e.id}>
                  <div className="flex items-start gap-3 py-3 pl-2.5">
                    <span className="relative shrink-0">
                      {e.unread && <span className="absolute -left-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-pos" />}
                      <Avatar id={e.actor_user_id} name={e.actor_name} size={30} />
                    </span>
                    <span className="flex flex-1 flex-col">
                      <span className="text-sm leading-snug">
                        {ev && (
                          <ev.Icon
                            size={13}
                            weight="bold"
                            aria-hidden
                            className={`mr-1 inline-block shrink-0 -translate-y-px ${ev.cls}`}
                          />
                        )}
                        <span className="font-medium">{e.actor_name}</span> {e.summary}
                      </span>
                      <span className="mt-0.5 text-[11px] text-text-3">{relTime(e.created_at)}</span>
                    </span>
                  </div>
                  {i < events.length - 1 && <div className="h-px bg-rule" />}
                </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
