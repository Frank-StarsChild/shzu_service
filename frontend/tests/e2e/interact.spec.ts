import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// PLAN S7：联动——高亮、拾取、点击。全部 /?3d=1 打开；截图前先隐藏 campus-overlay。

type Hotspot = { board: string; pick: [number, number, number] };

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
) as { hotspots: Hotspot[] };

const pickOf = (board: string) => metaRaw.hotspots.find((h) => h.board === board)!.pick;

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, {
    timeout: 20_000,
  });
}

/** 沙盘在首屏折叠线以下：用原始鼠标坐标前先滚到沙盘（locator 动作自带滚动，mouse.move 不带）。 */
async function scrollToSandbox(page: Page) {
  await page.locator('[data-testid="campus-hero"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(100);
}

async function hideOverlay(page: Page) {
  await page.addStyleTag({ content: "[data-testid=campus-overlay] { visibility: hidden !important; }" });
}

async function redRatio(page: Page): Promise<number> {
  const buf = await page.locator('[data-testid="campus-canvas"]').screenshot();
  const png = PNG.sync.read(buf);
  let red = 0;
  const total = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i] > 170 && png.data[i + 1] < 70 && png.data[i + 2] < 70) red += 1;
  }
  return red / total;
}

async function canvasPointOf(page: Page, scenePoint: [number, number, number]) {
  return page.evaluate(
    (pt) => {
      const r = window.__campus3d.projectPoint(pt);
      return { x: r.x, y: r.y, visible: r.visible };
    },
    scenePoint
  );
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 高亮像素统计：无高亮 <0.05% → 教务高亮 >0.3%", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await hideOverlay(page);

  const base = await redRatio(page);
  expect(base, `无高亮时红色占比 ${(base * 100).toFixed(3)}%`).toBeLessThan(0.0005);

  await page.locator('.board-tile[data-board="教务"]').hover();
  await page.waitForFunction(
    () => window.__campus3d.stop === "jw" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(200);

  const lit = await redRatio(page);
  expect(lit, `教务高亮时红色占比 ${(lit * 100).toFixed(2)}%`).toBeGreaterThan(0.003);

  await page.locator('[data-testid="campus-hero"]').screenshot({
    path: "../docs/3d/shots/S7-jw.png",
  });
});

test("2 画布拾取：指向图书馆楼 → hoveredBoard + 按钮高亮 + 镜头不动 + cursor", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await scrollToSandbox(page);

  const p = await canvasPointOf(page, pickOf("图书馆"));
  await page.mouse.move(p.x, p.y);
  await page.waitForFunction(() => window.__campus3d.hoveredBoard === "图书馆", undefined, {
    timeout: 5_000,
  });

  await expect(page.locator('.board-tile[data-board="图书馆"]')).toHaveClass(/is-active/);
  const h = await page.evaluate(() => ({
    stop: window.__campus3d.stop,
    moving: window.__campus3d.moving,
  }));
  expect(h.stop).toBe("overview");
  expect(h.moving).toBe(false);
  const cursor = await page
    .locator('[data-testid="campus-canvas"]')
    .evaluate((el) => getComputedStyle(el).cursor);
  expect(cursor).toBe("pointer");
});

test("3 点击图书馆楼 → /services?board=图书馆", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await scrollToSandbox(page);

  const p = await canvasPointOf(page, pickOf("图书馆"));
  await page.mouse.move(p.x, p.y);
  await page.waitForFunction(() => window.__campus3d.hoveredBoard === "图书馆", undefined, {
    timeout: 5_000,
  });
  await page.mouse.down();
  await page.mouse.up();
  await expect(page).toHaveURL(/\/services/);
  expect(decodeURIComponent(new URL(page.url()).search)).toContain("board=图书馆");
});

test("4 空白画布角落：hoveredBoard 为空、无按钮高亮", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await scrollToSandbox(page);

  const box = (await page.locator('[data-testid="campus-canvas"]').boundingBox())!;
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.waitForTimeout(300);

  const h = await page.evaluate(() => window.__campus3d.hoveredBoard);
  expect(h).toBeNull();
  const actives = await page.locator(".board-tile.is-active").count();
  expect(actives).toBe(0);
});

test("5 按下后拖 30px 再抬起：不触发点击（地址不变）", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await scrollToSandbox(page);

  const p = await canvasPointOf(page, pickOf("图书馆"));
  await page.mouse.move(p.x, p.y);
  await page.waitForFunction(() => window.__campus3d.hoveredBoard === "图书馆", undefined, {
    timeout: 5_000,
  });
  await page.mouse.down();
  await page.mouse.move(p.x + 30, p.y + 30, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  expect(new URL(page.url()).pathname).toBe("/classic");
});

test("6 五个热点逐个拾取都命中（pick 点可点性）", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await scrollToSandbox(page);

  for (const h of metaRaw.hotspots) {
    const p = await canvasPointOf(page, h.pick);
    await page.mouse.move(p.x, p.y);
    await page.waitForFunction(
      (board) => window.__campus3d.hoveredBoard === board,
      h.board,
      { timeout: 5_000 }
    );
  }
});

test("7 轮换高亮 20 次后：highlightMaterials ≤1，geometries/textures 不变", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);

  const before = await page.evaluate(() => ({
    hm: window.__campus3d.highlightMaterials,
    geo: window.__campus3d.geometries,
    tex: window.__campus3d.textures,
  }));

  const boards = ["学工", "教务", "后勤", "保卫", "图书馆"];
  for (let i = 0; i < 20; i++) {
    await page.locator(`.board-tile[data-board="${boards[i % 5]}"]`).hover();
    await page.waitForTimeout(40);
  }

  const after = await page.evaluate(() => ({
    hm: window.__campus3d.highlightMaterials,
    geo: window.__campus3d.geometries,
    tex: window.__campus3d.textures,
  }));
  expect(after.hm, "克隆高亮材质数").toBeLessThanOrEqual(1);
  expect(after.geo).toBe(before.geo);
  expect(after.tex).toBe(before.tex);
});
