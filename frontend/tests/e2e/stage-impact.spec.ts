// ALIVE A9 验证：盖章、弧线飞行、开场点灯、空闲转动。
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

const allMeta = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as { stops: Record<string, { position: [number, number, number] }> };

// 说明：无头软渲染下一帧要 800ms 以上，180–240ms 的 CSS 动画无法用墙上时间观察。
// 盖章与点灯的时序改用 Web Animations API 把动画定点到指定毫秒再读计算样式，
// 断言的仍是卡片规定的同一组关键帧、延迟与节奏。

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function waitStill(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 20_000 });
}

async function ask(page: Page, text: string) {
  await page.fill('[data-testid="stage-input"]', text);
  await page.press('[data-testid="stage-input"]', "Enter");
}

/** 两条出处的假回答（学生处 ×1、教务处 ×1） */
async function mockTwoDocs(page: Page) {
  await page.route("**/api/v1/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = (route.request().postDataJSON() ?? {}) as { request_id?: string; session_id?: string };
    await new Promise((r) => setTimeout(r, 1200));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "answer",
        session_id: body.session_id ?? "sess-a9",
        request_id: body.request_id ?? "req-a9",
        trace_id: "trace-a9",
        knowledge_version: "kb-test-000",
        answer: {
          blocks: [
            {
              kind: "office",
              text: "到大学生活动中心南楼 301–302 室的学生事务管理办公室办理补办。",
              citation_ids: ["c1", "c2"],
            },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "c1",
            title: "学生证补办说明",
            issuer: "石河子大学党委学生工作部（学生处）",
            url: "https://www.shzu.edu.cn/xsz",
            published_at: "2025-09-01",
            locator: "第 2 条",
            excerpt: null,
            time_condition: null,
          },
          {
            id: "c2",
            title: "学籍与证明办理",
            issuer: "教务处",
            url: "https://www.shzu.edu.cn/jwc",
            published_at: "2025-09-01",
            locator: null,
            excerpt: null,
            time_condition: null,
          },
        ],
        actions: [],
        unknown_fields: [],
        timing_ms: 1100,
      }),
    });
  });
}

/** 把两张公文卡上的章动画暂停并定点到 t 毫秒，读 opacity / 旋转 / 缩放 */
async function seekStamps(page: Page, t: number) {
  return page.evaluate((ms) => {
    const els = Array.from(document.querySelectorAll(".stage-doc-stamp"));
    for (const el of els) {
      const a = (el as HTMLElement).getAnimations()[0];
      if (a) {
        a.pause();
        a.currentTime = ms;
      }
    }
    return els.map((el) => {
      const cs = getComputedStyle(el as HTMLElement);
      const m = cs.transform;
      let deg = 0;
      let scale = 1;
      if (m && m !== "none") {
        const nums = m.match(/matrix\(([^)]+)\)/);
        if (nums) {
          const [a1, b1] = nums[1].split(",").map(Number);
          deg = (Math.atan2(b1, a1) * 180) / Math.PI;
          scale = Math.hypot(a1, b1);
        }
      }
      return { opacity: Number(cs.opacity), deg, scale };
    });
  }, t);
}

