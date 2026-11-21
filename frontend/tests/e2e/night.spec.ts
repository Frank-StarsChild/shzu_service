import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// N1：夜景资产、H_ 高亮件、高亮像素统计。全部 /?3d=1 打开。

type Hotspot = { board: string; buildingId: string };
const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
) as { hotspots: Hotspot[] };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 25_000 });
}

async function hideOverlay(page: Page) {
  await page.addStyleTag({
    content:
      "[data-testid=campus-overlay], .campus-hud, .campus-fx { visibility: hidden !important; }",
  });
}

/** 悬停板块并确认 activeBoard 仍在该板块（异步组件挂载会引起一次布局移动，可能丢失 hover）。 */
async function hoverBoard(page: Page, board: string) {
  // 像素统计类用例用程序化 mouseenter：真实指针会被布局移动打断，交互本身由 interact.spec 覆盖
  await page.evaluate((b) => {
    const el = document.querySelector(`.board-tile[data-board="${b}"]`);
    el?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
  }, board);
  await page.waitForFunction(
    (b) => window.__campus3d.activeBoard === b,
    board,
    { timeout: 5_000 }
  );
}

/** 把沙盘滚到视口中央，避免固定顶栏盖在画布截图上。 */
async function centerSandbox(page: Page) {
  await page.locator('[data-testid="campus-hero"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
}

/** 软件渲染下一帧可能要几百毫秒：等到确有新帧再截图，避免截到状态变化前的旧画面。 */
async function freshFrames(page: Page, n = 2) {
  const f = await page.evaluate(() => window.__campus3d.frames);
  await page.waitForFunction(
    (arg) => window.__campus3d.frames >= arg.f + arg.n,
    { f, n },
    { timeout: 20_000 }
  );
}

async function pixelStats(page: Page) {
  await centerSandbox(page);
  const buf = await page.locator('[data-testid="campus-canvas"]').screenshot();
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

test("1 ready 后资产为 v2、hotNodes=5、无高亮", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  const h = await page.evaluate(() => ({
    assetVersion: window.__campus3d.assetVersion,
    hotNodes: window.__campus3d.hotNodes,
    hotVisible: window.__campus3d.hotVisible,
  }));
  expect(h.assetVersion).toBe("v2");
  expect(h.hotNodes).toBe(5);
  expect(h.hotVisible).toBeNull();
});

test("2 夜景像素：红色≈0、暗色 >50%、暖色亮窗 >0.1%", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await hideOverlay(page);
  await freshFrames(page);
  const s = await pixelStats(page);
  expect(s.red, `饱和红色 ${(s.red * 100).toFixed(3)}%`).toBeLessThan(0.0005);
  expect(s.dark, `暗色 ${(s.dark * 100).toFixed(1)}%`).toBeGreaterThan(0.5);
  expect(s.warm, `暖色亮窗 ${(s.warm * 100).toFixed(2)}%`).toBeGreaterThan(0.001);
});

test("3 悬停教务 → hotVisible 正确、红色 >0.3%、无克隆材质", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await hideOverlay(page);
  await hoverBoard(page, "教务");
  await page.waitForFunction(
    () => window.__campus3d.stop === "jw" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(400);
  await freshFrames(page);
  const h = await page.evaluate(() => ({
    hotVisible: window.__campus3d.hotVisible,
    highlightMaterials: window.__campus3d.highlightMaterials,
  }));
  expect(h.hotVisible).toBe(metaRaw.hotspots[1].buildingId);
  expect(h.highlightMaterials).toBe(0);
  const s = await pixelStats(page);
  expect(s.red, `高亮红色 ${(s.red * 100).toFixed(2)}%`).toBeGreaterThan(0.003);

  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.locator('[data-testid="campus-hero"]').screenshot({ path: "../docs/3d/shots/N1-jw.png" });
});

test("4 移开后回到全景且无红色", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await hideOverlay(page);
  await hoverBoard(page, "教务");
  await page.waitForFunction(() => window.__campus3d.hotVisible !== null, undefined, { timeout: 5_000 });
  await page.evaluate(() =>
    document.querySelectorAll(".board-tile").forEach((el) =>
      el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true }))
    )
  );
  await page.waitForFunction(
    () => window.__campus3d.stop === "overview" && window.__campus3d.moving === false && window.__campus3d.hotVisible === null,
    undefined,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(400);
  await freshFrames(page);
  const s = await pixelStats(page);
  expect(s.red).toBeLessThan(0.0005);
});

test("5 依次悬停 5 个板块，hotVisible 各自正确", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  for (const h of metaRaw.hotspots) {
    await hoverBoard(page, h.board);
    await page.waitForFunction(
      (id) => window.__campus3d.hotVisible === id,
      h.buildingId,
      { timeout: 8_000 }
    );
  }
});

test("6 来回 20 次后 geometries/textures 不变", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  const before = await page.evaluate(() => ({
    geo: window.__campus3d.geometries,
    tex: window.__campus3d.textures,
  }));
  const boards = metaRaw.hotspots.map((h) => h.board);
  for (let i = 0; i < 20; i++) {
    await hoverBoard(page, boards[i % 5]);
    await page.waitForTimeout(40);
  }
  const after = await page.evaluate(() => ({
    geo: window.__campus3d.geometries,
    tex: window.__campus3d.textures,
  }));
  expect(after.geo).toBe(before.geo);
  expect(after.tex).toBe(before.tex);
});