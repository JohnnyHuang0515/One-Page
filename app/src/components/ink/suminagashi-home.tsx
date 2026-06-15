"use client";

// P-0 墨流し首頁:全螢幕互動水墨 + 底部控制列。畫面上無標題/logo/說明文字。
// 未登入:自由玩墨,入口「登入」;已登入:自動演出重播帳本當月記帳,入口「帳本」。
import { useRef, useState } from "react";
import { SuminagashiCanvas, type InkHandle, type ReplayData } from "./suminagashi-canvas";
import { InkControlBar } from "./control-bar";
import { INK_COLORS } from "./ink-colors";

export function SuminagashiHome({ loggedIn, replay }: { loggedIn: boolean; replay: ReplayData | null }) {
  const [colorIndex, setColorIndex] = useState(0);
  const [rotate, setRotate] = useState(false);
  const [autoplay, setAutoplay] = useState(true); // 自動演出預設開啟
  const [simEnabled, setSimEnabled] = useState(true);
  const inkRef = useRef<InkHandle | null>(null);

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-paper">
      <SuminagashiCanvas
        colorIndex={colorIndex}
        rotate={rotate}
        autoplay={autoplay}
        replay={replay}
        onAdvanceColor={() => setColorIndex((i) => (i + 1) % INK_COLORS.length)}
        onStatic={() => setSimEnabled(false)}
        handleRef={inkRef}
      />
      <InkControlBar
        colorIndex={colorIndex}
        onSelectColor={setColorIndex}
        rotate={rotate}
        onToggleRotate={() => setRotate((v) => !v)}
        autoplay={autoplay}
        onToggleAutoplay={() => setAutoplay((v) => !v)}
        onWash={() => inkRef.current?.wash()}
        entryHref={loggedIn ? "/ledgers" : "/login"}
        entryLabel={loggedIn ? "帳本" : "登入"}
        simEnabled={simEnabled}
      />
    </main>
  );
}