/** 两张章动画的 delay / duration / fill */
async function stampTiming(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".stage-doc-stamp")).map((el) => {
      const a = (el as HTMLElement).getAnimations()[0];
      const t = a?.effect?.getTiming();
      return {
        delay: Number(t?.delay ?? -1),
        duration: Number(t?.duration ?? -1),
        fill: String(t?.fill ?? ""),
      };
    })
  );
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("2 弧线：远距离飞行中途抬高（高于两端直线中点 d×0.08 以上），近距离不拱起", async ({ page }) => {
  // 软渲染一帧要 800ms 以上，900ms 的飞行采不到中间帧；这一条用调试入口把同一条
  // 插值放慢到 8 秒（只改时长，不改插值公式），便于逐帧采样。
  // 备注：现有停靠点从 home 出发时终点的 Y 都比 home 低 500–900，拱起（0.12d）会被
  // 线性下降吃掉，因此按「飞行路径高于两端直线中点」验证抬升；这仍是卡片想表达的
  // 「中途抬高再俯冲」。
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const dq = allMeta.stops.dq.position;
  const dqTarget = (allMeta.stops.dq as unknown as { target: [number, number, number] }).target;
  const home = allMeta.stops.home.position;
  const d = Math.hypot(dq[0] - home[0], dq[1] - home[1], dq[2] - home[2]);
  expect(d).toBeGreaterThan(600);

  const fromY = await page.evaluate(() => window.__campus3d?.camera?.position?.[1] ?? null);
  expect(fromY).not.toBeNull();

  const startSampling = () =>
    page.evaluate(() => {
      const hook = window.__campus3d as unknown as Record<string, unknown>;
      const pts: [number, number][] = [];
      hook.__flyPts = pts;
      const loop = () => {
        const pos = hook.cameraPosition as number[] | undefined;
        if (pos) pts.push([performance.now(), pos[1]]);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });

  await startSampling();
  const t0 = await page.evaluate(() => {
    const hook = window.__campus3d as unknown as { debugGoTo?: (s: unknown, o?: unknown) => void };
    hook.debugGoTo?.("dq", { durationMs: 8000 });
    return performance.now();
  });
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 40_000 });

  const pts = await page.evaluate(() => (window.__campus3d as unknown as { __flyPts?: [number, number][] }).__flyPts ?? []);
  const toY = await page.evaluate(() => window.__campus3d?.camera?.position?.[1] ?? 0);
  const mid = ((fromY as number) + toY) / 2;
  // 只取飞行中段（调用后 3.2–4.8 秒，缓动后约 e≈0.5）：有拱起时这里比直线中点高 0.12d
  const band = pts.filter(([t]) => t >= t0 + 3200 && t <= t0 + 4800).map(([, y]) => y);
  console.log("fly samples", pts.length, "band", band.length, "band-max", band.length ? Math.max(...band).toFixed(1) : "n/a", "mid", mid.toFixed(1), "d", d.toFixed(0));
  expect(pts.length).toBeGreaterThan(10);
  expect(band.length).toBeGreaterThan(0);
  expect(Math.max(...band)).toBeGreaterThan(mid + d * 0.08);

  // 近距离（d < 200）：不加拱起，Y 不超过两端较大的那个 + 1
  const nearFromY = toY;
  await startSampling();
  await page.evaluate((t) => {
    const hook = window.__campus3d as unknown as { debugGoTo?: (s: unknown, o?: unknown) => void };
    hook.debugGoTo?.({ position: [t[0] + 150, t[1], t[2]], target: [t[0], t[1] - 200, t[2]] }, { durationMs: 4000 });
  }, [dq[0], dq[1], dq[2]]);
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 30_000 });
  const pts2 = await page.evaluate(() => (window.__campus3d as unknown as { __flyPts?: [number, number][] }).__flyPts ?? []);
  const ys2 = pts2.map(([, y]) => y);
  const nearToY = await page.evaluate(() => window.__campus3d?.camera?.position?.[1] ?? 0);
  console.log("near samples", ys2.length, "max", Math.max(...ys2).toFixed(1), "from", nearFromY, "to", nearToY);
  expect(ys2.length).toBeGreaterThan(1);
  expect(Math.max(...ys2)).toBeLessThanOrEqual(Math.max(nearFromY, nearToY) + 1);
  void dqTarget;
});

/** 把灯牌的点灯动画定点到 t 毫秒；返回可见灯牌的 delay 与 opacity */
async function seekLanterns(page: Page, t: number) {
  return page.evaluate((ms) => {
    const els = Array.from(
      document.querySelectorAll('[data-testid^="stage-lantern-"]')
    ) as HTMLElement[];
    const out: { id: string; delay: number; opacity: number }[] = [];
    for (const el of els) {
      if (el.style.display === "none") continue;
      const a = el.getAnimations()[0];
      if (!a) continue;
      a.pause();
      a.currentTime = ms;
      const timing = a.effect?.getTiming();
      out.push({
        id: el.dataset.testid ?? "",
        delay: Number(timing?.delay ?? 0),
        opacity: Number(getComputedStyle(el).opacity),
      });
    }
    return out;
  }, t);
}

test("3 点灯：中区沙盘由近到远亮起（近的先亮），2 秒后全亮", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0&light=1");
  await waitReady(page);
  await page.waitForTimeout(400);
  // 首页的五块校区题签也在点灯（SceneSigns）
  const signsLit = await page.evaluate(
    () => document.querySelectorAll(".stage-sign.is-lighting").length
  );
  expect(signsLit).toBeGreaterThanOrEqual(4);

  // 换到中区自己的沙盘
  await page.click('[data-testid="stage-rail-ZQ"]');
  await page.click('[data-testid="stage-rail-enter"]');
  await page.waitForFunction(
    () => window.__campus3d?.pack === "zq" && window.__campus3d?.status === "ready",
    undefined,
    { timeout: 60_000 }
  );
  await page.waitForTimeout(400); // 测试入口：就绪后 300ms 点灯

  const early = await seekLanterns(page, 100);
  console.log("lanterns", early.length, JSON.stringify(early.slice(0, 6)));
  expect(early.length).toBeGreaterThan(1);
  expect(early.some((x) => x.opacity < 1)).toBe(true);
  const nearest = early.reduce((a, b) => (b.delay < a.delay ? b : a));
  const farthest = early.reduce((a, b) => (b.delay > a.delay ? b : a));
  expect(nearest.delay).toBe(0);
  expect(nearest.opacity).toBeGreaterThan(farthest.opacity);

  const later = await seekLanterns(page, 2000);
  expect(later.length).toBeGreaterThan(1);
  for (const x of later) expect(Math.abs(x.opacity - 1)).toBeLessThanOrEqual(0.01);
});

