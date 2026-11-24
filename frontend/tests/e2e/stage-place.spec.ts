import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// W5：回答落到楼上。/stage?3d=1&intro=0；用 W4 的假数据。
// 原理：不让大模型猜地点——回答文字里的楼名、出处的发布单位查 places.json 得到楼号。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as {
  buildings: Record<string, { name: string; anchor: [number, number, number]; zone: string }>;
};
const zqMetaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/zq/campus.meta.json", import.meta.url), "utf-8")
) as {
  buildings: Record<string, { name: string; anchor: [number, number, number]; zone: string }>;
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

async function ask(page: Page, text: string) {
  await page.fill('[data-testid="stage-input"]', text);
  await page.press('[data-testid="stage-input"]', "Enter");
}

/** is-shot 截图统计偏红像素占比（R>140 且 R−G>50 且 R−B>50），完事移除 is-shot。 */
async function reddishRatio(page: Page): Promise<number> {
  await page.evaluate(() => {
    document.querySelector('[data-testid="stage"]')?.classList.add("is-shot");
  });
  await page.waitForTimeout(150);
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

test("1 学生证：answer 态、外壳 ZQ-B023、镜头 focus、偏红 >0.011", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    stop: window.__campus3d.stop,
  }));
  expect(h.mode).toBe("answer");
  expect(h.shell).toBe("ZQ-B023");
  expect(h.pin).toBeNull();
  expect(h.stop).toBe("focus:ZQ-B023");
  expect(await reddishRatio(page)).toBeGreaterThan(0.011);
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W5-answer.png" });
});

test("2 面板办理地点与楼的题签", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  await expect(page.locator('[data-testid="stage-panel-place"]')).toContainText("大学生活动中心");
  await expect(page.locator('[data-testid="stage-panel-place"]')).toContainText("中区");
  await expect(page.locator('[data-testid="stage-sign-ZQ-B023"]')).toBeVisible();
});

test("3 楼在画面左中：anchor 投影横坐标在 14%–50%（W11 构图偏移后模型整体左移）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const width = page.viewportSize()?.width ?? 1440;
  const x = await page.evaluate(
    (anchor) => window.__campus3d.projectPoint(anchor).x,
    metaRaw.buildings["ZQ-B023"].anchor
  );
  expect(x).toBeGreaterThan(width * 0.14);
  expect(x).toBeLessThan(width * 0.5);
});

test("4 红色引线：末端与 anchor−6 的投影横向相差 30±3、纵向 ≤3", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const leader = page.locator('[data-testid="stage-leader"]');
  await expect(leader).toBeVisible();
  const check = await page.evaluate((anchor) => {
    const svg = document.querySelector('[data-testid="stage-leader"]');
    const poly = svg?.querySelector("polyline");
    const pts = poly?.getAttribute("points") ?? "";
    const last = pts.trim().split(/\s+/).pop() ?? "";
    const [lx, ly] = last.split(",").map(Number);
    const p = window.__campus3d.projectPoint([anchor[0], anchor[1] - 6, anchor[2]]);
    return { dx: lx - p.x, dy: ly - p.y };
  }, metaRaw.buildings["ZQ-B023"].anchor);
  expect(Math.abs(check.dx - 30)).toBeLessThanOrEqual(3);
  expect(Math.abs(check.dy)).toBeLessThanOrEqual(3);
});

test("5 成绩单→行政楼、借书→图书馆（问「去哪」才定位）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "成绩单去哪打印");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B024",
    undefined,
    { timeout: 15_000 }
  );
  expect(await page.evaluate(() => window.__campus3d.shell)).toBe("ZQ-B024");
  await ask(page, "去哪借书");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B034",
    undefined,
    { timeout: 15_000 }
  );
  expect(await page.evaluate(() => window.__campus3d.shell)).toBe("ZQ-B034");
});

test("6 超出范围：不落楼，回 home，无引线无办理地点", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "校长是谁的偶像");
  await waitNotMoving(page);
  const h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    shell: window.__campus3d.shell,
    stop: window.__campus3d.stop,
  }));
  expect(h.mode).toBe("home");
  expect(h.shell).toBeNull();
  expect(h.stop).toBe("home");
  await expect(page.locator('[data-testid="stage-leader"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-panel-place"]')).toHaveCount(0);
});

test("7 音乐系：楼在将军山，先给手动入口，点了才落到 JJ-B019", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "音乐系在哪");
  await waitNotMoving(page);
  const h0 = await page.evaluate(() => ({ mode: window.__campus3d.mode, pack: window.__campus3d.pack }));
  expect(h0.mode).not.toBe("answer");
  expect(h0.pack).toBe("all");
  await expect(page.locator('[data-testid="stage-place-offer"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-place-offer-JJ-B019"]')).toContainText("将军山校区");
  await page.click('[data-testid="stage-place-offer-JJ-B019"]');
  await waitPack(page, "jjs");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:JJ-B019" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const h1 = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    shell: window.__campus3d.shell,
  }));
  expect(h1.mode).toBe("answer");
  expect(h1.shell).toBe("JJ-B019");
});

