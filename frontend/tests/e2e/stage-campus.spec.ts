import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// W3：校区题签和切换沙盘。/stage?3d=1&intro=0 打开；对照 stage-home/stage-campus.jpg。
// 第 6、7 条各自的页面里自带基线（换包前后同页对比 geometries/textures）。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as { zones: { id: string; label: [number, number, number] }[] };

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

test("1 ready 后：恰好 7 项题签；全校选中；将军山远", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const count = await page.locator('[data-testid^="stage-rail-"]').count();
  expect(count).toBe(7);
  await expect(page.locator('[data-testid="stage-rail-ALL"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="stage-rail-JJ"]')).toHaveClass(/is-far/);
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
    const zone = metaRaw.zones.find((z) => z.id === id);
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

test("3 点北区：mode/zone/stop 对、题字隐去、只留北区题签、偏红 >0.004", async ({ page }) => {
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

test("6 换包到将军山：19 楼、回 home 停靠、题签选中、读数含 19", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const before = await page.evaluate(() => ({
    g: window.__campus3d.geometries,
    t: window.__campus3d.textures,
  }));
  await page.click('[data-testid="stage-rail-JJ"]');
  await waitPack(page, "jjs");
  const h = await page.evaluate(() => ({
    buildingCount: window.__campus3d.buildingCount,
    stop: window.__campus3d.stop,
  }));
  expect(h.buildingCount).toBe(19);
  expect(h.stop).toBe("home");
  await expect(page.locator('[data-testid="stage-rail-JJ"]')).toHaveClass(/is-active/);
  await expect(page.locator('[data-testid="stage-hud"]')).toContainText("19");
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W3-jjs.png" });
  // 第 7 条在本测试同页继续：回全校后资源数应与换包前相同
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

test("7 北区和中区来回点 10 次：geometries、textures 不变", async ({ page }) => {
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
