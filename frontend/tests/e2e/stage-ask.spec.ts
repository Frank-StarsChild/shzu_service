import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// W4：问话栏和回答面板。/stage?3d=1&intro=0；镜头这张卡不动（stop 一直是 home）。

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

test("1 状态行与示例问题", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await expect(page.locator('[data-testid="stage-status"]')).toContainText("条审定证据");
  const examples = ["学生证丢了去哪补办？", "国家励志奖学金要什么条件？", "宿舍水管坏了怎么报修？", "借教室要提前几天申请？"];
  for (const q of examples) {
    await expect(page.locator(".stage-example", { hasText: q })).toBeVisible();
  }
});

test("2 学生证：面板出现，含答/回答/官方出处/楼名；两张公文卡；右上证据计时", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await expect(page).toHaveURL(/\/stage/); // 没有跳页
  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("答");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("回答");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("官方出处");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("大学生活动中心南楼");
  await expect(page.locator('[data-testid="stage-doc-1"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-doc-2"]')).toBeVisible();
  await expect(page.locator(".stage-panel-meta")).toContainText("依据 2 条审定证据 · 1.8 秒");
  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W4-answer.png" });
});

test("3 公文卡与正文的舞台样式", async ({ page }) => {
  // 主题改造后舞台界面随日/夜换色：本条断言的是舞台的签名夜间样式
  // （宣纸公文卡 + 鎏金 .no），显式固定夜间，避免受系统外观影响。
  await page.addInitScript(() => localStorage.setItem("shzu.theme", "dark"));
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await expect(page.locator('[data-testid="stage-doc-1"]')).toBeVisible();
  const docBg = await page
    .locator('[data-testid="stage-doc-1"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(docBg).toBe("rgb(239, 232, 216)");
  const nw = await page
    .locator('[data-testid="stage-doc-1"] img')
    .evaluate((el) => (el as HTMLImageElement).naturalWidth);
  expect(nw).toBeGreaterThan(0);
  const block = page.locator('[data-testid="stage-panel"] .block').first();
  const blockBg = await block.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(blockBg).toBe("rgba(0, 0, 0, 0)");
  const noColor = await block.locator(".no").evaluate((el) => getComputedStyle(el).color);
  expect(noColor).toBe("rgb(232, 201, 138)");
});

test("4 点公文卡：展开看原文，链接去 /sources/", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await expect(page.locator('[data-testid="stage-doc-1"]')).toBeVisible();
  await page.click('[data-testid="stage-doc-1"]');
  const link = page.locator('[data-testid="stage-doc-1"] .stage-doc-link');
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toMatch(/^\/sources\//);
  await page.click('[data-testid="stage-doc-1"]');
  await expect(link).toHaveCount(0);
});

test("5 补办卡：追问两句，点第一个选项后内容变了", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "怎么补办卡");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("还要问你一句");
  await expect(page.locator('[data-testid="stage-panel"] .stage-choice')).toHaveCount(2);
  await page.locator('[data-testid="stage-panel"] .stage-choice').first().click();
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("资料不足");
});

test("6 校长：不在办事范围内", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "校长是谁的偶像");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("不在办事范围内");
});

test("7 奖学金：办事向导，进入向导去 /workflows/", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "奖学金怎么申请");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("办事向导");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("国家励志奖学金");
  // 办理路线带向导入口时只留流程里的一个按钮（不再重复原按钮）
  await expect(page.locator('[data-testid="stage-workflow-enter"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="proc-enter-flow"]')).toBeVisible();
  await page.click('[data-testid="proc-enter-flow"]');
  await expect(page).toHaveURL(/\/workflows\//);
});

test("8 出错：这一轮没有答出来 + 再试一次", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "出错");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("这一轮没有答出来");
  await expect(page.locator('[data-testid="stage-retry"]')).toBeVisible();
  await page.goto("/stage?3d=1&intro=0");
  await expect(page.locator('[data-testid="stage-panel"]')).toHaveCount(0);
});

test("9 其余：资料不足 + 还缺", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "随便问点别的");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("资料不足");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("还缺：");
});

test("10 空输入点问：不发请求", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  let chatRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/chat")) chatRequests += 1;
  });
  await page.fill('[data-testid="stage-input"]', "   ");
  await page.click('[data-testid="stage-ask"]');
  await page.waitForTimeout(400);
  expect(chatRequests).toBe(0);
  await expect(page.locator('[data-testid="stage-panel"]')).toHaveCount(0);
});

test("11 问答全程画布仍在渲染；无地点的问题不动镜头", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  // W5 起，能落到楼上的回答会飞镜头（由 stage-place 验证）；这里用一个无地点的问题
  // （校长→超出范围）验证原意：问答全程画布仍在渲染、镜头不动。
  await ask(page, "校长是谁的偶像");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("不在办事范围内");
  const frames0 = await page.evaluate(() => window.__campus3d.frames);
  // 软件渲染实测约 1–10 帧/秒（见 PROGRESS 夜景篇）：窗口取 3 秒，只要仍在出帧即算活着
  await page.waitForTimeout(3000);
  const h = await page.evaluate(() => ({
    frames: window.__campus3d.frames,
    status: window.__campus3d.status,
    stop: window.__campus3d.stop,
  }));
  expect(h.status).toBe("ready");
  expect(h.stop).toBe("home");
  expect(h.frames).toBeGreaterThan(frames0);
});
