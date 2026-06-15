"use client";

// 麵包屑：首頁 / 帳本索引 / {帳本名}。Editorial 帳簿風，「/」分隔（呼應 yyyy/mm）。
// 往上爬階層＝倒退，沿用既有「往回翻頁」動畫（turnTo("back") + nav-back）。
import { useRouter } from "next/navigation";
import { BookOpen } from "@phosphor-icons/react";
import { turnTo } from "@/lib/client";

export type Crumb = { label: string; href?: string };

export function Breadcrumb({ items }: { items: Crumb[] }) {
  const router = useRouter();
  const go = (href: string) => {
    turnTo("back");
    router.push(href, { transitionTypes: ["nav-back"] });
  };
  // RWD：手機只顯示「圖示 + 當前頁」，圖示變成回上一層的入口（中間層級在 sm 以上才出現）。
  const parentHref = items.length >= 2 ? items[items.length - 2].href : items[0]?.href;

  return (
    <nav aria-label="麵包屑" className="flex min-w-0 items-center gap-2 text-[13px]">
      <button
        type="button"
        onClick={() => parentHref && go(parentHref)}
        disabled={!parentHref}
        aria-label="上一層"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border border-ink/15 text-ink transition enabled:hover:bg-ink/[0.04]"
      >
        <BookOpen size={15} weight="bold" />
      </button>
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className={`min-w-0 items-center gap-2 ${last ? "flex" : "hidden sm:flex"}`}>
            {i > 0 && (
              <span className={`shrink-0 text-text-3/50 ${last ? "hidden sm:inline" : ""}`} aria-hidden>
                /
              </span>
            )}
            {c.href && !last ? (
              <button
                onClick={() => go(c.href!)}
                className="shrink-0 text-text-3 underline-offset-4 transition hover:text-ink hover:underline"
              >
                {c.label}
              </button>
            ) : (
              <span
                className={`truncate ${last ? "font-semibold text-ink" : "text-text-3"}`}
                aria-current={last ? "page" : undefined}
              >
                {c.label}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
