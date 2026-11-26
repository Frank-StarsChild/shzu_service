import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// W10：在回答里近看。/stage?3d=1&intro=0，用 W4 的假数据。
// 全校沙盘上答完学生证问题 → 面板「办理地点」右边「近看」→ 换到中区自己的沙盘、
// 开场动画播完镜头落到同一栋楼上（不重新提问）。

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function waitPack(page: Page, packId: string) {
  await page.waitForFunction(
    (id) => window.__campus3d?.status === "ready" && window.__campus3d?.pack === id,
    packId,
    { timeout: 40_000, polling: 200 }
  );
}

async function waitCamStill(page: Page, timeout = 20_000) {
  await page.waitForFunction(
    () => window.__campus3d?.moving === false && window.__campus3d?.status === "ready",
    undefined,
    { timeout, polling: 100 }
  );
}

async function waitFocus(page: Page, stop: string, timeout = 20_000) {
  await page.waitForFunction(
    (s) => window.__campus3d?.stop === s && window.__campus3d?.moving === false,
    stop,
    { timeout, polling: 100 }
  );
}

async function ask(page: Page, text: string) {
  await page.fill('[data-testid="stage-input"]', text);
  await page.press('[data-testid="stage-input"]', "Enter");
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 学生证答完落楼后：在默认包上，「近看」钮可见", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await waitFocus(page, "focus:ZQ-B023");
  const h = await page.evaluate(() => ({
    pack: window.__campus3d.pack,
    shell: window.__campus3d.shell,
  }));
  expect(h.pack).toBe("all");
  expect(h.shell).toBe("ZQ-B023");
  const near = page.locator('[data-testid="stage-place-near"]');
  await expect(near).toBeVisible();
  await expect(near).toContainText("近看");
});

test("2 点「近看」：换到 zq、落回同一栋楼、面板全程在；截图", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await waitFocus(page, "focus:ZQ-B023");
  await page.click('[data-testid="stage-place-near"]');
  await waitPack(page, "zq");
  await waitCamStill(page);
  expect(await page.evaluate(() => window.__campus3d.stop)).toBe("focus:ZQ-B023");
  const h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    shell: window.__campus3d.shell,
  }));
  expect(h.mode).toBe("answer");
  expect(h.shell).toBe("ZQ-B023");
  // 面板内容来自 chat store，与沙盘无关：回答正文与两张公文卡都还在
  const panel = page.locator('[data-testid="stage-panel"]');
  await expect(panel).toContainText("大学生活动中心南楼");
  expect(await panel.locator('[data-testid^="stage-doc-"]').count()).toBe(2);
  await expect(page.locator('[data-testid="stage-panel-place"]')).toContainText("大学生活动中心");
  // 已经在近看的沙盘里：近看钮不再出现；引线还在
  await expect(page.locator('[data-testid="stage-place-near"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-leader"]')).toBeVisible();
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W10-near.png" });
});

test("3 换沙盘全程没有新的 POST /api/v1/chat", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  let chatPosts = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/chat") && r.method() === "POST") chatPosts += 1;
  });
  await ask(page, "学生证丢了去哪补办");
  await waitFocus(page, "focus:ZQ-B023");
  expect(chatPosts).toBe(1);
  await page.click('[data-testid="stage-place-near"]');
  await waitPack(page, "zq");
  await waitCamStill(page);
  await page.waitForTimeout(1000);
  expect(chatPosts).toBe(1); // 换沙盘不重新提问
});

test("4 在 zq 里继续问图书馆：落 ZQ-B034，没有近看钮", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await waitFocus(page, "focus:ZQ-B023");
  await page.click('[data-testid="stage-place-near"]');
  await waitPack(page, "zq");
  await waitCamStill(page);
  // 明确问位置的题才自动落楼（「怎么借书」属于操作说明，按需定位保持视角）
  await ask(page, "图书馆在哪");
  await waitFocus(page, "focus:ZQ-B034");
  const h = await page.evaluate(() => ({
    pack: window.__campus3d.pack,
    shell: window.__campus3d.shell,
  }));
  expect(h.pack).toBe("zq");
  expect(h.shell).toBe("ZQ-B034");
  await expect(page.locator('[data-testid="stage-place-near"]')).toHaveCount(0);
});

test("5 回全校：回 home、楼不红了，回答面板还在", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "图书馆在哪");
  await waitFocus(page, "focus:ZQ-B034");
  await page.click('[data-testid="stage-rail-ALL"]');
  await waitPack(page, "all");
  await waitCamStill(page);
  const h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    shell: window.__campus3d.shell,
  }));
  expect(h.mode).toBe("home");
  expect(h.shell).toBeNull();
  const panel = page.locator('[data-testid="stage-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("图书馆"); // 上一问的回答还在
});

test("6 问范围外的问题：没有办理地点、没有近看钮", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "校长是谁的偶像");
  await waitCamStill(page);
  await expect(page.locator('[data-testid="stage-panel-place"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-place-near"]')).toHaveCount(0);
});

test("7 点近看后立刻问新问题：旧的那一问不再落下", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await waitFocus(page, "focus:ZQ-B023");
  await page.locator('[data-testid="stage-place-near"]').click();
  // 不等换完，立刻问新的问题
  await ask(page, "怎么借书");
  await waitPack(page, "zq");
  await waitCamStill(page);
  await page.waitForTimeout(1000);
  const shell = await page.evaluate(() => window.__campus3d.shell);
  // 新的一问的楼（ZQ-B034）或复位（null），但绝不是旧那一问的 ZQ-B023
  expect(shell === "ZQ-B034" || shell === null).toBe(true);
  expect(shell).not.toBe("ZQ-B023");
});

test("8 近看来回 5 次：每次回全校后资源数都相同", async ({ page }) => {
  test.setTimeout(420_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const first = await page.evaluate(() => ({
    g: window.__campus3d.geometries,
    t: window.__campus3d.textures,
  }));
  for (let i = 0; i < 5; i++) {
    if (i > 0) {
      await page.click('[data-testid="stage-rail-ALL"]');
      await waitPack(page, "all");
    }
    // 每次回到全校并 ready 之后：资源数和第一次相同
    const backAll = await page.evaluate(() => ({
      g: window.__campus3d.geometries,
      t: window.__campus3d.textures,
    }));
    expect(backAll.g, `第 ${i + 1} 轮回全校的 geometries`).toBe(first.g);
    expect(backAll.t, `第 ${i + 1} 轮回全校的 textures`).toBe(first.t);
    await ask(page, "学生证丢了去哪补办");
    await waitFocus(page, "focus:ZQ-B023");
    await page.click('[data-testid="stage-place-near"]');
    await waitPack(page, "zq");
  }
});
