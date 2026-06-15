"use client";

// 墨流し畫布:fluid.ts 引擎的 React 殼。
// 互動:點擊滴墨、拖曳推墨(多指可玩);自動演出:閒置時環境水流 + 滴墨
// (未登入隨機四色;登入後依時間序重播「當月、所有帳本、還沒結清」的花費 —
//  位置/墨色隨機、大小∝log(金額),每滴對應一筆真實帳目;全結清則回到隨機滴墨)。
// 重播可讀層:墨滴旁浮現帳目小字(滲入再淡出,色點=該滴墨色)+ 右上角月份/滾動合計/會計雙線;
// 手動玩墨時純粹無字,使用者一接手演出歸零。
// 降級:prefers-reduced-motion 或無 WebGL2 → 靜態和紙 + 預染墨漬。
import { useEffect, useRef, useState, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { RollingNumber } from "@/components/anim/rolling-number";
import { createFluid } from "./fluid";
import { INK_ABSORBANCE, INK_COLORS } from "./ink-colors";

export type ReplayDrop = { ledger: string; amount: number; label: string; payerName: string };
export type ReplayData = { title: string; drops: ReplayDrop[] };
export type InkHandle = { wash(): void };

type Caption = {
  id: number;
  xPct: number;
  yPct: number;
  offset: number; //  與墨滴的水平距離(px,隨墨滴大小推開)
  offsetY: number; // 低於墨滴中心的距離(px,字落在右下方)
  ledger: string;
  label: string;
  amount: number;
  colorIndex: number;
  payerName: string;
};

const IDLE_MS = 6000; //          互動後多久恢復自動演出
const FIRST_EVENT_MS = 1600; //   載入後第一滴的等待
const REPLAY_INTERVAL = 2400; //  重播:每筆間隔
const REPLAY_LOOP_PAUSE = 9000; //重播:整月播完的停拍
const DRIP_MIN = 4000; //         隨機滴墨間隔範圍
const DRIP_MAX = 9000;
const AMBIENT_FLOW = 14; //       環境水流強度(每秒)

type Props = {
  colorIndex: number;
  rotate: boolean; //   顏色輪替:每次手動滴墨後換下一色
  autoplay: boolean; // 自動演出開關
  replay: ReplayData | null;
  onAdvanceColor: () => void;
  onStatic: () => void; // 降級為靜態時通知(控制列收起模擬控制)
  handleRef: RefObject<InkHandle | null>;
};

export function SuminagashiCanvas({ colorIndex, rotate, autoplay, replay, onAdvanceColor, onStatic, handleRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isStatic, setIsStatic] = useState(false);
  const [sized, setSized] = useState(0); // 尺寸到位才建引擎；計數器（非布林）確保每次都能可靠觸發重跑（見下方 effect）
  const [retry, setRetry] = useState(0); // createFluid 撞到暫時性 lost context 時重試（見下方 effect）
  // 重播可讀層狀態(只在自動演出重播時有內容)
  const [captions, setCaptions] = useState<Caption[]>([]);
  const [total, setTotal] = useState(0);
  const [counting, setCounting] = useState(false);

  // RAF 迴圈讀 ref,避免 props 變動重建引擎(ref 同步放 effect,render 期間不寫 ref)
  const propsRef = useRef({ colorIndex, rotate, autoplay, replay, onAdvanceColor });
  const onStaticRef = useRef(onStatic);
  useEffect(() => {
    propsRef.current = { colorIndex, rotate, autoplay, replay, onAdvanceColor };
    onStaticRef.current = onStatic;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const goStatic = () => {
      setIsStatic(true);
      onStaticRef.current();
    };
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      goStatic();
      return;
    }

    // soft 導航 / View Transition（翻頁）期間，canvas 會短暫 0 尺寸且脫離 DOM；此時 createFluid 會失敗，
    // 舊版會把它誤判成「無 WebGL」而永久降級成靜態（從別頁翻回首頁只剩入口鈕、不能互動）。
    // 解法：等尺寸真的到位（ResizeObserver）再建引擎；只有 reduced-motion 或「有尺寸後仍建不起來」才降級。
    if (canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      const waitRo = new ResizeObserver(() => {
        if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
          waitRo.disconnect();
          setSized((n) => n + 1); // 觸發本 effect 重跑 → 走下方正常初始化（計數器，避免重複時 no-op）
        }
      });
      waitRo.observe(canvas);
      return () => waitRo.disconnect();
    }

    const dpr = Math.min(window.devicePixelRatio || 1, window.innerWidth < 768 ? 1.5 : 2);
    const fit = () => {
      canvas.width = Math.max(Math.round(canvas.clientWidth * dpr), 2);
      canvas.height = Math.max(Math.round(canvas.clientHeight * dpr), 2);
    };
    fit();

    const fluid = createFluid(canvas);
    if (!fluid) {
      // soft-nav / 翻頁期間連續建多個 context 可能讓瀏覽器暫時遺失 context（createFluid 回 null）。
      // 先重試幾次（context 名額釋放後就能成功），真的拿不到才降級成靜態。
      if (retry < 6) {
        const t = window.setTimeout(() => setRetry((r) => r + 1), 180);
        return () => window.clearTimeout(t);
      }
      goStatic();
      return;
    }
    handleRef.current = { wash: () => fluid.wash() };

    // ── 自動演出狀態 ──
    const t0 = performance.now();
    let lastInteract = t0 - IDLE_MS; // 一載入即視為閒置,FIRST_EVENT_MS 後開演
    let nextEventAt = t0 + FIRST_EVENT_MS;
    let replayIdx = 0;
    let phase = Math.random() * Math.PI * 2; // 環境流相位(每次載入不同)
    let lastNow = t0;
    let capId = 0;
    let loopEndAt = 0; // 整月播完的時間(供角落合計淡出歸零)
    const timeouts = new Set<number>();

    const dropReplayed = (d: ReplayDrop) => {
      // 隨機位置 + 隨機墨色(不做日期/付款人映射);金額仍 → 半徑/濃度(log 壓縮)
      const x = 0.15 + Math.random() * 0.7;
      const y = 0.24 + Math.random() * 0.52;
      const ci = Math.floor(Math.random() * INK_COLORS.length);
      const norm = Math.min(Math.max((Math.log10(Math.max(d.amount, 1)) - 1.5) / 3, 0), 1);
      fluid.drop(x, y, INK_ABSORBANCE[ci], 0.7 + norm * 1.5);
      // 帳目小字:像墨一樣滲入,停留片刻再淡出;色點=這滴墨的顏色(把字跟墨連起來)
      const cap: Caption = {
        id: ++capId,
        xPct: x * 100,
        yPct: (1 - y) * 100,
        offset: 40 + norm * 60, //  墨滴越大,字推得越開
        offsetY: 14 + norm * 22, // 並落在中心偏下(右下方)
        ledger: d.ledger,
        label: d.label,
        amount: d.amount,
        colorIndex: ci,
        payerName: d.payerName,
      };
      setCaptions((cs) => [...cs, cap]);
      setTotal((t) => t + d.amount);
      setCounting(true);
      const handle = window.setTimeout(() => {
        timeouts.delete(handle);
        setCaptions((cs) => cs.filter((c) => c.id !== cap.id));
      }, 3400);
      timeouts.add(handle);
    };

    const autoperform = (now: number, dt: number) => {
      const p = propsRef.current;
      if (!p.autoplay || now - lastInteract < IDLE_MS) {
        // 互動中:演出暫停,恢復閒置後至少再等 1.2s
        nextEventAt = Math.max(nextEventAt, now + 1200);
        return;
      }
      // 輕微環境水流:兩個隱形攪拌點沿 Lissajous 緩慢游走
      phase += dt;
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? 1 : -1;
        const a = phase * 0.11 * s + i * 2.4;
        const x = 0.5 + 0.36 * Math.sin(a);
        const y = 0.5 + 0.3 * Math.sin(phase * 0.073 * s + i * 1.1);
        fluid.flow(x, y, Math.cos(a) * s, Math.cos(phase * 0.073 * s + i * 1.1), AMBIENT_FLOW * dt);
      }
      // 整月播完:下一輪開演前,角落合計先淡出歸零
      if (loopEndAt && now > loopEndAt + REPLAY_LOOP_PAUSE - 1500) {
        loopEndAt = 0;
        setCounting(false);
        setTotal(0);
      }
      if (now < nextEventAt) return;
      const r = p.replay;
      if (r && r.drops.length) {
        if (replayIdx >= r.drops.length) {
          replayIdx = 0;
          loopEndAt = now;
          nextEventAt = now + REPLAY_LOOP_PAUSE;
        } else {
          dropReplayed(r.drops[replayIdx]);
          // 換帳本時多停一拍,分組敘事
          const next = r.drops[replayIdx + 1];
          const gap =
            next && next.ledger !== r.drops[replayIdx].ledger ? REPLAY_INTERVAL + 2200 : REPLAY_INTERVAL;
          replayIdx++;
          nextEventAt = now + gap;
        }
      } else {
        fluid.drop(
          0.15 + Math.random() * 0.7,
          0.2 + Math.random() * 0.6,
          INK_ABSORBANCE[Math.floor(Math.random() * INK_COLORS.length)],
          0.8 + Math.random() * 0.6
        );
        nextEventAt = now + DRIP_MIN + Math.random() * (DRIP_MAX - DRIP_MIN);
      }
    };

    let raf = 0;
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden) return;
      const dt = Math.min((now - lastNow) / 1000, 1 / 30);
      lastNow = now;
      autoperform(now, dt);
      fluid.step(now);
    };
    raf = requestAnimationFrame(loop);

    // ── 互動:點擊滴墨、拖曳推墨 ──
    const pointers = new Map<number, { x: number; y: number }>();
    const toUv = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left) / rect.width, y: 1 - (e.clientY - rect.top) / rect.height };
    };
    const onDown = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      const p = toUv(e);
      pointers.set(e.pointerId, p);
      lastInteract = performance.now();
      // 使用者接手:可讀層收掉、演出歸零(下次閒置從頭重播,合計才會對)
      replayIdx = 0;
      loopEndAt = 0;
      setCaptions([]);
      setTotal(0);
      setCounting(false);
      const props = propsRef.current;
      fluid.drop(p.x, p.y, INK_ABSORBANCE[props.colorIndex], 1);
      if (props.rotate) props.onAdvanceColor();
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const p = toUv(e);
      const dx = p.x - prev.x;
      const dy = p.y - prev.y;
      if (Math.abs(dx) + Math.abs(dy) < 0.0005) return;
      pointers.set(e.pointerId, p);
      lastInteract = performance.now();
      fluid.move(p.x, p.y, dx, dy, INK_ABSORBANCE[propsRef.current.colorIndex]);
    };
    const onUp = (e: PointerEvent) => pointers.delete(e.pointerId);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);

    // 視窗變更:重設畫布與貼圖(墨會清掉,可接受)。debounce 避免拖拉視窗時狂重建。
    let resizeTimer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        fit();
        fluid.resize();
      }, 250);
    });
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(resizeTimer);
      timeouts.forEach((t) => window.clearTimeout(t));
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      handleRef.current = null;
      fluid.destroy();
    };
    // 引擎只建一次;props 經 propsRef / onStaticRef 讀取。
    // sized：canvas 尺寸到位後重跑一次以建引擎（soft-nav/翻頁期間先 0 尺寸）。
    // retry：撞到暫時性 lost context 時重試。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sized, retry]);

  if (isStatic) return <StaticInk />;
  return (
    <div className="absolute inset-0">
      <canvas
        key={retry} // 重試時換一個全新 canvas：同一 canvas 的 context 一旦 lost 就再也拿不回好的
        ref={canvasRef}
        role="img"
        aria-label="墨流し互動水墨畫布:點擊滴墨、拖曳推動墨流"
        className="absolute inset-0 h-full w-full touch-none"
      />
      {/* 重播可讀層:帳目小字 + 角落月份/合計(不吃事件,手動玩墨時無內容) */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <AnimatePresence>
          {captions.map((c) => (
            <motion.div
              key={c.id}
              initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, filter: "blur(3px)", transition: { duration: 0.9 } }}
              transition={{ duration: 0.7, ease: "easeOut" }}
              className="absolute whitespace-nowrap text-[11px] tracking-wide text-ink/90"
              style={
                c.xPct > 70
                  ? { right: `${100 - c.xPct}%`, top: `${c.yPct}%`, marginRight: c.offset, marginTop: c.offsetY }
                  : { left: `${c.xPct}%`, top: `${c.yPct}%`, marginLeft: c.offset, marginTop: c.offsetY }
              }
            >
              <span className="opacity-70">{c.ledger}</span>
              <span className="mx-1 opacity-50">·</span>
              <span>{c.label}</span>
              <span className="ml-1.5 tabular-nums font-medium">${c.amount.toLocaleString("zh-TW")}</span>
              <span
                className="ml-1.5 mr-1 inline-block h-1.5 w-1.5 rounded-full align-[1px]"
                style={{ background: INK_COLORS[c.colorIndex].hex, opacity: 0.75 }}
              />
              <span>{c.payerName}</span>
            </motion.div>
          ))}
        </AnimatePresence>
        <AnimatePresence>
          {counting && replay && (
            <motion.div
              key="corner"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, transition: { duration: 0.8 } }}
              exit={{ opacity: 0, transition: { duration: 1.2 } }}
              className="absolute right-7 top-7 text-right"
            >
              <div className="text-xs tracking-[0.18em] text-text-3">{replay.title}</div>
              <RollingNumber
                value={total}
                format={(n) => `$${n.toLocaleString("zh-TW")}`}
                className="mt-1 block text-2xl font-semibold tabular-nums text-ink/85"
              />
              {/* 會計雙線:合計的記號 */}
              <div className="mt-2 space-y-[3px]">
                <div className="h-px bg-ink/55" />
                <div className="h-px bg-ink/55" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

