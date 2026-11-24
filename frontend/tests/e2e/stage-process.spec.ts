import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// 办理路线（process）：首页右侧面板与 /chat 消息内的同一条路线渲染、
// 节点展开、出处点开、390px 窄屏，以及刷新后按历史回放。

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function ask(page: Page, text: string) {
  await page.fill('[data-testid="stage-input"]', text);
  await page.press('[data-testid="stage-input"]', "Enter");
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 首页：转专业问励志奖学金 → 右侧出现三节点办理路线，默认展开待补充的那一步", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "我刚转专业，还能申请国家励志奖学金吗？");

  const proc = page.locator('[data-testid="stage-process"]');
  await expect(proc).toBeVisible();
  await expect(proc).toContainText("办理路线");
  await expect(page.locator('[data-testid="proc-node-year"]')).toContainText("核实申报年度");
  await expect(page.locator('[data-testid="proc-node-eligibility"]')).toContainText("核对申请资格");
  await expect(page.locator('[data-testid="proc-node-materials"]')).toContainText("查看材料");

  // focus_id = year（第一个待补充）默认展开；其余默认收起
  await expect(page.locator('[data-testid="proc-detail-year"]')).toBeVisible();
  await expect(page.locator('[data-testid="proc-detail-year"]')).toContainText("请补充申报年度");
  await expect(page.locator('[data-testid="proc-detail-eligibility"]')).toHaveCount(0);

  // 状态用文字表达，不只靠颜色
  await expect(page.locator('[data-testid="proc-node-year"]')).toContainText("待你补充");
  await expect(page.locator('[data-testid="proc-node-materials"]')).toContainText("待核实");

  // 正文与官方出处仍在面板里
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("回答");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("官方出处");

  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/P1-process.png" });
});

test("2 首页：点开资格节点看学院口径与出处，点出处展开对应公文卡", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "我刚转专业，还能申请国家励志奖学金吗？");

  const elig = page.locator('[data-testid="proc-node-eligibility"]');
  await expect(elig).toHaveAttribute("aria-expanded", "false");
  await elig.click();
  await expect(elig).toHaveAttribute("aria-expanded", "true");

  const detail = page.locator('[data-testid="proc-detail-eligibility"]');
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("待学院确认");
  await expect(detail).toContainText("转入学院学生工作办公室");

  // 节点出处指向本轮 citations 的第 2 条（xg-lz-c2），点开展开公文卡
  const cite = detail.locator("button", { hasText: "看依据" });
  await expect(cite).toHaveCount(1);
  await cite.click();
  const doc = page.locator('[data-doc-id="xg-lz-c2"]');
  await expect(doc).toHaveClass(/is-open/);
  await expect(doc).toContainText("国家励志奖学金资格条件");

  // 流程图与公文卡同时可见（正文仍未被顶掉）
  await expect(page.locator('[data-testid="stage-process"]')).toBeVisible();
});

test("3 首页：390px 窄屏下路线纵向可读、按钮可点", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "我刚转专业，还能申请国家励志奖学金吗？");

  const proc = page.locator('[data-testid="stage-process"]');
  await expect(proc).toBeVisible();
  const box = await proc.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);

  // 每个节点高度足够点按，且标题不被截断
  const node = page.locator('[data-testid="proc-node-eligibility"]');
  const nb = await node.boundingBox();
  expect(nb!.height).toBeGreaterThan(32);
  await node.click();
  await expect(page.locator('[data-testid="proc-detail-eligibility"]')).toBeVisible();
  const text = await page.locator('[data-testid="proc-detail-eligibility"]').innerText();
  expect(text).toContain("待学院确认");

  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/P2-process-390.png", fullPage: true });
});

test("4 /chat：刷新后从历史恢复同一条路线与出处处", async ({ page }) => {
  // 历史接口返回一条已完成的助手消息（含 process），模拟刷新后回看
  const history = {
    messages: [
      { request_id: "h-1", seq: 1, role: "user", status: "done", text: "我刚转专业，还能申请国家励志奖学金吗？", response: null },
      {
        request_id: "h-1", seq: 2, role: "assistant", status: "answer",
        text: "转专业不是排除条件，排名口径需向转入学院确认。",
        response: {
          status: "answer",
          session_id: "sess-history",
          request_id: "h-1",
          trace_id: "trace-h",
          knowledge_version: "kb-test-000",
          unknown_fields: [],
          answer: {
            blocks: [{ kind: "note", text: "转专业不是排除条件，排名口径需向转入学院确认。", citation_ids: ["xg-lz-c2"] }],
            unknown_fields: [],
          },
          citations: [
            { id: "xg-lz-c1", title: "国家励志奖学金评审办法", issuer: "石河子大学学生处", url: "", published_at: "2025-09-01", locator: "第二条", excerpt: "6000 元。", time_condition: null },
            { id: "xg-lz-c2", title: "国家励志奖学金资格条件", issuer: "石河子大学学生处", url: "", published_at: "2025-09-01", locator: "第三条", excerpt: "双排名前 30%。", time_condition: null },
          ],
          actions: [],
          process: {
            title: "国家励志奖学金申请核对",
            nodes: [
              { id: "year", title: "核实申报年度", detail: "请补充申报年度。", state: "needs_user", citation_ids: [] },
              { id: "eligibility", title: "核对申请资格", detail: "转专业后的学院归属与排名口径（待学院确认）：需要向转入学院学生工作办公室确认", state: "needs_user", citation_ids: ["xg-lz-c2"] },
              { id: "materials", title: "查看材料", detail: "往年口径仅作参考。", state: "needs_check", citation_ids: [] },
            ],
            edges: [
              { from_id: "year", to_id: "eligibility", label: null },
              { from_id: "eligibility", to_id: "materials", label: null },
            ],
            focus_id: "year",
            workflow_entry: null,
          },
          timing_ms: 1200,
        },
      },
    ],
  };
  await page.route("**/api/v1/sessions/*/messages", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) });
  });
  await page.addInitScript(() => localStorage.setItem("shzu.session_id", "sess-history"));

  await page.goto("/chat");
  await expect(page.locator('[data-testid="stage-process"]')).toBeVisible();
  await expect(page.locator('[data-testid="proc-node-eligibility"]')).toContainText("核对申请资格");
  // 默认展开 focus 节点
  await expect(page.locator('[data-testid="proc-detail-year"]')).toBeVisible();

  // 节点出处处点击 → 消息附近（窄屏内联卡）/右侧证据栏指向同一条出处
  await page.locator('[data-testid="proc-node-eligibility"]').click();
  const cite = page.locator('[data-testid="proc-detail-eligibility"]').locator("button", { hasText: "看依据" });
  await cite.click();
  await expect(page.locator(".chat-aside")).toContainText("国家励志奖学金资格条件");
});
