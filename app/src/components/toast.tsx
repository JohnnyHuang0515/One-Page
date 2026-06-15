"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle, WarningCircle } from "@phosphor-icons/react";

// C-14 Toast — success / error feedback for §4 EF outcomes
// 頂端置中、米白紙面＋左色條（原右下角飽和色塊離視線焦點遠又違和，改帳簿風）
type Toast = { id: number; type: "success" | "error"; message: string };

const ToastContext = createContext<(type: Toast["type"], message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((type: Toast["type"], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 top-4 z-50 flex flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => {
          const ok = t.type === "success";
          const Icon = ok ? CheckCircle : WarningCircle;
          return (
            <div
              key={t.id}
              role={ok ? undefined : "alert"}
              className="pointer-events-auto flex max-w-[calc(100vw-2rem)] items-stretch overflow-hidden rounded-[3px] border border-rule-strong bg-surface shadow-md"
            >
              <span aria-hidden className={`w-[3px] shrink-0 ${ok ? "bg-pos" : "bg-neg"}`} />
              <div className="flex items-center gap-2.5 px-3.5 py-3">
                <Icon size={18} weight="bold" className={ok ? "text-pos" : "text-neg"} />
                <span className="text-sm text-ink">{t.message}</span>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
