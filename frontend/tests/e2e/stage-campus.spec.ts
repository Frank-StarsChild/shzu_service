import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// W3（七包版）：校区题签、近看和切换沙盘。/stage?3d=1&intro=0 打开；
// 对照 stage-home/stage-campus/stage-near/stage-jjs.jpg。
// 第 6—11 条在同一个测试里连续进行（同页换包）；第 12 条独立。

const allMetaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as { zones: { id: string; label: [number, number, number] }[] };

const bqMetaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/bq/campus.meta.json", import.meta.url), "utf-8")
) as { zones: { id: string }[]; hotspots: { no: string; anchor: [number, number, number] }[] };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function waitNotMoving(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 10_000 });
}

async function waitPack(page: Page, packId: string) {
  await page.waitForFunction(
    (id) => window.__campus3d?.status === "ready" && window.__campus3d?.pack === id,
    packId,
    { timeout: 40_000 }
  );
}

/** is-shot 截图统计偏红像素占比（R>140 且 R−G>50 且 R−B>50），完事移除 is-shot。 */
async function reddishRatio(page: Page): Promise<number> {
  await page.evaluate(() => {
    document.querySelector('[data-testid="stage"]')?.classList.add("is-shot");
  });
  const buf = await page.screenshot();
  await page.evaluate(() => {
    document.querySelector('[data-testid="stage"]')?.classList.remove("is-shot");
  });
  const png = PNG.sync.read(buf);
  const total = png.width * png.height;
  let red = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (r > 140 && r - g > 50 && r - b > 50) red += 1;
  }
  return red / total;
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 ready 后：恰好 7 项；全校选中；将军山远、其余五个不远；无近看钮", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const count = await page.locator('[data-testid^="stage-rail-"]').count();
  expect(count).toBe(7);
  await expect(page.locator('[data-testid="stage-rail-ALL"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="stage-rail-JJ"]')).toHaveClass(/is-far/);
  for (const id of ["BY", "BQ", "ZQ", "NQ", "DQ"]) {
    await expect(page.locator(`[data-testid="stage-rail-${id}"]`)).not.toHaveClass(/is-far/);
  }
  await expect(page.locator('[data-testid="stage-rail-enter"]')).toHaveCount(0);
});

test("2 场景题签：至少 4 块可见；线底端与 projectPoint(zone.label) 相差 ≤3px", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForTimeout(400);
  const ids = ["BY", "BQ", "ZQ", "NQ", "DQ"];
  let visibleCount = 0;
  for (const id of ids) {
    const sign = page.locator(`[data-testid="stage-sign-${id}"]`);
    if (!(await sign.isVisible())) continue;
    visibleCount += 1;
    const zone = allMetaRaw.zones.find((z) => z.id === id);
    expect(zone).toBeTruthy();
    const p = await page.evaluate(
      (label) => window.__campus3d.projectPoint(label),
      zone!.label
    );
    const box = await sign.locator(".stage-sign-line").boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const bottom = box!.y + box!.height;
    expect(Math.abs(cx - p.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(bottom - p.y)).toBeLessThanOrEqual(3);
  }
  expect(visibleCount).toBeGreaterThanOrEqual(4);
});

test("3 点北区：campus/zone/stop 对、题字隐去、只留北区、近看钮、偏红 >0.004", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitNotMoving(page);
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    zone: window.__campus3d.zone,
    stop: window.__campus3d.stop,
  }));
  expect(h.mode).toBe("campus");
  expect(h.zone).toBe("BQ");
  expect(h.stop).toBe("bq");
  const opacity = await page
    .locator('[data-testid="stage-hero"]')
    .evaluate((el) => getComputedStyle(el).opacity);
  expect(Number(opacity)).toBe(0);
  for (const id of ["BY", "ZQ", "NQ", "DQ"]) {
    await expect(page.locator(`[data-testid="stage-sign-${id}"]`)).toHaveCount(0);
  }
  await expect(page.locator('[data-testid="stage-sign-BQ"]')).toBeVisible();
  const enter = page.locator('[data-testid="stage-rail-enter"]');
  await expect(enter).toBeVisible();
  await expect(enter).toContainText("近看");
  expect(await reddishRatio(page)).toBeGreaterThan(0.004);
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W3-bq.png" });
});

test("4 点中区：zone=ZQ、stop=zq", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitNotMoving(page);
  const h = await page.evaluate(() => ({
    zone: window.__campus3d.zone,
    stop: window.__campus3d.stop,
  }));
  expect(h.zone).toBe("ZQ");
  expect(h.stop).toBe("zq");
});

test("5 回全校：mode=home、zone=null、stop=home；偏红 <0.001", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitNotMoving(page);
  await page.click('[data-testid="stage-rail-ALL"]');
  await waitNotMoving(page);
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    zone: window.__campus3d.zone,
    stop: window.__campus3d.stop,
  }));
  expect(h.mode).toBe("home");
  expect(h.zone).toBeNull();
  expect(h.stop).toBe("home");
  expect(await reddishRatio(page)).toBeLessThan(0.001);
});

