// 本次「标签分级 + 统一避让」验收：
// - 校区概览不再拼学院全名（地图上只有院徽 + 序号角标；全名在悬停签与右侧面板）
// - 信息学院灯牌不再压住「北区」竖签；灯牌也不压右侧面板/底部问话栏
// - 同楼多学院仍并排，角标与右侧面板行号一致（同一份 collegeIndex 数据）
// - 校区沙盘里地标题签优先，灯牌让开
import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}
async function waitStill(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 30_000 });
}
async function waitPack(page: Page, id: string) {
  await page.waitForFunction(
    (p) => window.__campus3d?.status === "ready" && window.__campus3d?.pack === p,
    id,
    { timeout: 40_000 }
  );
}

type Box = { x: number; y: number; width: number; height: number };

function overlap(a: Box, b: Box, pad = 0): boolean {
  return a.x - pad < b.x + b.width
    && a.x + a.width + pad > b.x
    && a.y - pad < b.y + b.height
    && a.y + a.height + pad > b.y;
}

async function boxOf(page: Page, sel: string): Promise<Box | null> {
  const loc = page.locator(sel);
  if ((await loc.count()) === 0) return null;
  if (!(await loc.first().isVisible())) return null;
  return (await loc.first().boundingBox()) as Box | null;
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 北区概览：信息学院灯牌不压「北区」竖签，也不压面板与问话栏；场景没有学院全名", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitStill(page);
  await page.waitForTimeout(600);

  // 地图上不再拼学院全名（原来 .stage-mark-label 是那串挤在一起的字）
  await expect(page.locator(".stage-mark-label")).toHaveCount(0);

  const sign = (await boxOf(page, '[data-testid="stage-sign-BQ"] .stage-sign-label'))!;
  expect(sign).toBeTruthy();
  const panel = (await boxOf(page, '[data-testid="stage-campus-panel"]'))!;
  const dock = (await boxOf(page, '[data-testid="stage-dock"]'))!;
  const lanterns = page.locator('[data-testid^="stage-lantern-"]');
  const n = await lanterns.count();
  expect(n).toBe(4);
  for (let i = 0; i < n; i++) {
    const node = lanterns.nth(i);
    const id = await node.getAttribute("data-testid");
    const b = (await node.boundingBox())!;
    expect(overlap(b, sign, 4), `${id} 压住北区题签`).toBe(false);
    expect(overlap(b, panel, 0), `${id} 压住右侧面板`).toBe(false);
    expect(overlap(b, dock, 0), `${id} 压住问话栏`).toBe(false);
  }

  // 信息学院灯牌确实还在，且给了横排短名（悬停）
  const info = page.locator('[data-testid="stage-lantern-5"]');
  await expect(info).toBeVisible();
  await info.hover();
  await page.waitForTimeout(200);
  await expect(info.locator(".stage-lantern-tag-name")).toHaveText("信息科学与技术学院");
});

test("2 同楼多学院（北苑新区）：2/3 仍并排；角标与右侧面板行号来自同一份数据", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BY"]');
  await waitStill(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "by");
  await waitStill(page);
  await page.waitForTimeout(500);

  const b2 = (await page.locator('[data-testid="stage-lantern-2"]').boundingBox())!;
  const b3 = (await page.locator('[data-testid="stage-lantern-3"]').boundingBox())!;
  expect(Math.abs((b2.y + b2.height / 2) - (b3.y + b3.height / 2))).toBeLessThanOrEqual(1);
  expect(Math.abs(Math.abs((b2.x + b2.width / 2) - (b3.x + b3.width / 2)) - 48)).toBeLessThanOrEqual(2);

  // 角标与面板行号同一份数据：机电一行、水建一行，各有自己的序号（一 / 二）
  await expect(page.locator('[data-testid="stage-lantern-2"] .stage-lantern-no')).toHaveText("一");
  await expect(page.locator('[data-testid="stage-lantern-3"] .stage-lantern-no')).toHaveText("二");

  // 回到（全校）北苑新区首页：面板此时是回答面板，没有学院行；改成点左栏进 campus 再看行号
  await page.click('[data-testid="stage-rail-BY"]');
  await waitStill(page);
  await expect(page.locator('[data-testid="stage-college-1"]')).toContainText("机械电气工程学院");
});

