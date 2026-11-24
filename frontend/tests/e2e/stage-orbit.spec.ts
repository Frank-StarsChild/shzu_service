import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// W8：拖动旋转与观景。全部 /stage?3d=1&intro=0。
// 无头浏览器软件渲染每帧可达数百毫秒，hook 的值要在渲染后读，等待一律用轮询。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as {
  look: {
    orbit: { minPolarDeg: number; maxPolarDeg: number; minDistance: number; maxDistance: number };
    tour: { degPerSec: number };
  };
  stops: { bq: { position: [number, number, number] } };
};

const ORBIT = metaRaw.look.orbit;
const TOUR = metaRaw.look.tour;

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

/** 等到 stop 稳定在期望值（拖动是异步事件，change → hookInfo 需要一两拍） */
async function waitStop(page: Page, stop: string, timeout = 10_000) {
  await page.waitForFunction((s) => window.__campus3d?.stop === s, stop, { timeout, polling: 100 });
}

async function readAzimuth(page: Page): Promise<number> {
  return page.evaluate(() => window.__campus3d.azimuth);
}

/** 相机到目标点的距离 / 极角（相机—目标连线与竖直方向的夹角，度） */
async function readCam(page: Page) {
  return page.evaluate(() => {
    const p = window.__campus3d.camera.position;
    const t = window.__campus3d.camera.target;
    const dx = p[0] - t[0];
    const dy = p[1] - t[1];
    const dz = p[2] - t[2];
    const dist = Math.hypot(dx, dy, dz);
    const polarDeg = (Math.acos(Math.max(-1, Math.min(1, dy / dist))) * 180) / Math.PI;
    return { y: p[1], dist, polarDeg };
  });
}

function angDiff(a: number, b: number): number {
  const d = ((a - b) % 360 + 360) % 360;
  return Math.min(d, 360 - d);
}

/** 罗盘校验：rot 应等于 −az（两者之和取 360 取模后近 0） */
function compassDiff(az: number, rot: number): number {
  const d = ((az + rot) % 360 + 360) % 360;
  return Math.min(d, 360 - d);
}

/** 罗盘转角：rotate() 会被归一成 matrix，用 atan2(b, a) 取角度（同 stage-shell.spec） */
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

async function canvasCenter(page: Page) {
  const box = (await page.locator('[data-testid="stage-canvas"]').boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 中央向右拖 200px：方位角变化 >5°，stop=free，距离变化 <1%", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const az0 = await readAzimuth(page);
  const cam0 = await readCam(page);

  const c = await canvasCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y, { steps: 10 });
  await page.mouse.up();

  await waitStop(page, "free");
  const az1 = await readAzimuth(page);
  expect(angDiff(az1, az0), `方位角从 ${az0.toFixed(1)}° 到 ${az1.toFixed(1)}°`).toBeGreaterThan(5);
  const cam1 = await readCam(page);
  expect(Math.abs(cam1.dist - cam0.dist) / cam0.dist).toBeLessThan(0.01);
});

test("2 上下拖 2000px：极角被限制在 minPolarDeg−0.5 与 maxPolarDeg+0.5 之间；Y 始终 > 0", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const c = await canvasCenter(page);

  // 向上拖 2000 像素（20 步）：撞到 minPolarAngle
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(c.x, c.y - i * 100, { steps: 1 });
    const y = (await readCam(page)).y;
    expect(y, `第 ${i} 步相机 Y`).toBeGreaterThan(0);
  }
  await page.mouse.up();
  await waitStop(page, "free");
  const up = await readCam(page);
  expect(up.polarDeg, `向上拖后极角 ${up.polarDeg.toFixed(1)}°`).toBeGreaterThanOrEqual(ORBIT.minPolarDeg - 0.5);

  // 向下拖 2000 像素：撞到 maxPolarAngle
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) {
    await page.mouse.move(c.x, c.y + i * 100, { steps: 1 });
  }
  await page.mouse.up();
  await waitStop(page, "free");
  const down = await readCam(page);
  expect(down.polarDeg, `向下拖后极角 ${down.polarDeg.toFixed(1)}°`).toBeLessThanOrEqual(ORBIT.maxPolarDeg + 0.5);
});

test("3 滚轮 50 次：距离被限制在 [minDistance×0.99, maxDistance×1.01]", async ({ page }) => {
  // 软件渲染下每次滚轮都触发一次重渲染，30s 单测预算不够，放宽到 90s
  test.setTimeout(90_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const c = await canvasCenter(page);
  await page.mouse.move(c.x, c.y);

  for (let i = 0; i < 50; i++) await page.mouse.wheel(0, -100);
  await waitStop(page, "free");
  const near = await readCam(page);
  expect(near.dist, `拉近后距离 ${near.dist.toFixed(1)}（下限 ${ORBIT.minDistance}）`).toBeGreaterThanOrEqual(
    ORBIT.minDistance * 0.99
  );

  for (let i = 0; i < 50; i++) await page.mouse.wheel(0, 100);
  await waitStop(page, "free");
  const far = await readCam(page);
  expect(far.dist, `拉远后距离 ${far.dist.toFixed(1)}（上限 ${ORBIT.maxDistance}）`).toBeLessThanOrEqual(
    ORBIT.maxDistance * 1.01
  );
});

test("4 拖动之后罗盘仍等于 −方位角（差 1 度内）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const c = await canvasCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 300, c.y + 120, { steps: 8 });
  await page.mouse.up();
  await waitStop(page, "free");

  const az = await readAzimuth(page);
  const rot = await compassDeg(page);
  expect(compassDiff(az, rot), `罗盘 ${rot.toFixed(1)}° vs −方位角（即 ${((-az % 360) + 360) % 360}°）`).toBeLessThanOrEqual(1);
});

