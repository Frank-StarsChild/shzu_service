import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// PLAN S6：镜头——停靠点、过渡、按需渲染。全部 /?3d=1 打开。

const META_STOPS = {
  lib: { position: [-255.19, 218.68, 480.26] },
};

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, {
    timeout: 20_000,
  });
}

async function frames(page: Page): Promise<number> {
  return page.evaluate(() => window.__campus3d.frames);
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 悬停「图书馆」→ 镜头到 lib 停靠点", async ({ page }) => {
  await page.goto("/?3d=1");
  await waitReady(page);
  await page.locator('.board-tile[data-board="图书馆"]').hover();

  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  const cam = await page.evaluate(() => window.__campus3d.camera.position);
  for (const i of [0, 1, 2] as const) {
    expect(Math.abs(cam[i] - META_STOPS.lib.position[i]), `position[${i}]`).toBeLessThan(0.5);
  }
});

test("2 移动期间 frames 增加 ≥10；静止后 2 秒增量 0", async ({ page }) => {
  await page.goto("/?3d=1");
  await waitReady(page);
  await page.waitForTimeout(800); // 确保没有残余渲染

  const f1 = await frames(page);
  await page.locator('.board-tile[data-board="图书馆"]').hover();

  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === true,
    undefined,
    { timeout: 5_000 }
  ).catch(() => {});
  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  const f2 = await frames(page);
  expect(f2 - f1, "整个过渡期间的渲染帧数").toBeGreaterThanOrEqual(10);

  await page.waitForTimeout(1000);
  const f3 = await frames(page);
  await page.waitForTimeout(1000);
  const f4 = await frames(page);
  expect(f3 - f2 + (f4 - f3), "静止后的渲染帧数（应为 0，一帧都不画）").toBe(0);
});

test("3 移到页面空白处 → 3 秒内回 overview", async ({ page }) => {
  await page.goto("/?3d=1");
  await waitReady(page);
  await page.locator('.board-tile[data-board="图书馆"]').hover();
  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );

  await page.mouse.move(5, 5); // 空白处
  await page.waitForFunction(
    () => window.__campus3d.stop === "overview" && window.__campus3d.moving === false,
    undefined,
    { timeout: 3_000 }
  );
});

test("4 reducedMotion 下 200ms 内到位（无过渡）", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?3d=1");
  await waitReady(page);

  // 在页面里记录 mouseenter 的时刻：从指针进入按钮到镜头到位计时，
  // 排除 Playwright hover 动作本身在软件渲染下的耗时（实测可达 1s+）。
  await page.evaluate(() => {
    const probe = window as Window & { __enterAt?: number };
    const tile = document.querySelector('.board-tile[data-board="图书馆"]');
    tile?.addEventListener("mouseenter", () => {
      probe.__enterAt = performance.now();
    });
  });

  await page.locator('.board-tile[data-board="图书馆"]').hover();
  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === false,
    undefined,
    { timeout: 5_000 }
  );
  const elapsed = await page.evaluate(() => {
    const probe = window as Window & { __enterAt?: number };
    return performance.now() - (probe.__enterAt ?? 0);
  });
  expect(elapsed, `mouseenter→到位 ${elapsed.toFixed(0)}ms（900ms 过渡被 reducedMotion 跳过）`).toBeLessThan(200);
});

test("5 停在 lib 时，标记 05 中心与 projectPoint(anchor) 相差 < 3px", async ({ page }) => {
  await page.goto("/?3d=1");
  await waitReady(page);
  await page.locator('.board-tile[data-board="图书馆"]').hover();
  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );

  // anchor 从 meta json 文件读（node 侧，不写死坐标）
  const { readFileSync } = await import("node:fs");
  const metaRaw = JSON.parse(
    readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
  );
  const anchor5 = metaRaw.hotspots[4].anchor as [number, number, number];

  const proj = await page.evaluate(
    (pt) => {
      const r = window.__campus3d.projectPoint(pt);
      return { x: r.x, y: r.y };
    },
    anchor5
  );
  const mb = (await page.locator('[data-testid="campus-marker-05"]').boundingBox())!;
  const cx = mb.x + mb.width / 2;
  const cy = mb.y + mb.height / 2;
  expect(Math.hypot(cx - proj.x, cy - proj.y), "标记中心与投影点距离").toBeLessThan(3);
});

test("6 每 100ms 轮换 5 个板块，最终停在图书馆且无错误", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/?3d=1");
  await waitReady(page);

  const boards = ["学工", "教务", "后勤", "保卫", "图书馆"];
  for (const b of boards) {
    await page.locator(`.board-tile[data-board="${b}"]`).hover();
    await page.waitForTimeout(100);
  }

  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  expect(consoleErrors, `控制台错误：${consoleErrors.join(" | ")}`).toHaveLength(0);
});

test("7 悬停标记（marker 来源）不移动镜头", async ({ page }) => {
  await page.goto("/?3d=1");
  await waitReady(page);
  await page.waitForFunction(
    () => window.__campus3d.stop === "overview" && window.__campus3d.moving === false,
    undefined,
    { timeout: 5_000 }
  );

  await page.locator('[data-testid="campus-marker-02"]').hover();
  await page.waitForTimeout(1000);

  const h = await page.evaluate(() => ({
    activeBoard: window.__campus3d.activeBoard,
    stop: window.__campus3d.stop,
    moving: window.__campus3d.moving,
  }));
  expect(h.activeBoard).toBe("教务");
  expect(h.stop).toBe("overview");
  expect(h.moving).toBe(false);
});
