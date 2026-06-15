"use client";

// 水墨首頁 — 底部半透明膠囊控制列。
// 四墨色圓點|輪替(顏色輪替)/演出(自動演出)/洗去(墨漸淡)|入口(登入 or 帳本)。
// 這頁刻意用膠囊圓角(氛圍頁),不套帳簿紙面的直角化。降級(靜態)時只留入口。
import { useRouter } from "next/navigation";
import { turnTo } from "@/lib/client";
import { INK_COLORS } from "./ink-colors";

type Props = {
  colorIndex: number;
  onSelectColor: (i: number) => void;
  rotate: boolean;
  onToggleRotate: () => void;
  autoplay: boolean;
  onToggleAutoplay: () => void;
  onWash: () => void;
  entryHref: string;
  entryLabel: string;
  simEnabled: boolean;
};

export function InkControlBar({
  colorIndex,
  onSelectColor,
  rotate,
  onToggleRotate,
  autoplay,
  onToggleAutoplay,
  onWash,
  entryHref,
  entryLabel,
  simEnabled,
}: Props) {
  const router = useRouter();
  const enter = () => {
    turnTo("forward");
    router.push(entryHref, { transitionTypes: ["nav-forward"] });
  };

  const toggleCls = (on: boolean) =>
    `whitespace-nowrap text-xs tracking-wider transition-colors ${on ? "font-medium text-ink" : "text-text-3 hover:text-text-2"}`;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
      <div className="flex items-center gap-2.5 rounded-full border border-rule-strong/70 bg-surface/55 px-4 py-2.5 shadow-[0_2px_16px_rgba(35,31,25,0.07)] backdrop-blur-md sm:gap-4 sm:px-5">
        {simEnabled && (
          <>
            <div className="flex items-center gap-1.5">
              {INK_COLORS.map((c, i) => (
                <button
                  key={c.hex}
                  type="button"
                  aria-label={`${c.name}墨`}
                  aria-pressed={i === colorIndex}
                  onClick={() => onSelectColor(i)}
                  className={`flex h-6 w-6 items-center justify-center rounded-full border transition-colors ${
                    i === colorIndex ? "border-text-2" : "border-transparent hover:border-rule-strong"
                  }`}
                >
                  <span className="h-3.5 w-3.5 rounded-full" style={{ background: c.hex }} />
                </button>
              ))}
            </div>
            <span className="h-4 w-px bg-rule-strong/80" aria-hidden />
            <button type="button" aria-label="顏色輪替" aria-pressed={rotate} onClick={onToggleRotate} className={toggleCls(rotate)}>
              輪替
            </button>
            <button type="button" aria-label="自動演出" aria-pressed={autoplay} onClick={onToggleAutoplay} className={toggleCls(autoplay)}>
              演出
            </button>
            <button
              type="button"
              onClick={onWash}
              className="whitespace-nowrap text-xs tracking-wider text-text-3 transition-colors hover:text-ink"
            >
              洗去
            </button>
            <span className="h-4 w-px bg-rule-strong/80" aria-hidden />
          </>
        )}
        <button
          type="button"
          onClick={enter}
          className="whitespace-nowrap text-[13px] text-text-2 underline decoration-text-3/60 underline-offset-4 transition-colors hover:text-ink"
        >
          {entryLabel}
        </button>
      </div>
    </div>
  );
}
