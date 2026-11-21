import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// PLAN S4：能力判定（浏览器侧，钩子字段 mode/reason）。
// 无头浏览器是软件渲染（swiftshader 启动参数），按规则会进静态版；
// 后面所有测 3D 的用例都用 /?3d=1 打开。

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

/** HomeView 是懒加载路由，钩子在挂载后才存在：先等它就结再读。 */
async function readHook(page: Page): Promise<{ mode: string; reason: string }> {
  await page.waitForFunction(() => typeof window.__campus3d?.reason === "string");
  return page.evaluate(() => ({
    mode: window.__campus3d.mode,
    reason: window.__campus3d.reason,
  }));
}

test("/1 强制开 3D → scene / query-on", async ({ page }) => {
  await page.goto("/classic?3d=1");
  expect(await readHook(page)).toEqual({ mode: "scene", reason: "query-on" });
});

test("/0 强制静态 → static / query-off", async ({ page }) => {
  await page.goto("/?3d=0");
  expect(await readHook(page)).toEqual({ mode: "static", reason: "query-off" });
});

test("/classic 默认（无头=软件渲染）→ static / software-gl，开关可见且文字含「开启」", async ({ page }) => {
  await page.goto("/classic");
  expect(await readHook(page)).toEqual({ mode: "static", reason: "software-gl" });
  await expect(page.locator('[data-testid="campus-toggle"]')).toBeVisible();
  await expect(page.locator('[data-testid="campus-toggle"]')).toContainText("开启");
});

test("视口 390 → small-viewport，开关不显示", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/classic");
  expect((await readHook(page)).reason).toBe("small-viewport");
  await expect(page.locator('[data-testid="campus-toggle"]')).toHaveCount(0);
});

test("减少动态偏好 → reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/classic");
  expect(await readHook(page)).toEqual({ mode: "static", reason: "reduced-motion" });
});

test("localStorage 预置 off → user-off", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shzu.campus3d", "off"));
  await page.goto("/classic");
  expect(await readHook(page)).toEqual({ mode: "static", reason: "user-off" });
});

test("点开关「开启 3D 沙盘」→ mode 变 scene，localStorage 键被删", async ({ page }) => {
  await page.goto("/classic");
  await page.waitForFunction(() => typeof window.__campus3d?.reason === "string");
  await page.locator('[data-testid="campus-toggle"]').click();
  const h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    reason: window.__campus3d.reason,
    stored: localStorage.getItem("shzu.campus3d"),
  }));
  expect(h.mode).toBe("scene");
  expect(h.reason).toBe("query-on");
  expect(h.stored).toBeNull();
});
