import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// W7：智多星。星是页面 div，跟随场景点；thinking 闪、flying 拖尾弧线。
// 无头浏览器软件渲染：帧慢但 data-state 在 flight 开始时同步翻转，可稳定观察。

const metaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as {
  look: {
    star: { home: [number, number, number]; lift: number };
  };
  buildings: Record<string, { anchor?: [number, number, number] }>;
};

/** 学生证 → 大学生活动中心南楼（ZQ-B023），与 fixtures 相同，只是延迟 1.5 秒 */
async function mockSlowChat(page: Page) {
  await page.route("**/api/v1/chat", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = (req.postDataJSON() ?? {}) as { request_id?: string; session_id?: string };
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        session_id: body.session_id ?? "sess-stage-test",
        request_id: body.request_id ?? "req-stage-test",
        trace_id: "trace-star-test",
        knowledge_version: "kb-test-000",
        unknown_fields: [],
        status: "answer",
        answer: {
          blocks: [
            {
              kind: "office",
              text: "补办学生证：本人携带身份证和一张近照，到大学生活动中心南楼301-302室学生处窗口办理，当场领取。",
              citation_ids: ["xsz-1"],
            },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "xsz-1",
            title: "学生证、乘车优惠卡办理说明",
            issuer: "石河子大学学生处",
            url: "https://www.shzu.edu.cn/students/card",
            published_at: "2025-03-01",
            locator: "第 2 条",
            excerpt: "学生证遗失补办在大学生活动中心南楼 301-302 室学生处窗口受理。",
            time_condition: null,
          },
        ],
        timing_ms: 1200,
      }),
    });
  });
}

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function waitMovingFalse(page: Page, timeout = 20_000) {
  await page.waitForFunction(
    () => window.__campus3d?.moving === false && window.__campus3d?.stop !== "home",
    undefined,
    { timeout }
  );
}

function starCenterExpr() {
  return () => {
    const el = document.querySelector('[data-testid="stage-star"]') as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (el.style.display === "none") return null;
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  };
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 ready 后：星可见 idle，中心与 star.home 投影差 ≤3px，旁边有「智多星」", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const star = page.locator('[data-testid="stage-star"]');
  await expect(star).toBeVisible();
  await expect(star).toHaveAttribute("data-state", "idle");
  await expect(star).toContainText("智多星");

  const home = await page.evaluate(
    (pt) => {
      const p = window.__campus3d.projectPoint(pt);
      return { x: p.x, y: p.y };
    },
    metaRaw.look.star.home
  );
  const c = await page.evaluate(starCenterExpr());
  expect(Math.hypot(c!.x - home.x, c!.y - home.y)).toBeLessThanOrEqual(3);
});

test("2 提问后回答返回前：data-state=thinking", async ({ page }) => {
  await mockSlowChat(page);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  await page.fill('[data-testid="stage-input"]', "学生证丢了去哪补办");
  await page.press('[data-testid="stage-input"]', "Enter");

  await page.waitForFunction(
    () => document.querySelector('[data-testid="stage-star"]')?.getAttribute("data-state") === "thinking",
    undefined,
    // polling 定时器：默认 rAF 在软件渲染下每帧可达 1s，thinking 窗口只有 ~1.25s 会被整段错过
    { timeout: 5_000, polling: 100 }
  );
  // 1.5 秒延迟内响应未到：面板仍停在「正在翻查」而不是落楼
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("正在翻查");
});

test("3 回答到达后到达前：观察到 flying 且拖尾在", async ({ page }) => {
  await mockSlowChat(page);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  await page.fill('[data-testid="stage-input"]', "学生证丢了去哪补办");
  await page.press('[data-testid="stage-input"]', "Enter");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("大学生活动中心南楼", { timeout: 20_000 });

  // 回答已到、镜头（与星）还在飞：data-state=flying && 拖尾存在
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="stage-star"]')?.getAttribute("data-state") === "flying"
      && !!document.querySelector('[data-testid="stage-star-trail"]'),
    undefined,
    { timeout: 15_000, polling: 100 } // 同上：flying 窗口 ~900ms，rAF 池化可能错过
  );
  // 飞完（moving false）之后由第 4 条断言 idle
});