test("5 拖动后点北区：镜头照常飞到 bq 停靠点", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const c = await canvasCenter(page);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y, { steps: 8 });
  await page.mouse.up();
  await waitStop(page, "free");

  await page.click('[data-testid="stage-rail-BQ"]');
  await page.waitForFunction(
    () => window.__campus3d.stop === "bq" && window.__campus3d.moving === false,
    undefined,
    { timeout: 20_000, polling: 100 }
  );
  const pos = await page.evaluate(() => window.__campus3d.camera.position);
  for (const i of [0, 1, 2] as const) {
    expect(Math.abs(pos[i] - metaRaw.stops.bq.position[i]), `position[${i}]`).toBeLessThan(0.5);
  }
});

test("6 点观景：mode=tour、界面淡出、退出钮可见、方位角按 degPerSec 增大、相机高度不变", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-tool-tour"]');

  await page.waitForFunction(
    () => window.__campus3d?.mode === "tour" && window.__campus3d?.tour === true,
    undefined,
    { timeout: 5_000, polling: 100 }
  );
  // 300ms 淡出 + 主线程拥塞时过渡启动会被推迟：自动等到计算不透明度确实为 0/1（有界等待）
  await expect
    .poll(() => page.locator('[data-testid="stage-dock"]').evaluate((el) => getComputedStyle(el).opacity), { timeout: 8_000 })
    .toBe("0");
  await expect
    .poll(() => page.locator('[data-testid="stage-top"]').evaluate((el) => getComputedStyle(el).opacity), { timeout: 8_000 })
    .toBe("0");
  await expect(page.locator('[data-testid="stage-tour-exit"]')).toBeVisible();

  const az0 = await readAzimuth(page);
  const y0 = (await readCam(page)).y;
  await page.waitForTimeout(2000);
  const az1 = await readAzimuth(page);
  const delta = Math.round(((az1 - az0) % 360 + 360) % 360);
  const expectDeg = 2 * TOUR.degPerSec;
  expect(delta, `2 秒方位角增大 ${delta}°，期望约 ${expectDeg}°（±40%）`).toBeGreaterThanOrEqual(expectDeg * 0.6);
  expect(delta).toBeLessThanOrEqual(expectDeg * 1.4);

  const y1 = (await readCam(page)).y;
  expect(Math.abs(y1 - y0)).toBeLessThan(0.5);
});

test("7 在北区上观景后按 Esc：恢复 campus、镜头回 bq、界面回来", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await page.waitForFunction(
    () => window.__campus3d.stop === "bq" && window.__campus3d.moving === false,
    undefined,
    { timeout: 20_000, polling: 100 }
  );

  await page.click('[data-testid="stage-tool-tour"]');
  await page.waitForFunction(
    () => window.__campus3d?.mode === "tour" && window.__campus3d?.tour === true,
    undefined,
    { timeout: 5_000, polling: 100 }
  );

  await page.keyboard.press("Escape");
  await page.waitForFunction(
    () => window.__campus3d?.moving === false && window.__campus3d?.mode === "campus",
    undefined,
    { timeout: 20_000, polling: 100 }
  );
  expect(await page.evaluate(() => window.__campus3d.tour)).toBe(false);
  // 界面淡入回去：自动等到不透明度确实为 1
  await expect
    .poll(() => page.locator('[data-testid="stage-dock"]').evaluate((el) => getComputedStyle(el).opacity), { timeout: 8_000 })
    .toBe("1");
  expect(await page.evaluate(() => window.__campus3d.stop)).toBe("bq");
});

test("8 减少动态：控制区没有「观景」", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await expect(page.locator('[data-testid="stage-tool-tour"]')).toHaveCount(0);
});

test("9 手动观景：草稿留住、底部有「问智多星」、Tab 不进输入框、点它回输入框", async ({ page }) => {
  let chatPosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/v1/chat")) chatPosts += 1;
  });

  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const input = page.locator('[data-testid="stage-input"]');
  await input.fill("学生证丢了去哪补办");

  await page.click('[data-testid="stage-tool-tour"]');
  await page.waitForFunction(() => window.__campus3d?.mode === "tour", undefined, { timeout: 5_000, polling: 100 });

  await expect(page.locator('[data-testid="stage-tour-ask"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-tour-exit"]')).toBeFocused();
  await expect(page.locator('[data-testid="stage-dock"]')).toHaveAttribute("inert", "");

  // 焦点顺序：退出观景 → 问智多星 → 不会掉进透明的输入框
  await page.keyboard.press("Tab");
  await expect(page.locator('[data-testid="stage-tour-ask"]')).toBeFocused();
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => document.activeElement?.getAttribute("data-testid"))).not.toBe("stage-input");

  // 点「问智多星」：退出观景、光标回输入框、草稿还在、没有自动发送
  await page.locator('[data-testid="stage-tour-ask"]').click();
  await expect.poll(() => page.evaluate(() => window.__campus3d?.mode), { timeout: 8_000 }).toBe("home");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("学生证丢了去哪补办");
  await expect(page.locator('[data-testid="stage-dock"]')).not.toHaveAttribute("inert", "");
  expect(chatPosts).toBe(0);

  // 再用 Esc 退出：焦点回「观景」按钮
  await page.click('[data-testid="stage-tool-tour"]');
  await page.waitForFunction(() => window.__campus3d?.mode === "tour", undefined, { timeout: 5_000, polling: 100 });
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__campus3d?.mode), { timeout: 8_000 }).toBe("home");
  await expect(page.locator('[data-testid="stage-tool-tour"]')).toBeFocused();
  await expect(page.locator('[data-testid="stage-tour-ask"]')).toHaveCount(0);
});
