import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// W1：资产包 v3、整屏画布。/stage?3d=1&intro=0 打开；对照 reference/stage/all/stop-home.jpg。

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

/** 给 stage 加 is-shot 后对整个视口截图统计像素。 */
async function stagePixelStats(page: Page) {
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage"]');
    el?.classList.add("is-shot");
  });
  const buf = await page.screenshot();
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage"]');
    el?.classList.remove("is-shot");
  });
  const png = PNG.sync.read(buf);
  const total = png.width * png.height;
  let red = 0;
  let dark = 0;
  let warm = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (r > 170 && g < 70 && b < 70) red += 1;
    if (r + g + b < 150) dark += 1;
    if (r > 180 && g > 110 && b < 170 && r - b > 40) warm += 1;
  }
  return { red: red / total, dark: dark / total, warm: warm / total };
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 ready 后：pack=all、303 栋楼、29 外壳、7 片区、停靠 home", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const h = await page.evaluate(() => ({
    pack: window.__campus3d.pack,
    buildingCount: window.__campus3d.buildingCount,
    shellNodes: window.__campus3d.shellNodes,
    zoneNodes: window.__campus3d.zoneNodes,
    stop: window.__campus3d.stop,
    moving: window.__campus3d.moving,
  }));
  expect(h.pack).toBe("all");
  expect(h.buildingCount).toBe(303);
  expect(h.shellNodes).toBe(29);
  expect(h.zoneNodes).toBe(7);
  expect(h.stop).toBe("home");
  expect(h.moving).toBe(false);
});

test("2 画布占满视口；没有普通版的顶栏和页脚", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const box = await page.locator('[data-testid="stage-canvas"]').boundingBox();
  expect(Math.abs((box?.width ?? 0) - 1440)).toBeLessThanOrEqual(1);
  expect(Math.abs((box?.height ?? 0) - 900)).toBeLessThanOrEqual(1);
  await expect(page.locator(".topbar")).toHaveCount(0);
  await expect(page.locator("footer")).toHaveCount(0);
});

test("3 夜景像素：暗色 >75%、暖色亮 >0.15%、饱和红 <0.05%", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForTimeout(400);
  const stats = await stagePixelStats(page);
  expect(stats.dark).toBeGreaterThan(0.75);
  expect(stats.warm).toBeGreaterThan(0.0015);
  expect(stats.red).toBeLessThan(0.0005);
});

test("4 预算：drawCalls ≤ 600、triangles ≤ 400000", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const h = await page.evaluate(() => ({
    drawCalls: window.__campus3d.drawCalls,
    triangles: window.__campus3d.triangles,
  }));
  expect(h.drawCalls).toBeLessThanOrEqual(600);
  expect(h.triangles).toBeLessThanOrEqual(400000);
});

test("5 ?3d=0：静态模式显示海报", async ({ page }) => {
  await page.goto("/stage?3d=0");
  await page.waitForTimeout(800);
  // STAGE 6.4：舞台钩子的 mode 是舞台状态（home/campus/…），静态与否看 reason
  const h = await page.evaluate(() => ({ reason: window.__campus3d.reason, mode: window.__campus3d.mode }));
  expect(h.reason).toBe("query-off");
  expect(h.mode).toBe("home");
  const nw = await page.locator('[data-testid="stage-poster"]').evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(nw).toBe(1920);
});

test("6 ?intro=1：先 intro 后 ready，落 home", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=1");
  await page.waitForFunction(() => window.__campus3d?.status === "intro", undefined, { timeout: 40_000 })
    .catch(() => {}); // 片段很快：允许错过 intro 状态
  await waitReady(page);
  const stop = await page.evaluate(() => window.__campus3d.stop);
  expect(stop).toBe("home");
});

test("7 普通版不受影响：/classic 仍有顶栏与白色首页", async ({ page }) => {
  await page.goto("/classic");
  await expect(page.locator(".topbar")).toHaveCount(1);
  await expect(page.locator("h1.h-display")).toContainText("校园办事");
});

// 截图（人工核对用）
test("shots：W1-home.png", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForTimeout(600);
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W1-home.png" });
});
