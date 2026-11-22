import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// W11：构图偏移（模型随面板状态左移）、回答面板收起/展开、右键平移与重置视角。
// 全部 /stage?3d=1&intro=0；软渲染一帧可能数百毫秒，等待一律用轮询。

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function ask(page: Page, text: string) {
  await page.fill('[data-testid="stage-input"]', text);
  await page.press('[data-testid="stage-input"]', "Enter");
}

async function waitStop(page: Page, stop: string, timeout = 20_000) {
  await page.waitForFunction(
    (s) => window.__campus3d?.stop === s && window.__campus3d?.moving === false,
    stop,
    { timeout, polling: 100 }
  );
}

/** 画布上不压任何悬浮控件（题签/校区列表/问话栏/回答面板/顶栏/读数/星）的空点：
 *  拖动和滚轮都在这里做，避免把拖动误点到场景题签的校区按钮上 */
async function freePoint(page: Page) {
  const cb = (await page.locator('[data-testid="stage-canvas"]').boundingBox())!;
  const rects = await page.evaluate(() => {
    const sels = ".stage-sign, .stage-rail, .stage-dock, .stage-answer, .stage-top, .stage-hud-widget, .stage-star";
    return Array.from(document.querySelectorAll(sels)).map((el) => {
      const r = (el as HTMLElement).getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    });
  });
  for (let fy = 0.32; fy <= 0.9; fy += 0.07) {
    for (let fx = 0.1; fx <= 0.62; fx += 0.06) {
      const px = cb.x + cb.width * fx;
      const py = cb.y + cb.height * fy;
      const hit = rects.some(
        (r) => px >= r.x - 6 && px <= r.x + r.w + 6 && py >= r.y - 6 && py <= r.y + r.h + 6
      );
      if (!hit) return { x: px, y: py };
    }
  }
  return { x: cb.x + cb.width * 0.4, y: cb.y + cb.height * 0.4 };
}

async function camDist(page: Page) {
  return page.evaluate(() => {
    const p = window.__campus3d.camera.position;
    const t = window.__campus3d.camera.target;
    return Math.hypot(p[0] - t[0], p[1] - t[1], p[2] - t[2]);
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 构图偏移：默认 48；回答展开后 ≥118；收起回到 48（1440 下面板约 403px）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await expect.poll(() => page.evaluate(() => window.__campus3d.framing)).toBe(48);
  await ask(page, "学生证丢了去哪补办");
  await waitStop(page, "focus:ZQ-B023");
  await expect.poll(() => page.evaluate(() => window.__campus3d.framing), { timeout: 5_000 }).toBeGreaterThanOrEqual(118);
  const w = await page.locator(".stage-answer").evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(w)).toBe(403); // clamp(320px, 28vw, 428px) @1440
  // 收起：面板隐藏、只剩展开钮、偏移回基线
  await page.click('[data-testid="stage-answer-collapse"]');
  await expect(page.locator('[data-testid="stage-panel"]')).toBeHidden();
  await expect(page.locator('[data-testid="stage-answer-expand"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__campus3d.framing), { timeout: 5_000 }).toBe(48);
  // 展开按钮在统一顶栏下方、不与主题开关重叠
  const exp = await page.locator('[data-testid="stage-answer-expand"]').boundingBox();
  const theme = await page.locator('[data-testid="theme-switch"]').boundingBox();
  expect(exp!.y).toBeGreaterThanOrEqual(theme!.y + theme!.height);
  expect(exp!.y + exp!.height).toBeLessThanOrEqual(theme!.y + 300);
});

test("2 收起→展开：视角与内容保留；重新打开不再发同一个请求", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await waitStop(page, "focus:ZQ-B023");
  const cam0 = await page.evaluate(() => window.__campus3d.camera.position);
  let chatPosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/v1/chat")) chatPosts += 1;
  });
  await page.click('[data-testid="stage-answer-collapse"]');
  await expect(page.locator('[data-testid="stage-answer-expand"]')).toBeVisible();
  // aria 状态正确
  expect(await page.locator('[data-testid="stage-answer-expand"]').getAttribute("aria-expanded")).toBe("false");
  await page.click('[data-testid="stage-answer-expand"]');
  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  expect(await page.locator('[data-testid="stage-answer-collapse"]').getAttribute("aria-expanded")).toBe("true");
  // 展开恢复的是刚才那轮内容
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("大学生活动中心南楼");
  // 收展不动镜头（相机位置与距离都不变）
  const cam1 = await page.evaluate(() => window.__campus3d.camera.position);
  for (const i of [0, 1, 2] as const) {
    expect(Math.abs(cam1[i] - cam0[i]), `camera[${i}]`).toBeLessThan(0.5);
  }
  await page.waitForTimeout(400);
  expect(chatPosts).toBe(0);
});