test("8 debugShowAnswer('BQ-B001')：没有外壳的楼用图钉，偏红 >0.0035", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ALL"]');
  await waitNotMoving(page);
  await page.evaluate(() => window.__campus3d.debugShowAnswer?.("BQ-B001"));
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:BQ-B001" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const h = await page.evaluate(() => ({
    pin: window.__campus3d.pin,
    shell: window.__campus3d.shell,
  }));
  expect(h.pin).toBe("BQ-B001");
  expect(h.shell).toBeNull();
  expect(await reddishRatio(page)).toBeGreaterThan(0.0035);
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W5-pin.png" });
});

test("9 点北区：外壳图钉都收，引线消失", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitNotMoving(page);
  const h = await page.evaluate(() => ({
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    zone: window.__campus3d.zone,
  }));
  expect(h.shell).toBeNull();
  expect(h.pin).toBeNull();
  expect(h.zone).toBe("BQ");
  await expect(page.locator('[data-testid="stage-leader"]')).toHaveCount(0);
});

test("10 连问 10 个不同的问题：geometries、textures 不变", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const before = await page.evaluate(() => ({
    g: window.__campus3d.geometries,
    t: window.__campus3d.textures,
  }));
  const questions = [
    "学生证丢了去哪补办",
    "怎么借书",
    "成绩单怎么打印",
    "怎么补办卡",
    "校长是谁的偶像",
    "奖学金怎么申请",
    "音乐系在哪",
    "出错",
    "随便问点别的",
    "学生证办理时间",
  ];
  for (const q of questions) {
    await ask(page, q);
    await page.waitForFunction(
      () => window.__campus3d?.moving === false,
      undefined,
      { timeout: 15_000 }
    );
  }
  const after = await page.evaluate(() => ({
    g: window.__campus3d.geometries,
    t: window.__campus3d.textures,
  }));
  expect(after.g).toBe(before.g);
  expect(after.t).toBe(before.t);
});

test("11 换到中区自己的沙盘再问学生证：同一栋楼直接落（不看 packOf）", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitNotMoving(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "zq");
  await ask(page, "学生证丢了去哪补办");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const h = await page.evaluate(() => ({
    pack: window.__campus3d.pack,
    mode: window.__campus3d.mode,
    shell: window.__campus3d.shell,
  }));
  expect(h.pack).toBe("zq");
  expect(h.mode).toBe("answer");
  expect(h.shell).toBe("ZQ-B023");
  await expect(page.locator('[data-testid="stage-other-pack"]')).toHaveCount(0);
  // 第 3 条在这里同样成立：楼在画面左中（用 zq 沙盘自己的坐标；W11 构图偏移后整体左移）
  const width = page.viewportSize()?.width ?? 1440;
  const x = await page.evaluate(
    (anchor) => window.__campus3d.projectPoint(anchor).x,
    zqMetaRaw.buildings["ZQ-B023"].anchor
  );
  expect(x).toBeGreaterThan(width * 0.14);
  expect(x).toBeLessThan(width * 0.5);
  // 第 4 条在这里同样成立：红色引线末端对齐
  const check = await page.evaluate((anchor) => {
    const svg = document.querySelector('[data-testid="stage-leader"]');
    const poly = svg?.querySelector("polyline");
    const pts = poly?.getAttribute("points") ?? "";
    const last = pts.trim().split(/\s+/).pop() ?? "";
    const [lx, ly] = last.split(",").map(Number);
    const p = window.__campus3d.projectPoint([anchor[0], anchor[1] - 6, anchor[2]]);
    return { dx: lx - p.x, dy: ly - p.y };
  }, zqMetaRaw.buildings["ZQ-B023"].anchor);
  expect(Math.abs(check.dx - 30)).toBeLessThanOrEqual(3);
  expect(Math.abs(check.dy)).toBeLessThanOrEqual(3);
  // 偏红像素（近看沙盘的楼更大更红）
  expect(await reddishRatio(page)).toBeGreaterThan(0.015);
});

test("12 还在 zq：音乐系指将军山；北区会堂指「全校」沙盘", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitNotMoving(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "zq");
  // 问「音乐系在哪」：楼在 jjs 沙盘上，先给手动入口（不自动换包）
  await ask(page, "音乐系在哪");
  await waitNotMoving(page);
  await expect(page.locator('[data-testid="stage-place-offer"]')).toContainText("将军山校区");
  // 直接换目标楼：BQ-B019 不在 zq 沙盘上，换成「全校」
  await page.evaluate(() => window.__campus3d.debugShowAnswer?.("BQ-B019"));
  await page.waitForFunction(
    () => window.__campus3d?.stop === "home" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const h0 = await page.evaluate(() => window.__campus3d.mode);
  expect(h0).not.toBe("answer");
  await expect(page.locator('[data-testid="stage-other-pack"]')).toContainText("全校");
  // 点它：换回 all，ready 后落到 BQ-B019（有外壳 → shell）
  await page.click('[data-testid="stage-other-pack"]');
  await packReadyAndAnswer(page, "all", "BQ-B019");
  expect(await page.evaluate(() => window.__campus3d.shell)).toBe("BQ-B019");
});

/** 等 pack ready 且 moving false（第 12 条用的组合等待） */
async function packReadyAndAnswer(page: Page, packId: string, buildingId: string) {
  await page.waitForFunction(
    ({ id, bid }) =>
      window.__campus3d?.status === "ready"
      && window.__campus3d?.pack === id
      && window.__campus3d?.stop === `focus:${bid}`
      && window.__campus3d?.moving === false,
    { id: packId, bid: buildingId },
    { timeout: 40_000 }
  );
}
