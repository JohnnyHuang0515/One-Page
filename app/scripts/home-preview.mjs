// P-0 墨流し首頁驗證:未登入(自動演出+拖曳)/ 已登入(帳本重播)各截一張
import { chromium } from "playwright-core";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "/Users/chieh/Documents/github專案/分帳/design/app-preview";

const browser = await chromium.launch({ channel: "chrome", args: ["--use-gl=angle"] });

async function newPage(ctx) {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: 1440, height: 900 });
  page.on("console", (m) => {
    if (m.type() === "error") console.log("[console.error]", m.text());
  });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  return page;
}

// 未登入:等自動演出滴幾滴 → 截圖;再拖曳推墨 → 截圖
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "登入" }).waitFor();
  console.log("logged-out: control bar OK (登入 entry)");
  await page.waitForTimeout(7000); // 第一滴 1.6s + 暈開
  await page.screenshot({ path: `${OUT}/p0-home-guest.png` });

  // 點擊滴墨 + 拖曳推墨
  await page.mouse.click(500, 380);
  await page.waitForTimeout(800);
  await page.mouse.move(420, 500);
  await page.mouse.down();
  for (let i = 0; i <= 40; i++) {
    const t = i / 40;
    await page.mouse.move(420 + 560 * t, 500 + Math.sin(t * Math.PI * 2) * 130, { steps: 1 });
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/p0-home-drag.png` });

  // 洗い流す
  await page.getByRole("button", { name: "洗い流す" }).click();
  await page.waitForTimeout(2600);
  await page.screenshot({ path: `${OUT}/p0-home-washed.png` });
  await ctx.close();
}

// 已登入(小明):自動演出 = 重播帳本當月,入口變「帳本」
{
  const ctx = await browser.newContext();
  const page = await newPage(ctx);
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("you@example.com").fill("ming@test.tw");
  await page.locator('input[type="password"]').fill("password1");
  await page.getByRole("button", { name: "登入", exact: true }).last().click();
  await page.waitForURL("**/ledgers", { timeout: 15000 });
  await page.goto(`${BASE}/`);
  await page.getByRole("button", { name: "帳本" }).waitFor();
  console.log("logged-in: control bar OK (帳本 entry)");
  await page.waitForTimeout(12000); // 重播 4-5 筆
  await page.screenshot({ path: `${OUT}/p0-home-replay.png` });

  // 入口導航
  await page.getByRole("button", { name: "帳本" }).click();
  await page.waitForURL("**/ledgers", { timeout: 10000 });
  console.log("entry → /ledgers OK");
  await ctx.close();
}

await browser.close();
console.log("DONE");
