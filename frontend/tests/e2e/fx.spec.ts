import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// N3：动效循环（滚动 FX 贴图）与耗电控制。

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 25_000 });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 ready 后 looping=true；持续出帧", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  await page.waitForFunction(() => window.__campus3d.looping === true, undefined, { timeout: 5_000 });
  const f1 = await page.evaluate(() => window.__campus3d.frames);
  // 无头软件渲染每帧较慢（实测约 1 秒/帧），按 3 秒窗口检查持续出帧
  await page.waitForTimeout(3000);
  const f2 = await page.evaluate(() => window.__campus3d.frames);
  expect(f2 - f1).toBeGreaterThanOrEqual(3);
  expect(f2 - f1).toBeLessThanOrEqual(108);
});

test("2 1 秒后 fxOffset 变化，且始终在 0–1", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  const a = await page.evaluate(() => window.__campus3d.fxOffset);
  await page.waitForFunction(
    (old) => window.__campus3d.fxOffset !== old,
    a,
    { timeout: 20_000 }
  );
  const b = await page.evaluate(() => window.__campus3d.fxOffset);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(a).toBeLessThanOrEqual(1);
  expect(b).toBeGreaterThanOrEqual(0);
  expect(b).toBeLessThanOrEqual(1);
  expect(b).not.toBe(a);
});

test("3 两次截图间隔 1.2 秒，画面确有变化", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  await page.addStyleTag({ content: "[data-testid=campus-overlay] { visibility: hidden !important; }" });
  const a = PNG.sync.read(await page.locator('[data-testid="campus-canvas"]').screenshot());
  const f0 = await page.evaluate(() => window.__campus3d.frames);
  await page.waitForFunction((f) => window.__campus3d.frames >= f + 2, f0, { timeout: 20_000 });
  const b = PNG.sync.read(await page.locator('[data-testid="campus-canvas"]').screenshot());
  expect(a.width).toBe(b.width);
  let changed = 0;
  const total = a.width * a.height;
  for (let i = 0; i < a.data.length; i += 4) {
    const d =
      Math.abs(a.data[i] - b.data[i]) +
      Math.abs(a.data[i + 1] - b.data[i + 1]) +
      Math.abs(a.data[i + 2] - b.data[i + 2]);
    if (d > 40) changed += 1;
  }
  expect(changed / total, `变化像素 ${((changed / total) * 100).toFixed(2)}%`).toBeGreaterThan(0.002);
});

test("4 滚出视口 → looping=false 且停帧；滚回恢复", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  await page.addStyleTag({ content: "body { padding-bottom: 3000px; }" });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => window.__campus3d.looping === false, undefined, { timeout: 8_000 });
  const f1 = await page.evaluate(() => window.__campus3d.frames);
  await page.waitForTimeout(1000);
  const f2 = await page.evaluate(() => window.__campus3d.frames);
  expect(f2 - f1).toBe(0);

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.__campus3d.looping === true, undefined, { timeout: 3_000 });
});

test("5 减少动态：looping=false、fxOffset=0、不渲染", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  expect(await page.evaluate(() => window.__campus3d.looping)).toBe(false);
  expect(await page.evaluate(() => window.__campus3d.fxOffset)).toBe(0);
  const f1 = await page.evaluate(() => window.__campus3d.frames);
  await page.waitForTimeout(1000);
  const f2 = await page.evaluate(() => window.__campus3d.frames);
  expect(f2 - f1).toBe(0);
});

test("6 循环中悬停图书馆：照常到位、高亮正确", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  await page.locator('.board-tile[data-board="图书馆"]').hover();
  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  const h = await page.evaluate(() => ({
    hotVisible: window.__campus3d.hotVisible,
    looping: window.__campus3d.looping,
  }));
  expect(h.hotVisible).toBe("ZQ-B034");
  expect(h.looping).toBe(true);
});

test("7 切到服务目录后 frames 停止增长", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  await page.getByRole("link", { name: "服务目录" }).click();
  await page.waitForURL(/\/services/);
  await page.waitForTimeout(1000);
  const f1 = await page.evaluate(() => window.__campus3d.frames);
  await page.waitForTimeout(1000);
  const f2 = await page.evaluate(() => window.__campus3d.frames);
  expect(f2 - f1).toBe(0);
});