// ALIVE A5 验证：智多星在想（读题 → 翻查 → 核证 → 作答）。
// 假接口延迟 1.5 秒返回；出处三条：学生处 ×2（ZQ-B023）、教务处（ZQ-B024）。
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

const allMetaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as { buildings: Record<string, { anchor: [number, number, number] }> };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}
async function waitStill(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 20_000 });
}

type MockOpts = { delay?: number; status?: "answer" | "error" };

async function mockTraceChat(page: Page, opts: MockOpts = {}) {
  const delay = opts.delay ?? 1500;
  const status = opts.status ?? "answer";
  await page.route("**/api/v1/chat", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = (route.request().postDataJSON() ?? {}) as { request_id?: string; session_id?: string };
    await new Promise((r) => setTimeout(r, delay));
    if (status === "error") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "error",
          session_id: body.session_id ?? "sess-a5",
          request_id: body.request_id ?? "req-a5",
          trace_id: "trace-a5",
          knowledge_version: "kb-test-000",
          message: "这一轮没有答出来",
          unknown_fields: [],
          citations: [],
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "answer",
        session_id: body.session_id ?? "sess-a5",
        request_id: body.request_id ?? "req-a5",
        trace_id: "trace-a5",
        knowledge_version: "kb-test-000",
        answer: {
          blocks: [
            {
              kind: "office",
              text: "到大学生活动中心南楼 301–302 室的学生事务管理办公室办理补办。",
              citation_ids: ["c1", "c2", "c3"],
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
            title: "学生事务服务指南",
            issuer: "石河子大学党委学生工作部（学生处）",
            url: "https://www.shzu.edu.cn/xsz2",
            published_at: "2025-09-01",
            locator: null,
            excerpt: null,
            time_condition: null,
          },
          {
            id: "c3",
            title: "学籍与证明办理",
            issuer: "教务处",
            url: "https://www.shzu.edu.cn/jwc",
            published_at: "2025-09-01",
            locator: null,
            excerpt: null,
            time_condition: null,
          },
        ],
        // 按需定位：自动落楼只看结构化地点；正文楼名与出处只用于展示与题签
        actions: [
          {
            kind: "errand",
            title: "学生证补办 · 办事单",
            place: {
              building: "大学生活动中心（南楼）",
              room: "301–302室",
              building_id: "ZQ-B023",
              campus: "中区",
              evidence_id: "c1",
            },
            dept: "学生事务管理办公室（学生处）",
            service_scope: "学生证、乘车优惠卡办理",
            phone: "0993-2058029",
            hours: null,
            materials_confirmed: false,
            confirms: [],
          },
        ],
        unknown_fields: [],
        timing_ms: 1200,
      }),
    });
  });
}

