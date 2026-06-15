"use client";

// 共用對話框外殼：手機底部 sheet、桌機置中卡片；scrim 點擊關閉、Esc 關閉、focus 管理、aria。
// 給站內小型確認/表單浮層共用（月結確認、邀請室友、建立帳本…），與各大型 modal 風格一致。
import { useId, useRef } from "react";
import { X } from "@phosphor-icons/react";
import { useEscapeKey } from "@/lib/use-escape";
import { useDialog } from "@/lib/use-dialog";

export function Dialog({
  title,
  onClose,
  children,
  maxWidth = "max-w-sm",
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  maxWidth?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialog(ref);
  useEscapeKey(onClose);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4" onClick={onClose}>
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`w-full ${maxWidth} rounded-t-2xl border border-rule bg-surface p-6 sm:rounded-[3px]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-lg font-bold">
            {title}
          </h2>
          <button onClick={onClose} aria-label="關閉" className="rounded-[3px] p-1.5 text-text-3 transition hover:bg-ink/[0.04]">
            <X size={18} />
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
