import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 換頁動畫：啟用 React <ViewTransition>（方向性翻頁滑動）。
  // 無瀏覽器支援時自動降級為瞬間切換，不影響功能。
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
