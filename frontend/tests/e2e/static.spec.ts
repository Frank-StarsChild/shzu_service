import { expect, test } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// PLAN S3 静态版验收。后端不启动，/api 用假数据；不请求任何 .glb。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
) as { hotspots: { posterDesktop: [number, number] }[] };

let glbRequests: string[] = [];

test.beforeEach(async ({ page }) => {
  glbRequests = [];
  page.on("request", (r) => {
    if (r.url().includes(".glb")) glbRequests.push(r.url());
  });
  await mockApi(page);
});

test.afterEach(() => {
  // 整个过程没有任何地址含 .glb 的请求（PLAN S3 验证第 9 条）
  expect(glbRequests, "不应请求任何 .glb 文件").toHaveLength(0);
});

test("1 海报可见：naturalWidth > 0，alt 非空", async ({ page }) => {
  await page.goto("/");
  const poster = page.locator('[data-testid="campus-poster"]');
  await expect(poster).toBeVisible();
  const naturalWidth = await poster.evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(naturalWidth).toBeGreaterThan(0);
  const alt = (await poster.getAttribute("alt")) ?? "";
  expect(alt.length).toBeGreaterThan(0);
});

test("2 外框宽高比：桌面 2.35–2.45；手机 1.28–1.38 且用手机海报", async ({ page }) => {
  await page.goto("/");
  const frame = page.locator('[data-testid="campus-hero"]');
  await expect(frame).toBeVisible();

  const desktop = (await frame.boundingBox())!;
  const desktopRatio = desktop.width / desktop.height;
  expect(desktopRatio).toBeGreaterThanOrEqual(2.35);
  expect(desktopRatio).toBeLessThanOrEqual(2.45);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  const mobile = (await frame.boundingBox())!;
  const mobileRatio = mobile.width / mobile.height;
  expect(mobileRatio).toBeGreaterThanOrEqual(1.28);
  expect(mobileRatio).toBeLessThanOrEqual(1.38);

  const src = await page.locator('[data-testid="campus-poster"]').evaluate(
    (el) => (el as HTMLImageElement).currentSrc
  );
  expect(src).toContain("poster-mobile");
});

test("3 标记恰好 5 个；中心与 posterDesktop 相差 < 0.01", async ({ page }) => {
  await page.goto("/");
  const frame = page.locator('[data-testid="campus-hero"]');
  const markers = page.locator('[data-testid^="campus-marker-"]');
  await expect(markers).toHaveCount(5);
  await expect(frame).toBeVisible();

  const fb = (await frame.boundingBox())!;
  for (let i = 0; i < 5; i++) {
    const mb = (await markers.nth(i).boundingBox())!;
    const cx = (mb.x + mb.width / 2 - fb.x) / fb.width;
    const cy = (mb.y + mb.height / 2 - fb.y) / fb.height;
    const [px, py] = metaRaw.hotspots[i].posterDesktop;
    expect(Math.abs(cx - px), `标记 ${i + 1} 的 x`).toBeLessThan(0.01);
    expect(Math.abs(cy - py), `标记 ${i + 1} 的 y`).toBeLessThan(0.01);
  }
});

test("4 悬停「教务」按钮：标记 02 高亮且钩子 activeBoard 正确；移开复原", async ({ page }) => {
  await page.goto("/");
  const tile = page.locator('.board-tile[data-board="教务"]');
  await tile.hover();
  await expect(page.locator('[data-testid="campus-marker-02"]')).toHaveClass(/is-active/);
  expect(await page.evaluate(() => window.__campus3d.activeBoard)).toBe("教务");

  await page.mouse.move(5, 5);
  await expect(page.locator('[data-testid="campus-marker-02"]')).not.toHaveClass(/is-active/);
  expect(await page.evaluate(() => window.__campus3d.activeBoard)).toBeNull();
});

test("5 悬停标记 05：第 5 个板块按钮高亮；点击跳服务目录", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="campus-marker-05"]').hover();
  await expect(page.locator('.board-tile[data-board="图书馆"]')).toHaveClass(/is-active/);

  await page.locator('[data-testid="campus-marker-05"]').click();
  await expect(page).toHaveURL(/\/services/);
  expect(decodeURIComponent(new URL(page.url()).search)).toContain("board=图书馆");
});

test("6 键盘聚焦标记 01：第 1 个板块按钮高亮", async ({ page }) => {
  await page.goto("/");
  await page.locator('[data-testid="campus-marker-01"]').focus();
  await expect(page.locator('.board-tile[data-board="学工"]')).toHaveClass(/is-active/);
});

test("7 数据说明含 OpenStreetMap 与「示意」", async ({ page }) => {
  await page.goto("/");
  const caption = page.locator('[data-testid="campus-caption"]');
  await expect(caption).toContainText("OpenStreetMap");
  await expect(caption).toContainText("示意");
});

test("8 meta 请求被中断：海报仍可见、标记 0 个、pageerror 0 次", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/campus3d/campus.meta.json", (route) => route.abort());
  await page.goto("/");

  await expect(page.locator('[data-testid="campus-poster"]')).toBeVisible();
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid^="campus-marker-"]')).toHaveCount(0);
  expect(errors).toHaveLength(0);
});

test("9 截图存档（docs/3d/shots）", async ({ page }) => {
  mkdirSync(new URL("../../docs/3d/shots/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"), {
    recursive: true,
  });
  await page.goto("/");
  await expect(page.locator('[data-testid^="campus-marker-"]')).toHaveCount(5);
  await page.locator('[data-testid="campus-hero"]').screenshot({
    path: "../docs/3d/shots/S3-desktop.png",
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150);
  await page.locator('[data-testid="campus-hero"]').screenshot({
    path: "../docs/3d/shots/S3-mobile.png",
  });
});
