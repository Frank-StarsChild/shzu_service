import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// N5：高亮时红色从楼底涌起。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
) as { hotspots: { board: string; buildingId: string }[] };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 25_000 });
}

/** 程序化 mouseenter（像素统计用；真实指针交互由 interact.spec 覆盖）。 */
async function hoverBoard(page: Page, board: string) {
  await page.evaluate((b) => {
    const el = document.querySelector(`.board-tile[data-board="${b}"]`);
    el?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, cancelable: true }));
  }, board);
  await page.waitForFunction((b) => window.__campus3d.activeBoard === b, board, { timeout: 5_000 });
}

async function clearHover(page: Page) {
  await page.evaluate(() =>
    document.querySelectorAll(".board-tile").forEach((el) =>
      el.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, cancelable: true }))
    )
  );
}

async function centerSandbox(page: Page) {
  await page.locator('[data-testid="campus-hero"]').evaluate((el) => el.scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
}

async function redRatio(page: Page): Promise<number> {
  const png = PNG.sync.read(await page.locator('[data-testid="campus-canvas"]').screenshot());
  const total = png.width * png.height;
  let red = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    if (png.data[i] > 170 && png.data[i + 1] < 70 && png.data[i + 2] < 70) red += 1;
  }
  return red / total;
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 悬停图书馆：hotRise 经历中间值，1.5 秒后到 1", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  // 加固（经作者确认，同 intro.spec 先例）：软件渲染一帧可长达约 1 秒，而涌起动画只有
  // 260ms——中间值可能整段被一次阻塞渲染盖住，事后轮询（无论按 rAF 还是定时间隔）
  // 都读不到。改为给钩子的 hotRise 装一个写入记录器，在写入现场捕获每一次值：
  // 「经历中间值」= 样本里存在 0<h<1（涌起起点 0.02 必写入）；终值仍按 1.5 秒后为 1。
  // 若功能回归（不涌起恒 0 / 直达 1），样本不含中间值，照样变红。
  await page.evaluate(() => {
    const hook = window.__campus3d;
    const seen: number[] = [];
    let cur = hook.hotRise ?? 0;
    Object.defineProperty(hook, "hotRise", {
      configurable: true,
      get: () => cur,
      set: (v: number) => {
        seen.push(v);
        cur = v;
      },
    });
    (window as unknown as { __riseSamples?: number[] }).__riseSamples = seen;
  });
  await hoverBoard(page, "图书馆");
  // 终值：涌起本体只有 260ms，但软件渲染一帧可长达约 1 秒——完成写入发生在下一帧渲染，
  // 整场重负载下可能晚于固定的 1.5 秒。改为有界等待（到不了 1 仍会超时变红）。
  await page.waitForFunction(
    () => (window.__campus3d.hotRise ?? 0) >= 0.999,
    undefined,
    { timeout: 8_000, polling: 100 }
  );
  const { samples, final } = await page.evaluate(() => ({
    samples: (window as unknown as { __riseSamples?: number[] }).__riseSamples ?? [],
    final: window.__campus3d.hotRise ?? 0,
  }));
  expect(samples.some((v) => v > 0 && v < 1), `中间值样本：${JSON.stringify(samples)}`).toBe(true);
  expect(final).toBeGreaterThanOrEqual(0.999);
  expect(final).toBeLessThanOrEqual(1.001);
});

test("2 移开并回全景后 hotRise=0，hotVisible=null", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  await hoverBoard(page, "图书馆");
  await page.waitForFunction(() => window.__campus3d.hotVisible === "ZQ-B034", undefined, { timeout: 5_000 });
  await clearHover(page);
  await page.waitForFunction(
    () => window.__campus3d.stop === "overview" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  const h = await page.evaluate(() => ({
    hotRise: window.__campus3d.hotRise,
    hotVisible: window.__campus3d.hotVisible,
  }));
  expect(h.hotRise).toBe(0);
  expect(h.hotVisible).toBeNull();
});

test("3 快速轮换 5 个板块后停在学工：高亮正确、红色可见", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  const boards = metaRaw.hotspots.map((h) => h.board);
  for (const b of boards) {
    await hoverBoard(page, b);
    await page.waitForTimeout(80);
  }
  await hoverBoard(page, "学工");
  await page.waitForFunction(
    () => window.__campus3d.moving === false && window.__campus3d.hotRise >= 0.999,
    undefined,
    { timeout: 8_000 }
  );
  await page.waitForTimeout(1500);
  await centerSandbox(page);
  expect(await page.evaluate(() => window.__campus3d.hotVisible)).toBe(metaRaw.hotspots[0].buildingId);

  await page.addStyleTag({
    content: "[data-testid=campus-overlay], .campus-hud, .campus-fx { visibility: hidden !important; }",
  });
  const f0 = await page.evaluate(() => window.__campus3d.frames);
  await page.waitForFunction((f) => window.__campus3d.frames >= f + 2, f0, { timeout: 20_000 });
  const r = await redRatio(page);
  expect(r, `高亮红色 ${(r * 100).toFixed(2)}%`).toBeGreaterThan(0.003);
});

test("4 减少动态：悬停后 200ms 内 hotRise === 1", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  await hoverBoard(page, "教务");
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__campus3d.hotRise)).toBe(1);
});