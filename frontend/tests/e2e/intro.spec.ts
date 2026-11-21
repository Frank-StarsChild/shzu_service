import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// N4：开场动画与镜头入场。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/campus.meta.json", import.meta.url), "utf-8")
) as {
  stops: { overview: { position: [number, number, number] } };
  hotspots: { board: string; anchor: [number, number, number]; buildingId: string }[];
  buildings: Record<string, unknown>;
};

async function waitIntro(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "intro", undefined, { timeout: 25_000 });
}
async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 25_000 });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 intro 出现后 2–8 秒进入 ready；intro 状态字段正确", async ({ page }) => {
  const t0 = Date.now();
  await page.goto("/classic?3d=1");
  await waitIntro(page);
  expect(await page.evaluate(() => window.__campus3d.intro)).toBe("playing");
  await waitReady(page);
  const elapsed = Date.now() - t0;
  expect(await page.evaluate(() => window.__campus3d.intro)).toBe("done");
  // 从打开页面（含模型加载）到开场播完；开场本身 2.7 秒
  expect(elapsed).toBeGreaterThanOrEqual(2000);
  expect(elapsed).toBeLessThanOrEqual(12_000);
});

test("2 开场时 FX 光柱未升起；结束后关键节点缩放为 1", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitIntro(page);
  const early = await page.evaluate(() => window.__campus3d.nodeScaleY("FX_beacons"));
  expect(early).not.toBeNull();
  expect(early as number).toBeLessThan(0.5);

  await waitReady(page);
  const names = [
    "L_edges",
    "FX_beacons",
    "S_props",
    ...Object.keys(metaRaw.buildings)
      .filter((_, i) => i % 15 === 0)
      .slice(0, 3)
      .map((id) => `B_${id}`),
  ];
  for (const n of names) {
    const y = await page.evaluate((name) => window.__campus3d.nodeScaleY(name), n);
    expect(y, `${n}.scale.y`).not.toBeNull();
    expect(y as number, `${n}.scale.y`).toBeGreaterThanOrEqual(0.999);
    expect(y as number, `${n}.scale.y`).toBeLessThanOrEqual(1.001);
  }
});

test("3 ready 后镜头在 overview；五个标记与投影对位", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  const cam = await page.evaluate(() => ({
    stop: window.__campus3d.stop,
    position: window.__campus3d.camera.position,
  }));
  expect(cam.stop).toBe("overview");
  for (let i = 0; i < 3; i++) {
    expect(Math.abs(cam.position[i] - metaRaw.stops.overview.position[i])).toBeLessThan(0.5);
  }

  const fb = (await page.locator('[data-testid="campus-hero"]').boundingBox())!;
  for (let i = 0; i < 5; i++) {
    const p = await page.evaluate((pt) => window.__campus3d.projectPoint(pt), metaRaw.hotspots[i].anchor);
    const mb = (await page.locator(`[data-testid="campus-marker-0${i + 1}"]`).boundingBox())!;
    const cx = mb.x + mb.width / 2;
    const cy = mb.y + mb.height / 2;
    expect(Math.hypot(cx - p.x, cy - p.y), `标记 ${i + 1} 与投影距离`).toBeLessThan(3);
    expect(fb.width).toBeGreaterThan(0);
  }
});

test("4 播过后写 sessionStorage；返回首页不再播（played）", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitReady(page);
  expect(await page.evaluate(() => sessionStorage.getItem("shzu.campus3d.intro"))).toBe("1");

  await page.getByRole("link", { name: "服务目录" }).click();
  await page.waitForURL(/\/services/);
  await page.goBack();
  await page.waitForURL(/\/classic\?3d=1/);
  // 加固（经作者确认）：SPA 返回后旧钩子残留 status:'ready' 会让 waitReady 撞上
  // 「新挂载已重置 introReason、decideIntro 未写入」的窗口。改为直接等判定值；
  // 若应用永远到不了 played，此等待超时同样变红，判定强度不降。
  await page.waitForFunction(
    () => window.__campus3d?.introReason === "played",
    undefined,
    { timeout: 25_000 }
  );
  expect(await page.evaluate(() => window.__campus3d.introReason)).toBe("played");
});

test("5 ?intro=0 跳过开场", async ({ page }) => {
  await page.goto("/classic?3d=1&intro=0");
  await waitReady(page);
  const h = await page.evaluate(() => ({
    introReason: window.__campus3d.introReason,
    intro: window.__campus3d.intro,
  }));
  expect(h.introReason).toBe("query-off");
  expect(h.intro).toBe("skipped");
});

test("6 减少动态：不播开场，节点缩放直接为 1", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/classic?3d=1");
  await waitReady(page);
  expect(await page.evaluate(() => window.__campus3d.introReason)).toBe("reduced-motion");
  for (const n of ["L_edges", "FX_beacons", "S_props"]) {
    expect(await page.evaluate((name) => window.__campus3d.nodeScaleY(name), n)).toBeCloseTo(1, 3);
  }
});

test("7 开场中悬停图书馆：最终 ready、停在 lib、高亮正确", async ({ page }) => {
  await page.goto("/classic?3d=1");
  await waitIntro(page);
  await page.locator('.board-tile[data-board="图书馆"]').hover();
  await waitReady(page);
  await page.waitForFunction(
    () => window.__campus3d.stop === "lib" && window.__campus3d.moving === false,
    undefined,
    { timeout: 10_000 }
  );
  const h = await page.evaluate(() => window.__campus3d.hotVisible);
  expect(h).toBe(metaRaw.hotspots[4].buildingId);
});