test("3 生成中收起：后台完成后保持收起；home 态题字恢复，展开时题字淡出", async ({ page }) => {
  // 先注册一个延迟 1.2s 的 chat 路由（后注册优先），其余交给 mockApi 兜底
  await page.route("**/api/v1/chat", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { message?: string };
    if ((body.message ?? "").includes("校长")) {
      await new Promise((r) => setTimeout(r, 1200));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "sess-stage-test",
          request_id: "req-stage-test",
          trace_id: "trace-stage-test",
          knowledge_version: "kb-test-000",
          status: "out_of_scope",
          message: "这个问题不在校园办事范围内。智多星只回答与学校办事相关的问题。",
          unknown_fields: [],
          citations: [],
          timing_ms: 100,
        }),
      });
      return;
    }
    await route.fallback();
  });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "校长是谁的偶像");
  // pending：面板展开（自动重新展开）、题字淡出（home 态 + 面板展开）
  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("正在翻查");
  await expect
    .poll(() => page.locator('[data-testid="stage-hero"]').evaluate((el) => getComputedStyle(el).opacity), { timeout: 8_000 })
    .toBe("0");
  // 生成中收起
  await page.click('[data-testid="stage-answer-collapse"]');
  await expect(page.locator('[data-testid="stage-panel"]')).toBeHidden();
  // home + 已收起 → 题字回来
  await expect
    .poll(() => page.locator('[data-testid="stage-hero"]').evaluate((el) => getComputedStyle(el).opacity), { timeout: 8_000 })
    .toBe("1");
  // 等后台返回（1.2s 延迟）：仍收起
  await page.waitForTimeout(1800);
  await expect(page.locator('[data-testid="stage-panel"]')).toBeHidden();
  await expect(page.locator('[data-testid="stage-answer-expand"]')).toBeVisible();
  // 展开：直接显示刚才那轮
  await page.click('[data-testid="stage-answer-expand"]');
  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("不在办事范围内");
});

test("4 重置视角：拖乱后回 home；选校区后回 bq；回答态回楼栋机位（校区与对话保留）", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const c = await freePoint(page);

  // home 态拖乱 → 重置回 home
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 250, c.y + 80, { steps: 8 });
  await page.mouse.up();
  await waitStop(page, "free");
  await page.click('[data-testid="stage-tool-reset"]');
  await waitStop(page, "home");

  // 校区态拖乱 → 重置回该校区停靠点，校区选择保留
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitStop(page, "bq");
  const c2 = await freePoint(page);
  await page.mouse.move(c2.x, c2.y);
  await page.mouse.down();
  await page.mouse.move(c2.x - 220, c2.y - 60, { steps: 8 });
  await page.mouse.up();
  await waitStop(page, "free");
  await page.click('[data-testid="stage-tool-reset"]');
  await waitStop(page, "bq");
  expect(await page.evaluate(() => window.__campus3d.zone)).toBe("BQ");

  // 回答态（定位楼栋）拖乱 → 重置回楼栋机位，高亮与面板保留
  await ask(page, "学生证丢了去哪补办");
  await waitStop(page, "focus:ZQ-B023");
  const c3 = await freePoint(page);
  await page.mouse.move(c3.x, c3.y);
  await page.mouse.down();
  await page.mouse.move(c3.x + 180, c3.y, { steps: 6 });
  await page.mouse.up();
  await waitStop(page, "free");
  await page.click('[data-testid="stage-tool-reset"]');
  await waitStop(page, "focus:ZQ-B023");
  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  expect(await page.evaluate(() => window.__campus3d.shell)).toBe("ZQ-B023");
});

