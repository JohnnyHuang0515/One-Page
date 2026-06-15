"use client";

// #2 動態：帳本最近異動（記帳/編輯/刪除/標記已付/月結/加入）。開啟即標記已讀。
import { useEffect, useState } from "react";
import { X } from "@phosphor-icons/react";
import { api } from "@/lib/client";
import { Avatar } from "@/components/avatar";
import { useEscapeKey } from "@/lib/use-escape";

type ActivityEvent = {
  id: string;
  actor_user_id: string;
  actor_name: string;
  type: string;
  summary: string;
  created_at: string;
  unread: boolean;
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
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export function ActivityModal({ ledgerId, onClose }: { ledgerId: string; onClose: () => void }) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="max-h-[80dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-rule bg-surface sm:rounded-[3px]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 pb-3 pt-5">
          <h2 className="text-lg font-bold">動態</h2>
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
              {events.map((e, i) => (
                <li key={e.id}>
                  <div className="flex items-start gap-3 py-3 pl-2.5">
                    <span className="relative shrink-0">
                      {e.unread && <span className="absolute -left-2.5 top-2.5 h-1.5 w-1.5 rounded-full bg-pos" />}
                      <Avatar id={e.actor_user_id} name={e.actor_name} size={30} />
                    </span>
                    <span className="flex flex-1 flex-col">
                      <span className="text-sm leading-snug">
                        <span className="font-medium">{e.actor_name}</span> {e.summary}
                      </span>
                      <span className="mt-0.5 text-[11px] text-text-3">{relTime(e.created_at)}</span>
                    </span>
                  </div>
                  {i < events.length - 1 && <div className="h-px bg-rule" />}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
