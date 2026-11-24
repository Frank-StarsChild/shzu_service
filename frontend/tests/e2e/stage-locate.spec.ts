import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// 按需定位：hold / offer / auto 三种结果在真实页面上的表现。
// 重点：问候与借阅规则不动镜头；只有「明确问位置 + 唯一结构化目标 + 在当前场景」才飞。

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function waitNotMoving(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 15_000 });
}

async function ask(page: Page, text: string) {
  await page.fill('[data-testid="stage-input"]', text);
  await page.press('[data-testid="stage-input"]', "Enter");
}

async function cam(page: Page) {
  return page.evaluate(() => ({
    mode: window.__campus3d.mode,
    pack: window.__campus3d.pack,
    stop: window.__campus3d.stop,
    zone: window.__campus3d.zone,
    shell: window.__campus3d.shell,
    camera: window.__campus3d.camera,
  }));
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 从已选楼栋问「你好」：发送与答复后都不回全景", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  // 先落到一栋楼（走现成调试入口），再发问候
  await page.evaluate(() => window.__campus3d.debugShowAnswer?.("ZQ-B023"));
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const before = await cam(page);

  await ask(page, "你好");
  // 发送后：面板出现，但视角与镜头保持
  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  const during = await cam(page);
  expect(during.mode).toBe(before.mode);
  expect(during.stop).toBe(before.stop);
  expect(during.pack).toBe(before.pack);

  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("石大智多星");
  await waitNotMoving(page);
  const after = await cam(page);
  expect(after.mode).toBe("answer");
  expect(after.stop).toBe("focus:ZQ-B023");
  expect(after.shell).toBe("ZQ-B023");
  expect(after.pack).toBe(before.pack);
  // 新回答不再把旧楼写成办理地点
  await expect(page.locator('[data-testid="stage-panel-place"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-leader"]')).toHaveCount(0);
  const stops = await page.evaluate(() => (window as unknown as { __stops?: string[] }).__stops ?? []);
  expect(stops).not.toContain("home");
});

test("2 全景问候：正文带楼名 + 图书馆 issuer + 误带 place 卡也不动镜头", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForFunction(() => window.__campus3d?.stop === "home" && window.__campus3d?.moving === false);
  const before = await cam(page);

  await ask(page, "你好");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("石大智多星");
  await waitNotMoving(page);

  const after = await cam(page);
  expect(after.mode).toBe("home");
  expect(after.stop).toBe("home");
  expect(after.zone).toBeNull();
  expect(after.camera.position).toEqual(before.camera.position);
  await expect(page.locator('[data-testid="stage-panel-place"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-place-offer"]')).toHaveCount(0);
  // 引用题签仍可显示
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("官方出处");
});

test("3 数量与时间类问题：引用图书馆也只看答复", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForFunction(() => window.__campus3d?.stop === "home" && window.__campus3d?.moving === false);
  for (const q of [
    ["本科生最多能借几本书", "20 本"],
    ["图书馆几点关门", "22:30"],
  ] as const) {
    await ask(page, q[0]);
    await expect(page.locator('[data-testid="stage-panel"]')).toContainText(q[1]);
    await waitNotMoving(page);
    const h = await cam(page);
    expect(h.mode).toBe("home");
    expect(h.stop).toBe("home");
    await expect(page.locator('[data-testid="stage-panel-place"]')).toHaveCount(0);
    await expect(page.locator('[data-testid="stage-place-offer"]')).toHaveCount(0);
  }
});

test("4 图书馆在哪：自动定位；再问同一地点不重复飞", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "图书馆在哪");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B034" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  expect((await cam(page)).shell).toBe("ZQ-B034");
  await expect(page.locator('[data-testid="stage-panel-place"]')).toContainText("图书馆");

  // 同一地点再问：镜头已经在目标楼 → 只关联本轮，不重复飞
  const before = await cam(page);
  await ask(page, "图书馆在哪");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("图书馆");
  await page.waitForTimeout(500);
  const after = await cam(page);
  expect(after.stop).toBe(before.stop);
  expect(after.camera.position).toEqual(before.camera.position);
  await expect(page.locator('[data-testid="stage-panel-place"]')).toContainText("图书馆");
});

