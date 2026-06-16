"use client";

// 換頁動畫：整頁 3D 翻頁（見 design/DESIGN-SPEC.md 動效規格）。
//
// 作法：experimental.viewTransition 開啟後，Next 會在路由導航時自動啟動 view transition
// （實測 router.push 也會觸發）。方向由 Link / router.push 的 transitionTypes 帶入
// （nav-forward 進帳本 / nav-back 返回），對應到瀏覽器的 active view-transition type。
// 實際的翻頁 keyframes 用 CSS `:active-view-transition-type()` 覆寫 UA 預設淡入淡出，
// 見 globals.css。default="auto" 確保每次導航都會啟動一個 transition。
// 無瀏覽器支援或 prefers-reduced-motion 時自動降級為瞬間切換。
import * as React from "react";

type ViewTransitionProps = {
  children: React.ReactNode;
  enter?: string | Record<string, string>;
  exit?: string | Record<string, string>;
  default?: string;
  name?: string;
  share?: string;
};

// @types/react 尚未涵蓋 ViewTransition；Next 內建的 React canary 在 runtime 有此 export。
const ViewTransition = (
  React as unknown as { ViewTransition: React.FC<ViewTransitionProps> }
).ViewTransition;

// 橋接：React 的 transitionTypes 不會設定瀏覽器的 view-transition types，CSS
// :active-view-transition-type() 因此看不到方向。這裡攔截 document.startViewTransition，
// 依 <html data-nav>（由 turnTo 設定）注入瀏覽器 types，讓 CSS 能依方向選擇翻頁動畫。
// 無 data-nav（無方向 / 第二次 settle 轉場）→ 不注入 → 走 default 淡入，不翻第二下。
function useViewTransitionTypeBridge() {
  React.useEffect(() => {
    // experimental API；用 any 繞過 DOM lib 的嚴格簽名（我們會改傳 {update, types} 物件形式）
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const doc = document as any;
    if (doc.__vtTypePatched || typeof doc.startViewTransition !== "function") return;
    const orig = doc.startViewTransition.bind(doc);
    doc.__vtTypePatched = true;
    doc.startViewTransition = (arg: any) => {
      const dir = document.documentElement.dataset.nav;
      if (dir) {
        const types = [`nav-${dir}`];
        try {
          if (typeof arg === "function") return orig({ update: arg, types });
          if (arg && typeof arg === "object") return orig({ ...arg, types: [...(arg.types ?? []), ...types] });
        } catch {
          // 部分手機瀏覽器只支援 startViewTransition(update)，不支援 { update, types }。
          // CSS 仍會用 html[data-nav] fallback 套方向動畫。
          if (typeof arg === "function") return orig(arg);
          if (arg?.update && typeof arg.update === "function") return orig(arg.update);
        }
      }
      return orig(arg);
    };
    return () => {
      doc.startViewTransition = orig;
      doc.__vtTypePatched = false;
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }, []);
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  useViewTransitionTypeBridge();
  return <ViewTransition default="auto">{children}</ViewTransition>;
}