test("3 中区独立沙盘：地标题签优先，灯牌不压地标文字", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitStill(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "zq");
  await waitStill(page);
  await page.waitForTimeout(600);

  const landmarks = page.locator('[data-testid^="stage-landmark-"]');
  const lmCount = await landmarks.count();
  expect(lmCount).toBeGreaterThan(0);
  const lanterns = page.locator('[data-testid^="stage-lantern-"]');
  const n = await lanterns.count();
  expect(n).toBeGreaterThan(0);

  let checked = 0;
  for (let i = 0; i < lmCount; i++) {
    const lm = landmarks.nth(i);
    if (!(await lm.isVisible())) continue;
    const lb = (await lm.locator(".stage-sign-label").boundingBox())!;
    for (let j = 0; j < n; j++) {
      const la = lanterns.nth(j);
      if (!(await la.isVisible())) continue;
      const db = (await la.locator(".stage-lantern-disc").boundingBox())!;
      expect(overlap(db, lb, 2), `灯牌 ${await la.getAttribute("data-testid")} 压住地标`).toBe(false);
    }
    checked += 1;
  }
  expect(checked).toBeGreaterThanOrEqual(4);
});

test("4 缩到窄视口：放不下的标签收起、没有横向滚动；面板仍能选中学院", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 700 });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitStill(page);
  await page.waitForTimeout(700);

  const hidden = await page.evaluate(
    () => (window.__campus3d?.labels as { hidden?: string[] } | undefined)?.hidden ?? []
  );
  console.log("1024×700 hidden:", hidden.join(","));
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollW).toBeLessThanOrEqual(1024);

  // 至少仍能从右侧面板选学院；被收起的灯牌不在 Tab 序列里
  await expect(page.locator('[data-testid="stage-college-1"]')).toBeVisible();
  for (const id of hidden.filter((h) => h.startsWith("lantern-"))) {
    const tab = await page
      .locator(`[data-testid="${id.replace("lantern-", "stage-lantern-")}"]`)
      .getAttribute("tabindex");
    expect(tab).toBe("-1");
  }
});

test("5 北区：比例尺与右侧读数都不侵入问话栏", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitStill(page);
  await page.waitForTimeout(600);

  const scale = (await boxOf(page, '[data-testid="stage-scale"]'))!;
  const dock = (await boxOf(page, '[data-testid="stage-dock"]'))!;
  const read = (await boxOf(page, '[data-testid="stage-hud"]'))!;
  expect(scale, "北区应有比例尺").toBeTruthy();
  expect(overlap(scale, dock, 0), "比例尺伸进问话栏").toBe(false);
  expect(overlap(read, dock, 0), "读数压住问话栏").toBe(false);
  // 短比例尺：底板宽度不超过左栏空位（罗盘 + 短比例尺）
  expect(scale.width).toBeLessThanOrEqual(200);
  // 比例尺文字是整米单位，线宽与标注同一比例
  const text = await page.locator('[data-testid="stage-scale"] .stage-scale-text').innerText();
  expect(text).toMatch(/^(500|200|100|50|20|10)\s*米$/);
});

test("6 拿不到院徽时：北区仍有可点的小序号，点了落楼", async ({ page }) => {
  await page.route("**/campus3d/emblems/emblems.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "text/plain", body: "missing" });
  });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitStill(page);
  await page.waitForTimeout(600);

  // 4 行学院都有小序号（没有院徽时的降级），且序号与面板行数一致
  const marks = page.locator('[data-testid^="stage-mark-"]');
  expect(await marks.count()).toBe(4);
  await expect(page.locator('.stage-lanterns [data-testid^="stage-lantern-"]')).toHaveCount(0);

  await page.click('[data-testid="stage-mark-2"]');
  await waitStill(page);
  const h = await page.evaluate(() => ({
    mode: window.__campus3d?.mode,
    shell: window.__campus3d?.shell,
    pin: window.__campus3d?.pin,
  }));
  expect(h.mode).toBe("answer");
  expect([h.shell, h.pin]).toContain("BQ-B013");
});
