// 產出 5 張與 Pencil mockup 同視角的真實畫面（P-1 / P-2 / P-3 OPEN / P-3 SETTLED / P-4）
import { chromium } from "playwright-core";

const BASE = "http://localhost:3100";
const OUT = "/Users/chieh/Documents/github專案/分帳/design/app-preview";
const [LA, LB, JOINCODE] = process.argv.slice(2);

const browser = await chromium.launch({ channel: "chrome" });

async function newPage(ctx) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  return page;
}

async function login(page, email) {
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill(email);
  await page.locator('input[type="password"]').fill("password1");
  await page.getByRole("button", { name: "登入", exact: true }).last().click();
  await page.waitForURL("**/ledgers", { timeout: 15000 });
}

// P-1 登入頁（未登入）
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await page.goto(`${BASE}/login`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/p1-login.png` });
  await ctx.close();
}

// 小明視角：P-2 / P-3 OPEN / P-3 SETTLED
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await login(page, "ming@test.tw");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/p2-ledgers.png` });

  await page.goto(`${BASE}/ledgers/${LA}`);
  await page.waitForLoadState("networkidle");
  await page.getByText("花費明細").waitFor();
  await page.screenshot({ path: `${OUT}/p3-ledger-open.png` });

  await page.goto(`${BASE}/ledgers/${LB}`);
  await page.waitForLoadState("networkidle");
  await page.getByText("結清建議").waitFor();
  await page.screenshot({ path: `${OUT}/p3-ledger-settled.png` });
  await ctx.close();
}

// 小華視角（非成員）：P-4 邀請落地頁
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await login(page, "hua@test.tw");
  await page.goto(`${BASE}/join/${JOINCODE}`);
  await page.waitForLoadState("networkidle");
  await page.getByText("加入帳本", { exact: false }).first().waitFor();
  await page.screenshot({ path: `${OUT}/p4-join.png` });
  await ctx.close();
}

await browser.close();
console.log("DONE");
