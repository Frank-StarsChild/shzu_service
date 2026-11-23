// ALIVE A2 验证：学院灯牌（校区沙盘首页每学院主楼上方 40px 鎏金院徽 + 金线落楼）。
// 期望值全部从真实 JSON 算（可数的都自己算，不写死）；对照 alive-lanterns.jpg。
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

type Anchor = [number, number, number];
type MetaLike = {
  colleges: { no: number; zone: string; buildingIds: string[] }[];
  buildings: Record<string, { anchor: Anchor } | undefined>;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, import.meta.url), "utf-8"));
}

const allMetaRaw = readJson("../../public/campus3d/all/campus.meta.json") as MetaLike & { zones: unknown[] };
const zqMetaRaw = readJson("../../public/campus3d/zq/campus.meta.json") as MetaLike;
const byMetaRaw = readJson("../../public/campus3d/by/campus.meta.json") as MetaLike;
const emblemsRaw = readJson("../../public/campus3d/emblems/emblems.json") as {
  colleges: { no: number; buildingIds: string[] }[];
};

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function waitNotMoving(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 15_000 });
}

async function waitPack(page: Page, packId: string) {
  await page.waitForFunction(
    (id) => window.__campus3d?.status === "ready" && window.__campus3d?.pack === id,
    packId,
    { timeout: 40_000 }
  );
}

/** 照 A2 第 1 条的规则从 JSON 算：某个包里应画的灯牌与楼号（不含模式过滤） */
function expectedLanterns(meta: MetaLike): { no: number; buildingId: string; offset: number }[] {
  const picked: { no: number; buildingId: string }[] = [];
  for (const mc of meta.colleges) {
    const ec = emblemsRaw.colleges.find((c) => c.no === mc.no);
    if (!ec) continue;
    const bid = ec.buildingIds.find((id) => meta.buildings[id]?.anchor);
    if (!bid) continue;
    picked.push({ no: mc.no, buildingId: bid });
  }
  // 同楼并排：第 i 个偏移 (i − (n−1)/2) × 48
  const byBid = new Map<string, { no: number; buildingId: string }[]>();
  for (const p of picked) {
    const arr = byBid.get(p.buildingId) ?? [];
    arr.push(p);
    byBid.set(p.buildingId, arr);
  }
  const out: { no: number; buildingId: string; offset: number }[] = [];
  for (const arr of byBid.values()) {
    arr.forEach((p, i) => out.push({ ...p, offset: (i - (arr.length - 1) / 2) * 48 }));
  }
  return out;
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 全校沙盘首页：不画灯牌（lanterns=0，页面上没有灯牌）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => window.__campus3d?.lanterns)).toBe(0);
  await expect(page.locator('[data-testid^="stage-lantern-"]')).toHaveCount(0);
});

test("2 全校沙盘选中中区：灯牌数等于按 JSON 算出的中区学院数", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitNotMoving(page);
  const expected = expectedLanterns(allMetaRaw).filter((l) => {
    const mc = allMetaRaw.colleges.find((c) => c.no === l.no);
    return mc?.zone === "ZQ";
  });
  // 等每帧更新后的可见计数到位
  await page.waitForFunction(
    (n) => (window.__campus3d?.lanterns ?? -1) === n,
    expected.length,
    { timeout: 10_000 }
  );
  const visible = await page.locator('[data-testid^="stage-lantern-"]').count();
  expect(visible).toBe(expected.length);
});

test("3 进入中区沙盘：灯牌底端对准它那栋楼的 anchor（±3px）；被挤开的用水平引线补回锚点", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitNotMoving(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "zq");
  await waitNotMoving(page);
  await page.waitForTimeout(300);
  const expected = expectedLanterns(zqMetaRaw);
  expect(expected.length).toBeGreaterThan(0);
  const debug = await page.evaluate(() => ({
    labels: window.__campus3d?.labels as { shifted?: string[] } | undefined,
    layouts: window.__campus3d?.labelLayouts as
      | Record<string, { form: string; x: number; w: number; ax: number }>
      | undefined,
  }));
  for (const l of expected) {
    const lantern = page.locator(`[data-testid="stage-lantern-${l.no}"]`);
    await expect(lantern).toBeVisible();
    const box = (await lantern.boundingBox())!;
    const anchor = zqMetaRaw.buildings[l.buildingId]!.anchor;
    const p = await page.evaluate((pt) => window.__campus3d?.projectPoint(pt), anchor as unknown as number[]);
    expect(p, `no.${l.no} 的 anchor 投影`).toBeTruthy();
    const cx = box.x + box.width / 2;
    const bottom = box.y + box.height;
    // 纵向任何时候都对准锚点（错开只做水平位移）
    expect(Math.abs(bottom - p!.y), `no.${l.no} 纵向`).toBeLessThanOrEqual(3);
    const L = debug.layouts?.[`lantern-${l.no}`];
    const shifted = debug.labels?.shifted?.includes(`lantern-${l.no}`) === true;
    if (!shifted) {
      // 原行为：默认位就在楼顶正上方
      expect(Math.abs(cx - (p!.x + l.offset)), `no.${l.no} 横向`).toBeLessThanOrEqual(3);
    } else {
      // 新避让态：灯牌让开，但引线末端仍在真实锚点上
      expect(L, `no.${l.no} 应有布局结果`).toBeTruthy();
      expect(Math.abs(L!.ax - (p!.x + l.offset)), `no.${l.no} 布局锚点`).toBeLessThanOrEqual(3);
      expect(Math.abs(cx - (L!.x + L!.w / 2)), `no.${l.no} 灯牌中心`).toBeLessThanOrEqual(2);
      const dx = Math.abs(L!.x + L!.w / 2 - L!.ax);
      expect(dx, `no.${l.no} 应真的错开`).toBeGreaterThan(3);
      const lw = await lantern
        .locator(".stage-lantern-leader")
        .evaluate((el) => Number.parseFloat(getComputedStyle(el).width));
      expect(Math.abs(lw - dx), `no.${l.no} 水平引线长度`).toBeLessThanOrEqual(2);
    }
  }
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/A2-zq.png" });
});