test("4 落定后：idle、停在 anchor+lift、拖尾已撤；截图", async ({ page }) => {
  await mockSlowChat(page);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  await page.fill('[data-testid="stage-input"]', "学生证丢了去哪补办");
  await page.press('[data-testid="stage-input"]', "Enter");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("大学生活动中心南楼", { timeout: 20_000 });

  await waitMovingFalse(page);
  await page.waitForTimeout(400);

  const star = page.locator('[data-testid="stage-star"]');
  await expect(star).toHaveAttribute("data-state", "idle");

  const anchor = metaRaw.buildings["ZQ-B023"].anchor!;
  const pt = await page.evaluate(
    (p) => {
      const r = window.__campus3d.projectPoint(p);
      return { x: r.x, y: r.y };
    },
    [anchor[0], anchor[1] + metaRaw.look.star.lift, anchor[2]] as [number, number, number]
  );
  const c = await page.evaluate(starCenterExpr());
  expect(Math.hypot(c!.x - pt.x, c!.y - pt.y)).toBeLessThanOrEqual(3);

  await expect(page.locator('[data-testid="stage-star-trail"]')).toHaveCount(0);

  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W7-star.png" });
});

test("5 点回全校：星飞回 star.home 的投影", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  await page.evaluate(() => window.__campus3d.debugShowAnswer!("ZQ-B023"));
  await waitMovingFalse(page);

  await page.click('[data-testid="stage-rail-ALL"]');
  await page.waitForFunction(
    () => window.__campus3d.moving === false && window.__campus3d.stop === "home",
    undefined,
    { timeout: 20_000 }
  );
  await page.waitForTimeout(1000);

  const home = await page.evaluate(
    (pt) => {
      const p = window.__campus3d.projectPoint(pt);
      return { x: p.x, y: p.y };
    },
    metaRaw.look.star.home
  );
  const c = await page.evaluate(starCenterExpr());
  expect(Math.hypot(c!.x - home.x, c!.y - home.y)).toBeLessThanOrEqual(3);
});

test("6 静态模式（?3d=0）：没有星", async ({ page }) => {
  await page.goto("/stage?3d=0");
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="stage-star"]')).toHaveCount(0);
});

test("7 减少动态：全程无 flying、无拖尾，落点仍准", async ({ page }) => {
  await mockSlowChat(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  // 观察器：记录 data-state 出现过的值（错过瞬态也能查账）
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage-star"]') as HTMLElement | null;
    const seen = new Set<string>();
    if (el) seen.add(el.getAttribute("data-state") ?? "");
    (window as unknown as { __starStates?: Set<string> }).__starStates = seen;
    if (el) {
      new MutationObserver(() => seen.add(el.getAttribute("data-state") ?? "")).observe(el, {
        attributes: true,
        attributeFilter: ["data-state"],
      });
    }
  });

  await page.fill('[data-testid="stage-input"]', "学生证丢了去哪补办");
  await page.press('[data-testid="stage-input"]', "Enter");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("大学生活动中心南楼", { timeout: 20_000 });

  await waitMovingFalse(page);
  await page.waitForTimeout(600);

  const seen = await page.evaluate(() => Array.from((window as unknown as { __starStates?: Set<string> }).__starStates ?? []));
  expect(seen, `出现过的状态：${seen.join(",")}`).not.toContain("flying");
  await expect(page.locator('[data-testid="stage-star-trail"]')).toHaveCount(0);

  const anchor = metaRaw.buildings["ZQ-B023"].anchor!;
  const pt = await page.evaluate(
    (p) => {
      const r = window.__campus3d.projectPoint(p);
      return { x: r.x, y: r.y };
    },
    [anchor[0], anchor[1] + metaRaw.look.star.lift, anchor[2]] as [number, number, number]
  );
  const c = await page.evaluate(starCenterExpr());
  expect(Math.hypot(c!.x - pt.x, c!.y - pt.y)).toBeLessThanOrEqual(3);
});
