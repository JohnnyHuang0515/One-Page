"use client";

import { useEffect, type RefObject } from "react";

// Modal/對話框的鍵盤無障礙：開啟時把焦點移入、Tab 在 modal 內循環（focus trap）、
// 關閉（卸載）時把焦點還給原本的觸發元素。Esc 關閉仍由各自的 useEscapeKey 處理。
// 容器需有 tabIndex={-1}（無可聚焦子元素時的退路）與 role="dialog" aria-modal aria-labelledby。
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function useDialog(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const prevFocus = document.activeElement as HTMLElement | null;

    const focusables = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement
      );

    // 移焦點進來：第一個可聚焦元素，否則容器本身。
    // 若 autoFocus 等已先把焦點放進 modal 內，就尊重它、不搶。
    if (!el.contains(document.activeElement)) (focusables()[0] ?? el).focus();

    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const f = focusables();
      if (f.length === 0) {
        e.preventDefault();
        el!.focus();
        return;
      }
      const first = f[0];
      const last = f[f.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === el)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }

    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("keydown", onKeyDown);
      // 還焦點給觸發元素（若仍在 DOM）。
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus();
    };
  }, [ref]);
}