test("5 右键平移：target 跟着走且 stop=free；疯狂平移也出不了校园包围盒；右键拖动不触发点击", async ({ page }) => {
  test.setTimeout(90_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const c = await freePoint(page);
  const t0 = await page.evaluate(() => window.__campus3d.camera.target);

  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(c.x - 360, c.y - 120, { steps: 12 });
  await page.mouse.up({ button: "right" });
  await waitStop(page, "free");
  const t1 = await page.evaluate(() => window.__campus3d.camera.target);
  // 平移真的移动了目标点
  expect(Math.hypot(t1[0] - t0[0], t1[2] - t0[2])).toBeGreaterThan(50);
  // 方位角仍是有效值（target 同步后罗盘/重置一致）
  const az = await page.evaluate(() => window.__campus3d.azimuth);
  expect(az).toBeGreaterThanOrEqual(0);
  expect(az).toBeLessThan(360);

  // 疯狂平移：被夹在模型包围盒（外扩 60）内
  await page.mouse.move(c.x, c.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(c.x - 4000, c.y + 4000, { steps: 20 });
  await page.mouse.up({ button: "right" });
  await waitStop(page, "free");
  const t2 = await page.evaluate(() => window.__campus3d.camera.target);
  const b = (await page.evaluate(() => window.__campus3d.panBounds))!;
  expect(b.length).toBe(6);
  expect(t2[0]).toBeGreaterThanOrEqual(b[0] - 1);
  expect(t2[0]).toBeLessThanOrEqual(b[3] + 1);
  expect(t2[1]).toBeGreaterThanOrEqual(b[1] - 1);
  expect(t2[1]).toBeLessThanOrEqual(b[4] + 1);
  expect(t2[2]).toBeGreaterThanOrEqual(b[2] - 1);
  expect(t2[2]).toBeLessThanOrEqual(b[5] + 1);

  // 右键拖动不误触建筑点击（没有弹回答、没换区）
  await expect(page.locator('[data-testid="stage-panel"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("home");
});

test("6 1920：面板宽度 428、展开偏移 ≥118；面板内滚轮只滚回答不缩放沙盘", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await waitStop(page, "focus:ZQ-B023");
  const w = await page.locator(".stage-answer").evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(w)).toBe(428); // clamp 上限 @1920
  await expect.poll(() => page.evaluate(() => window.__campus3d.framing)).toBeGreaterThanOrEqual(118);

  // 滚轮放在回答面板上：相机距离不变（画布内的滚轮才缩放）
  const d0 = await camDist(page);
  const box = await page.locator(".stage-panel-scroll").boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + 40);
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(600);
  const d1 = await camDist(page);
  expect(Math.abs(d1 - d0) / d0, `面板滚轮前后距离 ${d0.toFixed(1)} → ${d1.toFixed(1)}`).toBeLessThan(0.01);

  // 画布内滚轮仍正常缩放（找一个不压任何控件的空点）
  const cb = (await page.locator('[data-testid="stage-canvas"]').boundingBox())!;
  const wp = await freePoint(page);
  await page.mouse.move(wp.x, wp.y);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -120);
  await waitStop(page, "free");
  const d2 = await camDist(page);
  expect(d2).toBeLessThan(d1);
  expect(cb.width).toBeGreaterThan(0);
});

test("7 1920 收起再展开：用户手动视角（旋转+缩放+平移）完整保留", async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "随便问点别的"); // 资料不足：无楼栋定位，不动机位
  await page.waitForTimeout(800);
  const c = await freePoint(page);
  // 旋转
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y, { steps: 8 });
  await page.mouse.up();
  await waitStop(page, "free");
  // 平移
  const c2 = await freePoint(page);
  await page.mouse.move(c2.x, c2.y);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(c2.x - 200, c2.y - 80, { steps: 8 });
  await page.mouse.up({ button: "right" });
  // 缩放
  await waitStop(page, "free");
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -100);
  await waitStop(page, "free");
  await page.waitForTimeout(600);
  const cam0 = await page.evaluate(() => ({
    position: window.__campus3d.camera.position,
    target: window.__campus3d.camera.target,
  }));

  // 收起 → 展开：视角原样
  await page.click('[data-testid="stage-answer-collapse"]');
  await expect(page.locator('[data-testid="stage-panel"]')).toBeHidden();
  await page.waitForTimeout(300);
  await page.click('[data-testid="stage-answer-expand"]');
  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  await page.waitForTimeout(300);
  const cam1 = await page.evaluate(() => ({
    position: window.__campus3d.camera.position,
    target: window.__campus3d.camera.target,
  }));
  for (const key of ["position", "target"] as const) {
    for (const i of [0, 1, 2] as const) {
      expect(Math.abs(cam1[key][i] - cam0[key][i]), `${key}[${i}]`).toBeLessThan(0.5);
    }
  }
  expect(await page.evaluate(() => window.__campus3d.stop)).toBe("free");
});
