# 室友月結分帳 · Roommate Monthly Split

給同住室友的網頁版分帳工具：平常各自記錄共同花費，系統即時算出每個人的淨額，月底一鍵結算出「誰該付誰多少」的**最少筆數**結清建議。

> **Status**: POC ・ **不串金流**（只算錢）・ 金額為整數 TWD ・ 以自然月為帳期

## 功能

- **記帳 / 分攤**：平均分攤（餘數由付款人吸收）或指定金額；每筆顯示「分給誰・每人多少」，單人分攤會點明「不影響其他人」
- **月結結清**：鎖定當月帳目（不可逆），用 greedy 債務最小化產生最少筆數的還款建議，可逐筆標記已付
- **跨月誰欠誰**：把所有未付清款項彙整成「對方還你 / 你還對方」的 pairwise 總覽
- **成員 / 邀請**：邀請連結加入；擁有者可移除成員、轉移擁有權、改名、軟刪除帳本（皆須先結清；被移除者可再受邀回來）
- **動態**：帳本最近異動（記帳 / 改 / 刪 / 標記已付 / 月結 / 加入）+ 未讀提示
- **從上月帶入**：月初把上一期的固定開銷（房租 / 水電）一鍵挑選帶入，平分自動依現役成員重算
- **首次引導**：空帳本三步上手；裝飾性首頁為互動水墨（WebGL）
- **質感與動效**：Editorial「帳簿」風（米白老紙、會計雙線、描邊印章），翻頁 / 落章 / 月結編排等動效，全部過 `prefers-reduced-motion` 降級；桌機雙欄、手機 RWD（底部 sheet、拇指熱區）

## 技術

Next.js 16（App Router · Turbopack）、React 19、Tailwind v4、better-sqlite3 + Drizzle ORM、bcrypt + httpOnly session cookie、`motion` 動效、自寫 WebGL2 流體首頁。

## 專案結構

```
app/   Next.js 應用程式（前端 + route handlers + SQLite）
```

> 功能規格、設計決策（ADR）與設計檔（Pencil `.pen` / DESIGN-SPEC / 預覽截圖）保留在本機（`roommate-monthly-split/`、`design/`），未納入版控。

## 開始開發

```bash
cd app
pnpm install          # 本專案用 pnpm（勿用 npm）
pnpm dev              # http://localhost:3000
```

- **資料庫**：首次啟動自動在 `app/data/app.db` 建立 SQLite（schema 於啟動時 idempotent 遷移）。此檔含使用者資料，**已被 gitignore，不會進版控**。
- 自訂路徑：`DB_PATH=/path/to.db pnpm dev`
- 其他：`pnpm build` / `pnpm start` / `pnpm lint`

> ⚠️ 本專案使用的 Next.js 版本與慣例可能與你熟悉的不同 —— 動程式前請先讀 `app/AGENTS.md`。
