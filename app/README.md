# 室友分帳（Roommate Monthly Split）

室友共同開銷月結分帳的 POC Web App。平常各自記錄共同花費，系統即時算出每個人的淨額，月底一鍵結算出「誰該付誰多少」的最少筆數結清建議。

- 規格：見上層 [`../roommate-monthly-split/`](../roommate-monthly-split/)（9 份文件 + ADR）
- 設計：見上層 [`../design/`](../design/)（Pencil 帳簿風 v3 + `DESIGN-SPEC.md` + 截圖）

## 技術棧

- **Next.js 16**（App Router，前後端同一 codebase）
- **SQLite**（better-sqlite3）+ **Drizzle ORM** — DB 檔自動建立在 `data/app.db`
- **Tailwind v4** + Phosphor Icons — Editorial Ledger 帳簿風（見 `src/app/globals.css` token）
- 認證：httpOnly Session Cookie；密碼 bcrypt 雜湊

## 開發

```bash
pnpm install
pnpm dev          # http://localhost:3000
```

啟動時會自動建表（`src/lib/db.ts` 內含 idempotent migration），不需額外 migrate 步驟。

```bash
pnpm build        # production 建置
pnpm start        # 跑 production
```

## 快速體驗

註冊任意帳號即可開始。操作流程：註冊/登入 → 建立帳本 → 邀請室友（複製連結）→ 記一筆花費（平均/指定金額）→ 看即時淨額 → 月底執行月結 → 標記結清付清。

## 核心邏輯位置

| 檔案 | 負責 |
|------|------|
| `src/lib/schema.ts` | 8 個 entity（§3 domain model） |
| `src/lib/split.ts` | 分攤計算（BR-1 加總、BR-3 餘數歸付款人少出） |
| `src/lib/settle.ts` | greedy 債務最小化（D-0005）+ 淨額計算 |
| `src/lib/guards.ts` | 成員授權、帳期鎖定（BR-4/10） |
| `src/app/api/**` | 17 個 REST endpoint（§6 interfaces） |
| `src/app/ledgers/[id]/page.tsx` | P-3 帳本主頁（核心） |

## POC 範圍與限制

不串實際金流（只計算、付清自行標記）、單一幣別（TWD）、無主動通知、淺色主題、結算後該月鎖定不可逆。詳見規格 §1.5。
