import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// W2：外壳——顶栏、题字、罗盘、读数、暗角。/stage?3d=1&intro=0。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as any;

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

/** computed transform 会归一成 matrix(a, b, c, d, 0, 0)：角度 = atan2(b, a)。
 *  rotate(-Adeg) → matrix(cos(-A), sin(-A), …) → -A。none/rotate() 字面值则直接取数。 */
async function compassDeg(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage-compass"] img') as HTMLElement | null;
    if (!el) return NaN;
    const t = getComputedStyle(el).transform;
    if (!t || t === "none") return 0;
    const nums = t.match(/-?[\d.]+/g);
    if (!nums) return 0;
    if (/^matrix/i.test(t)) {
      const [a, b] = nums.map(Number);
      return (Math.atan2(b, a) * 180) / Math.PI;
    }
    return Number(nums[0]);
  });
}

function angDiff(az: number, rot: number): number {
  const diff = ((az + rot) % 360 + 360) % 360;
  return Math.min(diff, 360 - diff);
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 印章已加载，显示 38×38", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const nw = await page.locator('[data-testid="app-brand-seal"]').evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(nw).toBeGreaterThan(0);
  const box = await page.locator('[data-testid="app-brand-seal"]').boundingBox();
  expect(box?.width).toBe(38);
  expect(box?.height).toBe(38);
});

test("2 顶栏名称宋体；题字含「校园办事」，大标题 62px", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await expect(page.locator('[data-testid="stage-top"]')).toContainText("石大智多星");
  const font = await page.locator('[data-testid="stage-top"] .app-brand-name').evaluate(
    (el) => getComputedStyle(el).fontFamily
  );
  expect(/["']?Songti SC/i.test(font)).toBe(true);

  await expect(page.locator('[data-testid="stage-hero"]')).toContainText("校园办事");
  const fs = await page.locator(".stage-hero-title").evaluate((el) => getComputedStyle(el).fontSize);
  expect(fs).toBe("62px");
});

test("3 罗盘角度等于 −azimuth（360 取模，差 1 度内）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForTimeout(200);
  const az = await page.evaluate(() => window.__campus3d.azimuth);
  const rot = await compassDeg(page);
  expect(angDiff(az, rot)).toBeLessThanOrEqual(1);
});

test("4 debugGoTo('bq') 后方位角变化，罗盘跟着变", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForTimeout(200);
  const az0 = await page.evaluate(() => window.__campus3d.azimuth);
  await page.evaluate(() => window.__campus3d.debugGoTo?.("bq"));
  await page.waitForFunction(() => window.__campus3d.moving === false, undefined, { timeout: 10_000 });
  await page.waitForTimeout(200);
  const az1 = await page.evaluate(() => window.__campus3d.azimuth);
  expect(Math.abs(az1 - az0)).toBeGreaterThan(1);

  const az = await page.evaluate(() => window.__campus3d.azimuth);
  const rot = await compassDeg(page);
  expect(angDiff(az, rot)).toBeLessThanOrEqual(1);
});

test("5 比例尺：按校准换算选整米单位；横线像素与标注一致（20–400px）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForTimeout(300);
  // 不再固定显示 meta 里的 scaleLabel：按当前停靠点投影长度换算，取能放进左栏的常用单位
  const text = await page.locator('[data-testid="stage-scale"] .stage-scale-text').innerText();
  const unit = Number(text.replace(/\s*米$/, ""));
  expect([500, 200, 100, 50, 20, 10], `比例尺文字「${text}」`).toContain(unit);

  const pair = metaRaw.look.hud.scale100.home as [number[], number[]];
  const meters = metaRaw.look.hud.scaleMeters as number;
  const proj = await page.evaluate(([a, b]) => ({
    a: window.__campus3d.projectPoint(a),
    b: window.__campus3d.projectPoint(b),
  }), pair);
  const pxPerMeter = Math.abs(proj.b.x - proj.a.x) / meters;
  const w = await page.locator('[data-testid="stage-scale"] .stage-scale-line').evaluate(
    (el) => getComputedStyle(el).width
  );
  const px = Number.parseFloat(w);
  // 显示的距离与真实像素长度必须成同一比例（不许剪短却还标原距离）
  expect(Math.abs(px - unit * pxPerMeter), `线宽 ${px.toFixed(1)} / ${unit} 米`).toBeLessThanOrEqual(2);
  expect(px).toBeGreaterThan(20);
  expect(px).toBeLessThan(400);
});

test("6 读数：北纬/东经/栋楼/时；含 303", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const text = await page.locator('[data-testid="stage-hud"]').innerText();
  expect(text).toContain("北纬");
  expect(text).toContain("东经");
  expect(text).toContain("栋楼");
  expect(text).toContain("时");
  expect(text).toContain("303");
});

test("7 署名含「非测绘成果」", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await expect(page.locator('[data-testid="stage-caption"]')).toContainText("非测绘成果");
});

test("8 普通版不受影响：/classic 的 body 底色仍是日间暖纸白", async ({ page }) => {
  await page.goto("/classic");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  // 全站主题统一后，普通版底色来自 theme.css 的日间令牌 --bg #f6f3ea（暖纸白）；
  // stage.css 的变量都在 .stage 之下，不能改动这个底色。
  expect(bg).toBe("rgb(246, 243, 234)");
});

test("9 ?3d=0 静态模式下外壳零件仍然成立", async ({ page }) => {
  await page.goto("/stage?3d=0");
  await page.waitForTimeout(800);
  const nw = await page.locator('[data-testid="app-brand-seal"]').evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(nw).toBeGreaterThan(0);
  await expect(page.locator('[data-testid="stage-top"]')).toContainText("石大智多星");
  await expect(page.locator('[data-testid="stage-hero"]')).toContainText("校园办事");
  await expect(page.locator('[data-testid="stage-caption"]')).toContainText("非测绘成果");
  const text = await page.locator('[data-testid="stage-hud"]').innerText();
  expect(text).toContain("北纬");
  expect(text).toContain("303");
});

test("shots：W2-shell.png", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForTimeout(400);
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W2-shell.png" });
});
