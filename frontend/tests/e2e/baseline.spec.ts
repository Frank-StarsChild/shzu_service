import { expect, test } from "@playwright/test";
import { mockApi } from "./fixtures/api";

/**
 * 回归护栏（PLAN S1 第 7 步）：以后的步骤不许改这个文件。
 * 后端不启动，/api 由 fixtures/api.ts 拦截。
 */
test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("首页：标题含「校园办事」，板块按钮恰好 5 个", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1.h-display")).toContainText("校园办事");
  await expect(page.locator(".board-tile")).toHaveCount(5);
});

test("点第 5 个板块按钮，地址变成 /services?board=图书馆", async ({ page }) => {
  await page.goto("/");
  await page.locator(".board-tile").nth(4).click();
  await expect(page).toHaveURL(/\/services/);
  const url = new URL(page.url());
  // 比较前先 decodeURIComponent（中文名称会被编码）
  expect(decodeURIComponent(url.search)).toContain("board=图书馆");
});

test("首页输入「借书」提交，路径变成 /chat", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("输入问题").fill("借书");
  await page.locator(".composer button[type=submit]").click();
  // 对话页会把 q 参数读走后清掉，所以只断言路径
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe("/chat");
});

test("WebGL2 探针：测试浏览器可取得 webgl2 上下文", async ({ page }) => {
  await page.goto("/");
  const hasWebgl2 = await page.evaluate(() => {
    const c = document.createElement("canvas");
    return c.getContext("webgl2") !== null;
  });
  expect(hasWebgl2).toBe(true);
});