test("6—11 近看与换包一条龙：bq 地标 → campus → zq → jjs → 回 all", async ({ page }) => {
  // 四次换包，每次都重播 2.7s 开场动画并重建场景：测试级时限放宽到 4 分钟
  test.setTimeout(240_000);
  // 第 6 条：先记资源基线，点北区再点「近看」换到 bq 自己的沙盘
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const before = await page.evaluate(() => ({
    g: window.__campus3d.geometries,
    t: window.__campus3d.textures,
  }));
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitNotMoving(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "bq");
  const h = await page.evaluate(() => ({
    buildingCount: window.__campus3d.buildingCount,
    stop: window.__campus3d.stop,
    mode: window.__campus3d.mode,
  }));
  expect(h.buildingCount).toBe(109);
  expect(h.stop).toBe("home");
  expect(h.mode).toBe("home");
  await expect(page.locator('[data-testid="stage-rail-BQ"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="stage-rail-ZQ"]')).toHaveClass(/is-far/);
  const hero = page.locator('[data-testid="stage-hero"]');
  await expect(hero).toContainText("北区");
  await expect(hero).not.toContainText("校园办事");
  await expect(page.locator('[data-testid="stage-hud"]')).toContainText("109");
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W3-near.png" });

  // 第 7 条：bq 沙盘首页的地标小题签
  await page.waitForTimeout(400);
  const landmarkCount = await page.locator('[data-testid^="stage-landmark-"]').count();
  expect(landmarkCount).toBe(bqMetaRaw.hotspots.length);
  let visibleLandmarks = 0;
  for (const hs of bqMetaRaw.hotspots) {
    const sign = page.locator(`[data-testid="stage-landmark-${hs.no}"]`);
    if (!(await sign.isVisible())) continue;
    visibleLandmarks += 1;
    const p = await page.evaluate(
      (anchor) => window.__campus3d.projectPoint(anchor),
      hs.anchor
    );
    const box = await sign.locator(".stage-sign-line").boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const bottom = box!.y + box!.height;
    expect(Math.abs(cx - p.x)).toBeLessThanOrEqual(3);
    expect(Math.abs(bottom - p.y)).toBeLessThanOrEqual(3);
  }
  expect(visibleLandmarks).toBeGreaterThanOrEqual(4);
  await expect(page.locator('[data-testid^="stage-sign-"]')).toHaveCount(0);

  // 第 8 条：还在 bq，点北区进 campus（单片区无 stop → overview）；再点取消
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitNotMoving(page);
  await page.waitForTimeout(300);
  const h8 = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    zone: window.__campus3d.zone,
    stop: window.__campus3d.stop,
  }));
  expect(h8.mode).toBe("campus");
  expect(h8.zone).toBe("BQ");
  expect(h8.stop).toBe("overview");
  await expect(page.locator('[data-testid="stage-rail-enter"]')).toHaveCount(0);
  expect(await reddishRatio(page)).toBeGreaterThan(0.0025);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitNotMoving(page);
  const h8b = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    zone: window.__campus3d.zone,
  }));
  expect(h8b.mode).toBe("home");
  expect(h8b.zone).toBeNull();

  // 第 9 条：在 bq 里点中区 → 换到 zq 自己的沙盘，题字「中区」
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitPack(page, "zq");
  await expect(page.locator('[data-testid="stage-hero"]')).toContainText("中区");

  // 第 10 条：点将军山 → jjs（19 栋楼、选中）
  await page.click('[data-testid="stage-rail-JJ"]');
  await waitPack(page, "jjs");
  const h10 = await page.evaluate(() => window.__campus3d.buildingCount);
  expect(h10).toBe(19);
  await expect(page.locator('[data-testid="stage-rail-JJ"]')).toHaveClass(/is-active/);
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W3-jjs.png" });

  // 第 11 条：回全校：303 栋楼；资源数与第 6 条开头记录的相同
  await page.click('[data-testid="stage-rail-ALL"]');
  await waitPack(page, "all");
  const after = await page.evaluate(() => ({
    buildingCount: window.__campus3d.buildingCount,
    g: window.__campus3d.geometries,
    t: window.__campus3d.textures,
  }));
  expect(after.buildingCount).toBe(303);
  expect(after.g).toBe(before.g);
  expect(after.t).toBe(before.t);
});

test("12 北区和中区来回点 10 次（all 上）：geometries、textures 不变", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const before = await page.evaluate(() => ({
    g: window.__campus3d.geometries,
    t: window.__campus3d.textures,
  }));
  for (let i = 0; i < 10; i++) {
    await page.click(i % 2 === 0 ? '[data-testid="stage-rail-BQ"]' : '[data-testid="stage-rail-ZQ"]');
    await waitNotMoving(page);
  }
  const after = await page.evaluate(() => ({
    g: window.__campus3d.geometries,
    t: window.__campus3d.textures,
  }));
  expect(after.g).toBe(before.g);
  expect(after.t).toBe(before.t);
});