test("5 连续两个楼栋：中间不回全景", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  // 记录飞行过程中的停靠点（不应出现 home）
  await page.evaluate(() => {
    const w = window as unknown as { __stops?: string[] };
    w.__stops = [];
    const t = window.setInterval(() => {
      const s = window.__campus3d?.stop;
      if (s && w.__stops && w.__stops[w.__stops.length - 1] !== s) w.__stops.push(s);
    }, 60);
    window.setTimeout(() => window.clearInterval(t), 12_000);
  });
  await ask(page, "图书馆在哪");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B034" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  const stops = await page.evaluate(() => (window as unknown as { __stops?: string[] }).__stops ?? []);
  expect(stops).not.toContain("home");
});

test("6 两个候选：答复不动，点第二个才到第二栋", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForFunction(() => window.__campus3d?.stop === "home" && window.__campus3d?.moving === false);
  await ask(page, "哪里能还书");
  await expect(page.locator('[data-testid="stage-place-offer"]')).toBeVisible();
  await waitNotMoving(page);
  expect((await cam(page)).mode).toBe("home");

  await expect(page.locator('[data-testid="stage-place-offer-BQ-B018"]')).toContainText("北区图书馆");
  await expect(page.locator('[data-testid="stage-place-offer-ZQ-B034"]')).toContainText("图书馆");
  await page.click('[data-testid="stage-place-offer-ZQ-B034"]');
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B034" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 15_000 }
  );
  expect((await cam(page)).shell).toBe("ZQ-B034");
});

test("7 只有文字地址：显示位置说明，不猜楼", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "老行政楼在哪");
  await expect(page.locator('[data-testid="stage-offer-text"]')).toContainText("老行政楼后面的平房");
  await waitNotMoving(page);
  const h = await cam(page);
  expect(h.mode).toBe("home");
  expect(h.stop).toBe("home");
});

test("8 慢回应期间换校区：旧回应不把人拉回去", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "慢问图书馆在哪");
  // 等待期间用户点北区校区（用 DOM 点击，避免 Playwright 的可点击性等待把点击推迟到答复之后）
  await page.waitForTimeout(250);
  await page.evaluate(() => (document.querySelector('[data-testid="stage-rail-BQ"]') as HTMLElement).click());
  await waitNotMoving(page);
  const picked = await cam(page);
  expect(picked.zone).toBe("BQ");

  // 旧回应回来：不飞回中区图书馆，改给手动入口
  await expect(page.locator('[data-testid="stage-place-offer"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const after = await cam(page);
  expect(after.mode).toBe("campus");
  expect(after.zone).toBe("BQ");
  await expect(page.locator('[data-testid="stage-panel-place"]')).toHaveCount(0);
});

/** 取 pinia 里的 chat store（只给「取消本轮」用例用） */
async function cancelTurn(page: Page) {
  await page.evaluate(() => {
    const app = (document.querySelector("#app") as unknown as { __vue_app__?: any }).__vue_app__;
    app?.config?.globalProperties?.$pinia?._s?.get?.("chat")?.cancel?.();
  });
}

test("9 取消本轮：迟到的回答不飞、不留办理地点", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.waitForFunction(() => window.__campus3d?.stop === "home" && window.__campus3d?.moving === false);
  const before = await cam(page);

  await ask(page, "慢问图书馆在哪");
  await page.waitForTimeout(300);
  await cancelTurn(page);
  await page.waitForTimeout(2200);

  const after = await cam(page);
  expect(after.stop).toBe(before.stop);
  expect(after.mode).toBe("home");
  expect(after.camera.position).toEqual(before.camera.position);
  await expect(page.locator('[data-testid="stage-panel-place"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-place-offer"]')).toHaveCount(0);
});
