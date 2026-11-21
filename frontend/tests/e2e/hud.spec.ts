import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// N2：黑色画框、四角信息条、新标记样式、服务数量。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
) as {
  look: {
    hud: {
      title: string;
      subtitle: string;
      coord: string;
      scaleLabel: string;
      scale100: Record<string, [[number, number, number], [number, number, number]]>;
      scalePoster: { desktop: number; mobile: number };
    };
  };
  hotspots: { board: string; label: string; note?: string }[];
  buildings: Record<string, unknown>;
};

const svc = (id: string, board: string) => ({
  service_id: id,
  name: `${board}服务 ${id}`,
  board,
  summary: "测试数据",
  evidence_ids: ["e1"],
  flow_id: null,
  data_status: "reviewed",
  sample_questions: [],
});

async function mockServices(page: Page) {
  await page.route("**/api/v1/services*", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        services: [
          svc("lib-1", "图书馆"),
          svc("lib-2", "图书馆"),
          svc("lib-3", "图书馆"),
          svc("jw-1", "教务"),
        ],
        knowledge_version: "kb-test-000",
      }),
    })
  );
}

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 25_000 });
}

/** 程序化 mouseenter（真实指针会被布局移动打断；交互本身由 interact.spec 覆盖）。 */
async function activateBoard(page: Page, board: string) {
  // 等沙盘组件（异步分包）挂载好、钩子就绪
  await page.waitForFunction(
    () => !!window.__campus3d && document.querySelectorAll(".campus-marker").length === 5,
    undefined,
    { timeout: 10_000 }
  );
  for (let i = 0; i < 4; i++) {
    await page.evaluate((b) => {
      const el = document.querySelector(`.board-tile[data-board="${b}"]`);
      el?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
    }, board);
    await page.waitForTimeout(150);
    if ((await page.evaluate(() => window.__campus3d.activeBoard)) === board) return;
  }
  throw new Error(`无法激活板块「${board}」`);
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await mockServices(page);
});

test("1 画框背景、标题、坐标信息条", async ({ page }) => {
  await page.goto("/?3d=0");
  const bg = await page
    .locator('[data-testid="campus-hero"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(5, 8, 13)");

  const title = page.locator('[data-testid="campus-hud-title"]');
  await expect(title).toContainText(metaRaw.look.hud.title);
  await expect(title).toContainText(metaRaw.look.hud.subtitle);

  const coord = page.locator('[data-testid="campus-hud-coord"]');
  await expect(coord).toContainText(metaRaw.look.hud.coord);
  await expect(coord).toContainText(`${Object.keys(metaRaw.buildings).length} BUILDINGS · 5 BOARDS`);
});

test("2 静态比例尺宽度 = 画框宽 × scalePoster.desktop（±2px）", async ({ page }) => {
  await page.goto("/?3d=0");
  await page.waitForFunction(() => document.querySelectorAll(".campus-marker").length === 5);
  const fb = (await page.locator('[data-testid="campus-hero"]').boundingBox())!;
  await page.waitForTimeout(400); // 比例尺宽度有 300ms 过渡
  const width = await page.locator('[data-testid="campus-scale"]').evaluate((el) => el.getBoundingClientRect().width);
  const { desktop } = JSON.parse(
    readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
  ).look.hud.scalePoster as { desktop: number };
  expect(Math.abs(width - fb.width * desktop)).toBeLessThanOrEqual(2);
});

test("3 标记 22×22；五个 label 都显示板块名", async ({ page }) => {
  await page.goto("/?3d=0");
  for (let i = 0; i < 5; i++) {
    const no = `0${i + 1}`;
    const box = (await page.locator(`[data-testid="campus-marker-${no}"]`).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(21);
    expect(box.width).toBeLessThanOrEqual(23);
    expect(box.height).toBeGreaterThanOrEqual(21);
    expect(box.height).toBeLessThanOrEqual(23);
    await expect(page.locator(`[data-testid="campus-marker-label-${no}"]`)).toHaveText(metaRaw.hotspots[i].board);
  }
});

test("4 悬停图书馆 → 标记高亮、标签两行、右下显示 3 项服务；移开复原", async ({ page }) => {
  await page.goto("/?3d=0");
  await activateBoard(page, "图书馆");
  await expect(page.locator('[data-testid="campus-marker-05"]')).toHaveClass(/is-active/);
  const label = page.locator('[data-testid="campus-marker-label-05"]');
  await expect(label).toContainText(metaRaw.hotspots[4].label);
  await expect(label).toContainText(metaRaw.hotspots[4].note ?? "");
  const readout = page.locator('[data-testid="campus-hud-readout"]');
  await expect(readout).toContainText(metaRaw.hotspots[4].label);
  await expect(readout).toContainText("3 项服务");

  await page.evaluate(() =>
    document.querySelectorAll(".board-tile").forEach((el) =>
      el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true }))
    )
  );
  await expect(readout).toHaveText("移到板块上查看位置");
});

test("5 服务接口失败：不显示数量、无页面错误", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/api/v1/services*", (route) => route.abort());
  await page.goto("/?3d=0");
  await activateBoard(page, "图书馆");
  const readout = page.locator('[data-testid="campus-hud-readout"]');
  await expect(readout).toContainText(metaRaw.hotspots[4].label);
  await expect(readout).not.toContainText("项服务");
  expect(errors).toHaveLength(0);
});

test("6 3D 版比例尺跟随停靠点", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await page.waitForTimeout(400);
  await page.waitForFunction(
    () => window.__campus3d.frames >= 5,
    undefined,
    { timeout: 15_000 }
  );

  const distAt = async (stop: string) => {
    const pair = metaRaw.look.hud.scale100[stop];
    const d = await page.evaluate(([a, b]) => {
      const p0 = window.__campus3d.projectPoint(a);
      const p1 = window.__campus3d.projectPoint(b);
      return Math.hypot(p1.x - p0.x, p1.y - p0.y);
    }, pair);
    const width = await page.locator('[data-testid="campus-scale"]').evaluate((el) => el.getBoundingClientRect().width);
    return { d, width };
  };

  const a = await distAt("overview");
  expect(Math.abs(a.width - a.d)).toBeLessThanOrEqual(3);

  await activateBoard(page, "教务");
  await page.waitForFunction(
    () => window.__campus3d.stop === "jw" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  await page.waitForTimeout(500);
  const f0 = await page.evaluate(() => window.__campus3d.frames);
  await page.waitForFunction((f) => window.__campus3d.frames >= f + 2, f0, { timeout: 15_000 });
  const b = await distAt("jw");
  expect(Math.abs(b.width - b.d)).toBeLessThanOrEqual(3);
});

test("7 手机宽度：右上、左下隐藏，标题可见", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/classic");
  await expect(page.locator('[data-testid="campus-hud-title"]')).toBeVisible();
  await expect(page.locator('[data-testid="campus-hud-coord"]')).toBeHidden();
  await expect(page.locator('[data-testid="campus-scale"]')).toBeHidden();
});