// 降級:靜態和紙 + 四色預染墨漬(multiply 染進紙裡)+ 暗角
function StaticInk() {
  const blots = [
    { x: "26%", y: "30%", size: "34vmin", i: 0 },
    { x: "68%", y: "58%", size: "42vmin", i: 1 },
    { x: "44%", y: "72%", size: "26vmin", i: 2 },
    { x: "76%", y: "22%", size: "22vmin", i: 3 },
  ];
  return (
    <div className="absolute inset-0 bg-paper" aria-hidden>
      {/* 帳簿格線:空白行橫線 + 左緣直線(與 WebGL 版 shader 一致的語彙) */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, transparent 0 45px, rgba(35,31,25,0.045) 45px 46px)," +
            "linear-gradient(to right, transparent 75px, rgba(35,31,25,0.055) 75px, rgba(35,31,25,0.055) 76px, transparent 76px)",
        }}
      />
      {blots.map((b) => (
        <div
          key={b.i}
          className="absolute rounded-full mix-blend-multiply"
          style={{
            left: b.x,
            top: b.y,
            width: b.size,
            height: b.size,
            transform: "translate(-50%, -50%)",
            background: `radial-gradient(closest-side, ${INK_COLORS[b.i].hex}2e, ${INK_COLORS[b.i].hex}14 55%, transparent 72%)`,
          }}
        />
      ))}
      <div className="absolute inset-0" style={{ boxShadow: "inset 0 0 22vmax rgba(35, 31, 25, 0.1)" }} />
    </div>
  );
}
