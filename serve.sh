#!/usr/bin/env bash
#
# 一頁帳 (One-Page) — macOS 一鍵部署：裝依賴 → build → 開 Cloudflare 快速通道 → 啟動
#
# 用法（在 repo 根目錄執行）：
#   ./serve.sh                 # 完整：安裝 + build + 開通道 + 啟動
#   SKIP_BUILD=1 ./serve.sh    # 重啟用：跳過 build（已 build 過時更快）
#   PORT=4000 ./serve.sh       # 換 port（預設 3000）
#
# 流程：
#   1. 確認 / 用 Homebrew 安裝 node、pnpm、cloudflared
#   2. app/ 底下 pnpm install + pnpm build
#   3. 開 cloudflared 快速通道（免費、隨機 https 網址），自動抓出公開網址
#   4. 用該網址設 APP_BASE_URL（邀請連結才會用公開網址）→ next start
#   按 Ctrl-C 會一起關閉通道與 app。
#
# 注意：
#   • 這台機器要一直開著，別人才連得到（app 跑在這台上）。
#   • 快速通道「每次重開網址都會變」，舊邀請連結會失效。
#     要固定網址需綁自己的網域（named tunnel）——跟我說再帶你設。
#   • 全新機器是空資料庫，需在公開網址上重新註冊帳號。

set -euo pipefail

PORT="${PORT:-3000}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$SCRIPT_DIR/app"

say()  { printf '\033[1;36m▶ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m⚠ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m✖ %s\033[0m\n' "$*" >&2; exit 1; }

# ── 0. Homebrew（找不到就試常見路徑載入，再沒有就請使用者先裝）──
if ! command -v brew >/dev/null 2>&1; then
  for b in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    [ -x "$b" ] && eval "$("$b" shellenv)" && break
  done
fi
command -v brew >/dev/null 2>&1 || die "找不到 Homebrew。先到 https://brew.sh 安裝，再重跑 ./serve.sh"

# ── 1. Xcode Command Line Tools（better-sqlite3 萬一需要從原始碼編譯時要用）──
if ! xcode-select -p >/dev/null 2>&1; then
  warn "未偵測到 Xcode Command Line Tools，開啟安裝視窗…"
  xcode-select --install || true
  die "請等 Command Line Tools 裝完，再重新執行 ./serve.sh"
fi

# ── 2. 套件：node / pnpm / cloudflared（缺什麼補什麼）──
ensure() { command -v "$1" >/dev/null 2>&1 || { say "安裝 $2 …"; brew install "$2"; }; }
ensure node node
ensure pnpm pnpm
ensure cloudflared cloudflared

# ── 3. 依賴 + build ──
cd "$APP_DIR"
mkdir -p data
say "安裝依賴（pnpm install，首次會編譯 better-sqlite3，可能要幾分鐘）…"
pnpm install
if [ "${SKIP_BUILD:-0}" != "1" ]; then
  say "建置 production（pnpm build）…"
  pnpm build
fi

# ── 4. 開 Cloudflare 快速通道，抓公開網址 ──
TUNNEL_LOG="$(mktemp -t one-page-tunnel)"
CF_PID=""
APP_PID=""
cleanup() {
  printf '\n'; say "關閉中…"
  [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
  [ -n "$CF_PID" ] && kill "$CF_PID" 2>/dev/null || true
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT INT TERM

say "開啟 Cloudflare 快速通道（指向 http://localhost:${PORT}）…"
cloudflared tunnel --url "http://localhost:$PORT" >"$TUNNEL_LOG" 2>&1 &
CF_PID=$!

URL=""
for _ in $(seq 1 60); do
  URL="$(grep -Eo 'https://[a-z0-9.-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$CF_PID" 2>/dev/null || { echo "--- cloudflared 輸出 ---"; cat "$TUNNEL_LOG"; die "cloudflared 啟動失敗"; }
  sleep 1
done
[ -n "$URL" ] || { echo "--- cloudflared 輸出 ---"; cat "$TUNNEL_LOG"; die "60 秒內沒抓到通道網址"; }

# ── 5. 帶 APP_BASE_URL 啟動 app ──
printf '\n\033[1;32m──────────────────────────────────────────────\033[0m\n'
printf '  公開網址： \033[1;32m%s\033[0m\n' "$URL"
printf '  （邀請連結會自動用這個網址）\n'
printf '  本機測試： http://localhost:%s\n' "$PORT"
printf '  按 Ctrl-C 一起關閉 app 與通道\n'
printf '\033[1;32m──────────────────────────────────────────────\033[0m\n\n'

say "啟動 app（next start，port ${PORT}）…"
# 直接呼叫 next（不用 pnpm start）—— 經 pnpm start 傳 -p 會被多包一層 `--`，next 會忽略而退回 3000。
APP_BASE_URL="$URL" pnpm exec next start -p "$PORT" &
APP_PID=$!

wait "$APP_PID"