test("1 盖章：两枚章 260/380ms 依次盖下，起点 1.8 倍 −4° 透明、终点 0.86 与 −12°", async ({ page }) => {
  await mockTwoDocs(page);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await expect(page.locator('[data-testid="stage-doc-1"]')).toBeVisible();
  await expect(page.locator(".stage-doc-stamp")).toHaveCount(2);

  const timing = await stampTiming(page);
  expect(timing).toHaveLength(2);
  expect(timing[0].delay).toBeCloseTo(260, 0);
  expect(timing[1].delay).toBeCloseTo(380, 0);
  for (const t of timing) {
    expect(t.duration).toBeCloseTo(180, 0);
    expect(t.fill).toBe("both");
  }

  // 面板滑入后 100ms（260ms 延迟未到）：第一枚还是起始的大号淡影
  const early = await seekStamps(page, 100);
  expect(early).toHaveLength(2);
  expect(early[0].opacity).toBeLessThan(0.5);
  expect(early[0].scale).toBeGreaterThan(1.5);
  expect(Math.abs(early[0].deg + 4)).toBeLessThanOrEqual(0.5);

  // 1.2 秒：两枚都已盖好
  const later = await seekStamps(page, 1200);
  expect(later).toHaveLength(2);
  for (const s of later) {
    expect(Math.abs(s.opacity - 0.86)).toBeLessThanOrEqual(0.01);
    expect(Math.abs(s.deg + 12)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(s.scale - 1)).toBeLessThanOrEqual(0.01);
  }

  // 截图用最终态
  await page.evaluate(() => {
    for (const el of document.querySelectorAll(".stage-doc-stamp")) {
      el.getAnimations()[0]?.finish();
    }
  });
  await page.screenshot({ path: "../docs/3d/shots/A9-stamp.png" });
});

test("4 空闲：2 秒无输入进入观景（无退出钮、界面不隐去），一动鼠标就回首页", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0&idle=2");
  await waitReady(page);
  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__campus3d?.tour)).toBe(true);
  await expect(page.locator('[data-testid="stage-tour-exit"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-dock"]')).toBeVisible();
  const dockOpacity = await page.evaluate(() =>
    Number(getComputedStyle(document.querySelector('[data-testid="stage-dock"]') as HTMLElement).opacity)
  );
  expect(dockOpacity).toBe(1);

  await page.mouse.move(400, 400);
  await page.waitForFunction(() => window.__campus3d?.tour === false, undefined, { timeout: 5000 });
  await page.waitForFunction(
    () => window.__campus3d?.moving === false && window.__campus3d?.stop === "home",
    undefined,
    { timeout: 40_000 }
  );
  expect(await page.evaluate(() => window.__campus3d?.stop)).toBe("home");
});

test("5 减少动态：章直接是最终样子；不做空闲转动", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockTwoDocs(page);
  await page.goto("/stage?3d=1&intro=0&idle=2");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await expect(page.locator('[data-testid="stage-doc-1"]')).toBeVisible();

  const stamps = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".stage-doc-stamp")).map((el) => ({
      opacity: Number(getComputedStyle(el as HTMLElement).opacity),
      anims: (el as HTMLElement).getAnimations().length,
    }))
  );
  expect(stamps.length).toBeGreaterThan(0);
  for (const s of stamps) {
    expect(s.anims).toBe(0);
    expect(Math.abs(s.opacity - 0.86)).toBeLessThanOrEqual(0.01);
  }

  await page.waitForTimeout(3000);
  expect(await page.evaluate(() => window.__campus3d?.tour)).toBe(false);
});

test("6 空闲：输入框聚焦时不转、失焦后转；转动中点输入框恢复输入", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0&idle=2");
  await waitReady(page);
  await page.locator('[data-testid="stage-input"]').click();
  await page.waitForTimeout(3200);
  expect(await page.evaluate(() => window.__campus3d?.tour)).toBe(false);
  expect(await page.evaluate(() => window.__campus3d?.mode)).toBe("home");

  // 点到沙盘（失焦）→ 2 秒后自动转起来，问话栏仍可见可点
  await page.mouse.click(700, 400);
  await page.waitForFunction(() => window.__campus3d?.tour === true, undefined, { timeout: 10_000 });
  await expect(page.locator('[data-testid="stage-dock"]')).toHaveCSS("opacity", "1");
  await expect(page.locator('[data-testid="stage-dock"]')).not.toHaveAttribute("inert", "");

  // 转动中点输入框：回到原输入状态，本次点击照常生效
  await page.locator('[data-testid="stage-input"]').click();
  await expect.poll(() => page.evaluate(() => window.__campus3d?.tour), { timeout: 5_000 }).toBe(false);
  await expect(page.locator('[data-testid="stage-input"]')).toBeFocused();
  await page.keyboard.type("借教室");
  await expect(page.locator('[data-testid="stage-input"]')).toHaveValue("借教室");
});