async function ask(page: Page, text: string) {
  await page.fill('[data-testid="stage-input"]', text);
  await page.press('[data-testid="stage-input"]', "Enter");
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("5—9 提问后：读题→翻查→核证（金线）→作答（变红）→收起；W5 结果保留", async ({ page }) => {
  await mockTraceChat(page);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  await ask(page, "学生证丢了，去哪补办？");
  // 5. 100ms 内：read + 圈字
  await page.waitForTimeout(100);
  const phase = page.locator('[data-testid="stage-phase"]');
  await expect(phase).toHaveAttribute("data-phase", "read");
  await expect(page.locator(".stage-trace-ring")).toBeVisible();

  // 6. 600ms 时：search + 翻查题签含问题前 10 字
  await page.waitForTimeout(500);
  await expect(phase).toHaveAttribute("data-phase", "search");
  await expect(page.locator('[data-testid="stage-trace-query"]')).toContainText("学生证丢了");

  // 7. 回答回来：面板立刻有；verify；mode 还不是 answer；两根金线
  let snap: { phase?: string; mode?: string } | null = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 10_000) {
    snap = await page.evaluate(() => ({
      phase: (window.__campus3d as unknown as { phase?: string })?.phase,
      mode: window.__campus3d?.mode,
    }));
    if (snap.phase === "verify") break;
    await page.waitForTimeout(30);
  }
  expect(snap?.phase).toBe("verify");
  expect(snap?.mode).not.toBe("answer");
  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  await expect(phase).toHaveAttribute("data-phase", "verify");
  await page.waitForFunction(() => (window.__campus3d?.threads ?? 0) === 2, undefined, { timeout: 5_000 });
  // 同一瞬间量：金线 d 的终点 vs 当前相机下 anchor+4 的投影
  const anchors = {
    "ZQ-B023": allMetaRaw.buildings["ZQ-B023"].anchor,
    "ZQ-B024": allMetaRaw.buildings["ZQ-B024"].anchor,
  };
  const deltas = await page.evaluate((pts) => {
    const out: Record<string, { dx: number; dy: number }> = {};
    for (const [id, a] of Object.entries(pts)) {
      const path = document.querySelector(`[data-testid="stage-trace-thread-${id}"]`);
      const d = path?.getAttribute("d") ?? "";
      const nums = d.trim().split(/\s+/);
      const ex = Number(nums[nums.length - 2]);
      const ey = Number(nums[nums.length - 1]);
      const p = window.__campus3d.projectPoint([a[0], a[1] + 4, a[2]]);
      out[id] = { dx: ex - p.x, dy: ey - p.y };
    }
    return out;
  }, anchors);
  for (const id of ["ZQ-B023", "ZQ-B024"] as const) {
    expect(Math.abs(deltas[id].dx), `${id} 金线终点 x`).toBeLessThanOrEqual(3);
    expect(Math.abs(deltas[id].dy), `${id} 金线终点 y`).toBeLessThanOrEqual(3);
  }
  mkdirSync("../docs/3d/shots", { recursive: true });

  // 8. 1 秒内作答：ZQ-B023 那根线变朱红（轮询到变红为止，避免落在 setTrace 与落楼之间）
  let answerStroke = "";
  const tAnswer = Date.now();
  while (Date.now() - tAnswer < 6_000) {
    const s = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="stage-trace-thread-ZQ-B023"]');
      const ph = document.querySelector('[data-testid="stage-phase"]')?.getAttribute("data-phase") ?? null;
      return { ph, stroke: el ? getComputedStyle(el).stroke : "" };
    });
    if (s.ph === "answer" && s.stroke) answerStroke = s.stroke;
    if (s.ph === "answer" && s.stroke === "rgb(226, 0, 26)") break;
    if (s.ph === null) break;
    await page.waitForTimeout(50);
  }
  expect(answerStroke).toBe("rgb(226, 0, 26)");

  // 9. 镜头停下 1.5 秒后：trace 收起、W5 结果还在
  await waitStill(page);
  await page.waitForTimeout(1500);
  await expect(page.locator('[data-testid="stage-trace"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-phase"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__campus3d?.shell)).toBe("ZQ-B023");
  await expect(page.locator('[data-testid="stage-leader"]')).toBeVisible();
});

test("7b 核证态：两根金线长出来后截图 A5-verify.png", async ({ page }) => {
  await mockTraceChat(page);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了，去哪补办？");
  await page.waitForFunction(() => (window.__campus3d?.threads ?? 0) === 2, undefined, { timeout: 10_000 });
  await page.waitForTimeout(350);
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/A5-verify.png" });
});

test("10 接口 error：这一轮没有答出来；没有金线；镜头没动", async ({ page }) => {
  await mockTraceChat(page, { status: "error", delay: 600 });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  const stop0 = await page.evaluate(() => window.__campus3d?.stop);
  await ask(page, "学生证丢了，去哪补办？");
  await expect(page.locator('[data-testid="stage-phase"]')).toHaveAttribute("data-phase", "error", { timeout: 10_000 });
  await expect(page.locator('[data-testid="stage-phase"]')).toContainText("这一轮没有答出来");
  await expect(page.locator(".stage-trace-thread")).toHaveCount(0);
  expect(await page.evaluate(() => window.__campus3d?.stop)).toBe(stop0);
  expect(await page.evaluate(() => window.__campus3d?.mode)).toBe("home");
});

test("11 减少动态：没有圈字；回答回来 200ms 内落楼", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockTraceChat(page, { delay: 600 });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了，去哪补办？");
  await page.waitForTimeout(200);
  await expect(page.locator(".stage-trace-ring")).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => window.__campus3d?.mode), { timeout: 5_000 })
    .toBe("answer");
  expect(await page.evaluate(() => window.__campus3d?.shell)).toBe("ZQ-B023");
});
