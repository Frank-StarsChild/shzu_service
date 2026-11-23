import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// ALIVE A4：二十四院罗盘。/stage?3d=1&intro=0，1440×900。
// 对照 alive-dial.jpg：盘面随方位角反转，院徽不转、按 dial.deg 摆。

const allMeta = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as { buildings: Record<string, { anchor: [number, number, number] }> };

const emblems = JSON.parse(
  readFileSync(new URL("../../public/campus3d/emblems/emblems.json", import.meta.url), "utf-8")
) as {
  dial: { viewBox: number; emblemRadius: number };
  colleges: { no: number; dial: { deg: number } }[];
};

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function waitNotMoving(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 20_000 });
}

async function openDial(page: Page) {
  await page.locator('[data-testid="stage-compass"]').click();
  await page.waitForFunction(() => window.__campus3d?.dial === true, undefined, { timeout: 5000 });
  await page.locator('[data-testid="stage-dial"]').waitFor({ state: "visible" });
}

/** 盘心、盘径与四个院徽中心的偏差（等展开动画结束再量） */
async function slotErrors(page: Page, nos: number[], settleMs = 800) {
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  const box = await page.locator('[data-testid="stage-dial"]').boundingBox();
  if (!box) throw new Error("盘面没有外框");
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const k = box.width / emblems.dial.viewBox;
  const R = emblems.dial.emblemRadius * k;
  const az = await page.evaluate(() => Number(window.__campus3d?.azimuth ?? 0));
  const out: { no: number; err: number }[] = [];
  for (const no of nos) {
    const c = emblems.colleges.find((x) => x.no === no);
    if (!c) throw new Error(`emblems.json 里没有 no=${no}`);
    const th = ((c.dial.deg - az) * Math.PI) / 180;
    const ex = cx + R * Math.sin(th);
    const ey = cy - R * Math.cos(th);
    const b = await page.locator(`[data-testid="stage-dial-slot-${no}"]`).boundingBox();
    if (!b) throw new Error(`院徽 ${no} 没有外框`);
    out.push({ no, err: Math.hypot(b.x + b.width / 2 - ex, b.y + b.height / 2 - ey) });
  }
  return out;
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 点罗盘：dial=true，24 个院徽", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await openDial(page);
  expect(await page.evaluate(() => window.__campus3d?.dial)).toBe(true);
  await expect(page.locator('[data-testid^="stage-dial-slot-"]')).toHaveCount(24);
});

test("2 院徽位置：按 dial.deg − 方位角，误差 ≤2px", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await openDial(page);
  const errs = await slotErrors(page, [1, 5, 12, 20]);
  for (const r of errs) expect(r.err, `院徽 ${r.no}`).toBeLessThanOrEqual(2);
});

test("3 转到 nq（方位角差 40°）：公式仍成立", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const homeAz = await page.evaluate(() => Number(window.__campus3d?.azimuth ?? 0));
  await page.evaluate(() => window.__campus3d?.debugGoTo?.("nq"));
  await waitNotMoving(page);
  const nqAz = await page.evaluate(() => Number(window.__campus3d?.azimuth ?? 0));
  let diff = Math.abs(nqAz - homeAz) % 360;
  if (diff > 180) diff = 360 - diff;
  expect(diff).toBeGreaterThanOrEqual(30);
  await openDial(page);
  const errs = await slotErrors(page, [1, 5, 12, 20]);
  for (const r of errs) expect(r.err, `院徽 ${r.no}`).toBeLessThanOrEqual(2);
});

test("4 指信息学院：本色院徽、红线落到 BQ-B013、小牌写学院名", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await openDial(page);
  const slot = page.locator('[data-testid="stage-dial-slot-5"]');
  await slot.hover();
  await expect(slot.locator('[data-tone="color"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="stage-dial-thread"]')).toHaveCount(1);

  const end = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="stage-dial-thread"]') as SVGPathElement | null;
    if (!p) return null;
    const pt = p.getPointAtLength(p.getTotalLength());
    return { x: pt.x, y: pt.y };
  });
  const target = await page.evaluate(
    (a) => window.__campus3d?.projectPoint?.(a) ?? null,
    allMeta.buildings["BQ-B013"].anchor
  );
  expect(end).not.toBeNull();
  expect(target).not.toBeNull();
  expect(Math.hypot(end!.x - target!.x, end!.y - target!.y)).toBeLessThanOrEqual(3);

  await expect(page.locator('[data-testid="stage-dial-plate"]')).toContainText("信息科学与技术学院");
  await page.screenshot({ path: "docs/3d/shots/A4-dial.png" });
});

test("5 点信息学院：收起、落到 BQ-B013、college=5", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await openDial(page);
  await page.locator('[data-testid="stage-dial-slot-5"]').click();
  await page.waitForFunction(
    () => window.__campus3d?.mode === "answer" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 20_000 }
  );
  const hook = await page.evaluate(() => ({
    dial: window.__campus3d?.dial,
    mode: window.__campus3d?.mode,
    shell: window.__campus3d?.shell,
    college: window.__campus3d?.college,
  }));
  expect(hook.dial).toBe(false);
  expect(hook.mode).toBe("answer");
  expect(hook.shell).toBe("BQ-B013");
  expect(hook.college).toBe(5);
});

test.setTimeout(90_000);

test("6 师范学院（将军山）：虚线框、写「将军山」；点了换到 jjs 并落 JJ-B018", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await openDial(page);
  await expect(page.locator('[data-testid="stage-dial-slot-13"]')).toHaveClass(/is-off/);
  await expect(page.locator('[data-testid="stage-dial-name-13"]')).toContainText("将军山");
  await page.locator('[data-testid="stage-dial-slot-13"]').click();
  await page.waitForFunction(
    () => window.__campus3d?.pack === "jjs" && window.__campus3d?.status === "ready"
      && window.__campus3d?.moving === false,
    undefined,
    { timeout: 60_000 }
  );
  const hook = await page.evaluate(() => ({
    college: window.__campus3d?.college,
    shell: window.__campus3d?.shell,
    pin: window.__campus3d?.pin,
  }));
  expect(hook.college).toBe(13);
  expect([hook.shell, hook.pin]).toContain("JJ-B018");
});

test("7 Esc、收起钮、点遮罩：都收起", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  await openDial(page);
  await page.keyboard.press("Escape");
  await expect.poll(() => page.evaluate(() => window.__campus3d?.dial)).toBe(false);

  await openDial(page);
  await page.locator('[data-testid="stage-dial-close"]').click();
  await expect.poll(() => page.evaluate(() => window.__campus3d?.dial)).toBe(false);

  await openDial(page);
  await page.mouse.click(30, 200); // 遮罩上、盘面外
  await expect.poll(() => page.evaluate(() => window.__campus3d?.dial)).toBe(false);
});

test("8 护理学院（没有楼）：不收起，显示「位置待确认」", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await openDial(page);
  await page.locator('[data-testid="stage-dial-slot-24"]').click();
  await expect(page.locator('[data-testid="stage-dial-pending"]')).toBeVisible();
  expect(await page.evaluate(() => window.__campus3d?.dial)).toBe(true);
});

test("9 减少动态：点罗盘后 50ms 内院徽位置已成立", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await openDial(page);
  const errs = await slotErrors(page, [1, 5, 12, 20], 50);
  for (const r of errs) expect(r.err, `院徽 ${r.no}`).toBeLessThanOrEqual(2);
});
