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
