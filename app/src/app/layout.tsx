import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_TC } from "next/font/google";
import { ToastProvider } from "@/components/toast";
import { PageTransition } from "@/components/page-transition";
import "./globals.css";

// §5.4: Geist for Latin/numerals, Noto Sans TC for Chinese
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const notoSansTC = Noto_Sans_TC({ variable: "--font-noto-tc", subsets: ["latin"], weight: ["400", "500", "700"] });

export const metadata: Metadata = {
  title: "分帳 — 室友月結分帳",
  description: "室友共同花費，月底一鍵結清",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-TW"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansTC.variable} h-full antialiased`}
      // 瀏覽器擴充(如沉浸式翻譯)會在 hydrate 前往 <html> 注入屬性,只壓這個元素的屬性比對警告
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col bg-paper text-ink font-[family-name:var(--font-geist-sans),var(--font-noto-tc),sans-serif]">
        {/* 隱藏的 SVG 濾鏡：印章墨感（feTurbulence + 位移）。供 .stamp-ink 使用 */}
        <svg className="pointer-events-none absolute h-0 w-0" aria-hidden focusable="false">
          <filter id="stamp-ink">
            <feTurbulence type="fractalNoise" baseFrequency="0.012 0.022" numOctaves="2" seed="7" result="noise" />
            <feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </svg>

        {/* 紙張顆粒：固定、不吃事件、極淡。絕不放在捲動容器上（§6.E） */}
        <div className="paper-grain" aria-hidden />

        <ToastProvider>
          <PageTransition>{children}</PageTransition>
        </ToastProvider>
      </body>
    </html>
  );
}
