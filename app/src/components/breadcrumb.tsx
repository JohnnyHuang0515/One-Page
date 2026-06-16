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
  // RWD：手機只顯示「/ 上一層」；桌機顯示完整麵包屑。
  const parentHref = items.length >= 2 ? items[items.length - 2].href : items[0]?.href;
  const parentLabel = items.length >= 2 ? items[items.length - 2].label : items[0]?.label;

  return (
    <nav aria-label="麵包屑" className="flex min-w-0 flex-1 items-center gap-2 text-[13px]">
      <button
        type="button"
        onClick={() => parentHref && go(parentHref)}
        disabled={!parentHref}
        aria-label="上一層"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[3px] border border-ink/15 text-ink transition enabled:hover:bg-ink/[0.04]"
      >
        <BookOpen size={15} weight="bold" />
      </button>
      {parentHref && parentLabel && (
        <span className="flex min-w-0 items-center gap-2 text-text-3 sm:hidden">
          <span aria-hidden>/</span>
          <button
            type="button"
            onClick={() => go(parentHref)}
            className="min-w-0 truncate transition hover:text-ink"
          >
            {parentLabel}
          </button>
        </span>
      )}
      {items.map((c, i) => {
        const last = i === items.length - 1;
        return (
          <span key={i} className={`hidden items-center gap-2 sm:flex ${last ? "min-w-0" : "shrink-0"}`}>
            {i > 0 && (
              <span className="shrink-0 text-text-3/50" aria-hidden>
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