test("4 北苑新区沙盘：同楼的 2/3 并排（纵差 ≤1px、横差 48±2px）；截图 A2-by", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BY"]');
  await waitNotMoving(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "by");
  await waitNotMoving(page);
  await page.waitForTimeout(300);
  const b2 = (await page.locator('[data-testid="stage-lantern-2"]').boundingBox())!;
  const b3 = (await page.locator('[data-testid="stage-lantern-3"]').boundingBox())!;
  const cy2 = b2.y + b2.height / 2;
  const cy3 = b3.y + b3.height / 2;
  expect(Math.abs(cy2 - cy3)).toBeLessThanOrEqual(1);
  const dx = Math.abs((b2.x + b2.width / 2) - (b3.x + b3.width / 2));
  expect(Math.abs(dx - 48)).toBeLessThanOrEqual(2);
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/A2-by.png" });
});

test("5 悬停法学院灯牌：院徽放大到 50px、出现「法学院」题签", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitNotMoving(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "zq");
  await waitNotMoving(page);
  const lantern = page.locator('[data-testid="stage-lantern-16"]');
  await expect(lantern).toBeVisible();
  await lantern.hover();
  await page.waitForTimeout(250);
  const box = (await lantern.locator('[data-testid="stage-emblem-16"]').boundingBox())!;
  expect(Math.abs(box.width - 50)).toBeLessThanOrEqual(1);
  await expect(lantern.locator(".stage-lantern-tag-name")).toHaveText("法学院");
});

test("6 点法学院灯牌：飞到 ZQ-B018、college=16、灯牌收起", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitNotMoving(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "zq");
  await waitNotMoving(page);
  await page.click('[data-testid="stage-lantern-16"]');
  await waitNotMoving(page);
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => ({
    mode: window.__campus3d?.mode,
    shell: window.__campus3d?.shell,
    college: window.__campus3d?.college,
  }));
  expect(h.mode).toBe("answer");
  expect(h.shell).toBe("ZQ-B018");
  expect(h.college).toBe(16);
  await expect(page.locator('[data-testid^="stage-lantern-"]')).toHaveCount(0);
});

test("7 七块沙盘都换一遍：控制台无报错；校区沙盘首页灯牌都 > 0", async ({ page }) => {
  test.setTimeout(300_000); // 七块沙盘要反复加载 3D 场景，默认 30s 装不下
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  // 全校沙盘：依次选中每个校区（每次独立进入，避免上一轮镜头飞行中的元素动画）
  for (const id of ["BY", "BQ", "ZQ", "NQ", "DQ", "JJ"]) {
    await page.goto("/stage?3d=1&intro=0");
    await waitReady(page);
    await page.click(`[data-testid="stage-rail-${id}"]`);
    await waitNotMoving(page);
    const h = await page.evaluate(() => ({ mode: window.__campus3d?.mode, zone: window.__campus3d?.zone }));
    if (id === "JJ") {
      expect(h.mode).toBe("home"); // 将军山不在全校沙盘上：直接换成 jjs 包（校区沙盘首页）
      await page.waitForFunction(
        () => window.__campus3d?.status === "ready" && window.__campus3d?.pack === "jjs",
        undefined,
        { timeout: 40_000 }
      );
      await page.waitForFunction(() => (window.__campus3d?.lanterns ?? 0) > 0, undefined, { timeout: 10_000 });
    } else {
      expect(h.mode).toBe("campus");
      expect(h.zone).toBe(id);
    }
  }
  // 六个校区沙盘首页（每次都从全校沙盘重新进，避免上一轮已换到别的包）
  for (const id of ["BY", "BQ", "ZQ", "NQ", "DQ"]) {
    await page.goto("/stage?3d=1&intro=0");
    await waitReady(page);
    await page.click(`[data-testid="stage-rail-${id}"]`);
    await waitNotMoving(page);
    await page.click('[data-testid="stage-rail-enter"]');
    await waitNotMoving(page);
    await page.waitForFunction(() => (window.__campus3d?.lanterns ?? 0) > 0, undefined, { timeout: 15_000 });
    const n = await page.evaluate(() => window.__campus3d?.lanterns ?? 0);
    expect(n, `${id} 沙盘首页灯牌数`).toBeGreaterThan(0);
  }
  expect(errors, `控制台报错：${errors.join(" | ")}`).toHaveLength(0);
});
