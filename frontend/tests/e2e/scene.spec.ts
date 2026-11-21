import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { PNG } from "pngjs";
import { mockApi } from "./fixtures/api";

// PLAN S5：三维场景——加载到第一帧。全部用 /?3d=1 打开（无头浏览器是软件渲染）。

type Hotspot = {
  anchor: [number, number, number];
  pick: [number, number, number];
  posterDesktop: [number, number];
};

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
) as { background: string; buildings: Record<string, unknown>; hotspots: Hotspot[] };

const BUILDING_COUNT = Object.keys(metaRaw.buildings).length;

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, {
    timeout: 20_000,
  });
}

async function readHook(page: Page) {
  await page.waitForFunction(() => typeof window.__campus3d?.status === "string");
  return page.evaluate(() => window.__campus3d);
}

/** PLAN S5 验证 3：5 个热点的 anchor 投影与 posterDesktop 对位（< 0.02）。 */
async function checkPosterAlignment(page: Page, label: string) {
  for (let i = 0; i < metaRaw.hotspots.length; i++) {
    const h = metaRaw.hotspots[i];
    const p = await page.evaluate(
      (pt) => {
        const r = window.__campus3d.projectPoint(pt);
        return { x: r.x, y: r.y, visible: r.visible };
      },
      h.anchor
    );
    const fb = (await page.locator('[data-testid="campus-hero"]').boundingBox())!;
    const nx = (p.x - fb.x) / fb.width;
    const ny = (p.y - fb.y) / fb.height;
    expect(
      Math.abs(nx - h.posterDesktop[0]),
      `${label}：热点 ${i + 1} 的 x（${nx.toFixed(4)} vs ${h.posterDesktop[0]}）`
    ).toBeLessThan(0.02);
    expect(
      Math.abs(ny - h.posterDesktop[1]),
      `${label}：热点 ${i + 1} 的 y（${ny.toFixed(4)} vs ${h.posterDesktop[1]}）`
    ).toBeLessThan(0.02);
  }
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 20 秒内 ready；buildingCount 等于 buildings 条数；hotspotCount = 5", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  const h = await readHook(page);
  expect(h.buildingCount).toBe(BUILDING_COUNT);
  expect(h.hotspotCount).toBe(5);
});

test("2 画布不是空白（像素统计）", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  // 隐藏标记层：统计的只有场景本身
  await page.addStyleTag({ content: "[data-testid=campus-overlay] { visibility: hidden !important; }" });
  const buf = await page.locator('[data-testid="campus-canvas"]').screenshot();
  const png = PNG.sync.read(buf);

  const bg = metaRaw.background; // "#ffffff"
  const [br, bg_, bb] = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));

  let diff = 0;
  let sum = 0;
  let sumSq = 0;
  const total = png.width * png.height;
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    if (Math.abs(r - br) + Math.abs(g - bg_) + Math.abs(b - bb) > 24) diff += 1;
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += lum;
    sumSq += lum * lum;
  }
  const ratio = diff / total;
  const mean = sum / total;
  const std = Math.sqrt(sumSq / total - mean * mean);
  expect(ratio, `与背景不同的像素占比 ${((ratio * 100).toFixed(1))}% 应 > 15%`).toBeGreaterThan(0.15);
  expect(std, `亮度标准差 ${std.toFixed(2)} 应 > 5`).toBeGreaterThan(5);
});

test("3 海报对位：anchor 投影与 posterDesktop 相差 < 0.02", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await checkPosterAlignment(page, "对位");
});

test("4 ready 后画布 opacity 为 1；海报仍在 DOM", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await page.waitForTimeout(600); // 等 400ms 过渡结束
  const opacity = await page
    .locator('[data-testid="campus-canvas"]')
    .evaluate((el) => getComputedStyle(el).opacity);
  expect(opacity).toBe("1");
  await expect(page.locator('[data-testid="campus-poster"]')).toHaveCount(1);
});

test("5 失败回退：拦截 .glb → error + 海报 + 重试；解除后重试成功", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route("**/campus.glb*", (route) => route.abort());
  await page.goto("/classic?3d=1");

  await page.waitForFunction(() => window.__campus3d?.status === "error", undefined, {
    timeout: 20_000,
  });
  await expect(page.locator('[data-testid="campus-poster"]')).toBeVisible();
  await expect(page.locator('[data-testid="campus-retry"]')).toBeVisible();
  expect(errors).toHaveLength(0);

  await page.unroute("**/campus.glb*");
  await page.locator('[data-testid="campus-retry"]').click();
  await waitReady(page);
});

test("6 懒加载：/?3d=0 下所有 .js 正文不含 WebGLRenderer，且无 .glb 请求", async ({ page }) => {
  const jsBodies = new Map<string, string>();
  page.on("response", async (resp) => {
    if (resp.url().endsWith(".js")) {
      try {
        jsBodies.set(resp.url(), await resp.text());
      } catch {
        /* 忽略读取失败的响应 */
      }
    }
  });
  const glbReqs: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(".glb")) glbReqs.push(r.url());
  });

  await page.goto("/?3d=0");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  expect(glbReqs).toHaveLength(0);
  for (const [url, body] of jsBodies) {
    expect(
      body.includes("WebGLRenderer"),
      `${url} 不应包含 WebGLRenderer（three 应只在 3D 模式加载）`
    ).toBe(false);
  }
});

test("7 反复进出 6 次：无控制台 error、无 WebGL 上下文耗尽", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  for (let i = 0; i < 6; i++) {
    if (i === 0) {
      await page.goto("/classic?3d=1");
    } else {
      await page.goBack();
      await page.waitForURL(/\/classic\?3d=1/);
    }
    await waitReady(page);
    await page.getByRole("link", { name: "服务目录" }).click();
    await page.waitForURL(/\/services/);
  }

  expect(pageErrors, `页面错误：${pageErrors.join(" | ")}`).toHaveLength(0);
  const ctxMsgs = consoleErrors.filter((t) => t.includes("Too many active WebGL contexts"));
  expect(ctxMsgs, "WebGL 上下文耗尽会破坏 dispose 链").toHaveLength(0);
  expect(consoleErrors, `控制台错误：${consoleErrors.join(" | ")}`).toHaveLength(0);
});

test("8 视口 1100 宽仍对位", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.waitForTimeout(300);
  await checkPosterAlignment(page, "1100 宽");
});

test("截图存档（docs/3d/shots）", async ({ page }) => {
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.goto("/classic?3d=1");
  await waitReady(page);
  await page.waitForTimeout(600);
  await page.locator('[data-testid="campus-hero"]').screenshot({
    path: "../docs/3d/shots/S5-desktop.png",
  });
});
