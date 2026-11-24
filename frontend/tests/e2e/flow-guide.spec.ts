// 办事体验改造 e2e：聊天信息带入向导（预设卡）、草稿持久化（会话×事项）、
// 分步渲染（slot_keys + 双排名组）、核对过期（preview_stale）、errand 办事单、
// 首页「继续办理」、新会话不串、窄屏预览折叠。
// mock：mockApi（会话/问答/清单）+ mockWorkflowApi（向导详情/预览/导出）。
import { expect, test, type Page } from "@playwright/test";
import { mockApi, mockWorkflowApi } from "./fixtures/api";

async function loginWizard(page: Page) {
  await page.goto("/chat");
  const ta = page.locator(".composer textarea");
  await ta.fill("我是大二本科生，想用 2025 年的历史样例看看国家励志奖学金怎么申请");
  await ta.press("Enter");
  // workflow 卡：名称 + 进入向导
  await expect(page.getByText("国家励志奖学金申请（2025 年度历史演示）").first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /进入向导/ }).click();
  await expect(page).toHaveURL(/\/workflows\/national_inspirational_2025/);
  await expect(page.getByTestId("wiz-form")).toBeVisible({ timeout: 10_000 });
}

/** 步骤 2 必填：困难认定 + 双排名（年级由预设或手动给） */
async function fillConditions(page: Page) {
  await page.getByTestId("slot-difficulty_confirmed").selectOption("是");
  await page.getByTestId("slot-study_rank").fill("12");
  await page.getByTestId("slot-study_total").fill("100");
  await page.getByTestId("slot-zongce_rank").fill("18");
  await page.getByTestId("slot-zongce_total").fill("120");
}

/** 全部必填写完 + 勾历史演示，停在导出步骤 */
async function completeForExport(page: Page) {
  await page.goto("/workflows/national_inspirational_2025");
  await page.getByTestId("historical-check").check();
  await page.getByTestId("slot-student_type").selectOption("本科");
  await page.getByTestId("wiz-step-1").click();
  await expect(page.getByTestId("slot-grade")).toBeVisible();
  await page.getByTestId("slot-grade").selectOption("三年级");
  await fillConditions(page);
  await page.getByTestId("wiz-step-3").click();
  await page.getByTestId("slot-reason").fill("家中主要收入来源不稳定，本人在校表现良好，成绩与综合测评均位于班级前列。");
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await mockWorkflowApi(page);
});

test("1 聊天说过的身份进向导变成待确认预设：默认本科二年级，确认后带入表单", async ({ page }) => {
  await loginWizard(page);
  // 预设卡：note 里的自述事实 + 两个默认值
  const card = page.getByTestId("preset-card");
  await expect(card).toBeVisible();
  await expect(card).toContainText("你刚才提到自己是本科二年级学生");
  await expect(page.getByTestId("preset-student_type")).toHaveValue("本科");
  await expect(page.getByTestId("preset-grade")).toHaveValue("二年级");
  await page.getByTestId("preset-confirm").click();
  // 确认后卡消失；步骤 1 的学生层次已带入
  await expect(card).toHaveCount(0);
  await expect(page.getByTestId("slot-student_type")).toHaveValue("本科");
});

test("2 预设可先改再确认：二年级改成三年级，条件对照步骤如实显示三年级", async ({ page }) => {
  await loginWizard(page);
  await page.getByTestId("preset-grade").selectOption("三年级");
  await page.getByTestId("preset-confirm").click();
  await page.getByTestId("wiz-step-1").click();
  await expect(page.getByTestId("slot-grade")).toHaveValue("三年级");
  // 草稿里记录了已确认：重进（同会话同事项）不再弹预设卡，值保留
  await page.goto("/chat");
  await page.goto("/workflows/national_inspirational_2025");
  await expect(page.getByTestId("wiz-form")).toBeVisible();
  await expect(page.getByTestId("preset-card")).toHaveCount(0);
  await page.getByTestId("wiz-step-1").click();
  await expect(page.getByTestId("slot-grade")).toHaveValue("三年级");
});

test("3 预设可不带入：跳过后表单留空，学生自己填", async ({ page }) => {
  await loginWizard(page);
  await page.getByTestId("preset-skip").click();
  await expect(page.getByTestId("preset-card")).toHaveCount(0);
  await expect(page.getByTestId("slot-student_type")).toHaveValue("");
});

test("4 服务目录/首页直达向导：没有聊天上下文就不出现预设卡", async ({ page }) => {
  await page.goto("/workflows/national_inspirational_2025");
  await expect(page.getByTestId("wiz-form")).toBeVisible();
  await expect(page.getByTestId("preset-card")).toHaveCount(0);
  await expect(page.getByTestId("historical-notice")).toBeVisible();
});

test("5 草稿保留手动修改：到证据页再返回，年级与排名、当前步骤都在", async ({ page }) => {
  await page.goto("/workflows/national_inspirational_2025");
  await page.getByTestId("wiz-step-1").click();
  await page.getByTestId("slot-grade").selectOption("三年级");
  await page.getByTestId("slot-study_rank").fill("12");
  // 步骤说明里的证据按钮 → 证据详情页
  await page.getByRole("button", { name: /证据 xg-lz-c1 ↗/ }).click();
  await expect(page).toHaveURL(/\/sources\/xg-lz-c1/);
  await page.goBack();
  await expect(page.getByTestId("wiz-form")).toBeVisible();
  await expect(page.getByTestId("slot-grade")).toHaveValue("三年级");
  await expect(page.getByTestId("slot-study_rank")).toHaveValue("12");
});

test("6 新会话不带入旧信息：新建会话后再进向导，表单是空的", async ({ page }) => {
  await page.goto("/workflows/national_inspirational_2025");
  await page.getByTestId("wiz-step-1").click();
  await page.getByTestId("slot-grade").selectOption("三年级");
  await page.goto("/chat");
  await page.getByRole("button", { name: "新建会话" }).click();
  await expect(page.locator(".composer textarea")).toBeVisible();
  await page.goto("/workflows/national_inspirational_2025");
  await expect(page.getByTestId("wiz-form")).toBeVisible();
  // 新会话的草稿键不同：旧值不串入
  await page.getByTestId("wiz-step-1").click();
  await expect(page.getByTestId("slot-grade")).toHaveValue("");
});

test("7 核对后会过期：改字段即提示“重新核对”，导出按钮收回；重新核对后恢复", async ({ page }) => {
  await completeForExport(page);
  await page.getByTestId("wiz-step-4").click();
  await page.getByRole("button", { name: "核对并生成预览" }).click();
  await expect(page.getByTestId("wiz-export-btn")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("preview-stale")).toHaveCount(0);
  // 回改字段：旧核对过期
  await page.getByTestId("wiz-step-1").click();
  await page.getByTestId("slot-study_rank").fill("10");
  await page.getByTestId("wiz-step-4").click();
  await expect(page.getByTestId("preview-stale")).toBeVisible();
  await expect(page.getByTestId("wiz-export-btn")).toHaveCount(0);
  // 重新核对后恢复，且新核对以改后的值为准（过期后按钮回到“核对并生成预览”）
  await page.getByRole("button", { name: /核对并生成预览|重新核对/ }).click();
  await expect(page.getByTestId("wiz-export-btn")).toBeVisible({ timeout: 10_000 });
  await expect(page.locator(".rules-table").first()).toContainText("10/100");
});

test("8 分步渲染：步骤 1 只有学生层次；步骤 2 的双排名名次/总人数同组可见；材料步骤有下一步动作", async ({ page }) => {
  await page.goto("/workflows/national_inspirational_2025");
  // 步骤 1：只有 student_type
  await expect(page.getByTestId("slot-student_type")).toBeVisible();
  await expect(page.getByTestId("slot-grade")).toHaveCount(0);
  // 步骤 2：普通槽 + 两个排名组
  await page.getByTestId("wiz-step-1").click();
  await expect(page.getByTestId("slot-grade")).toBeVisible();
  await expect(page.getByTestId("slot-study_rank")).toBeVisible();
  await expect(page.getByTestId("slot-zongce_total")).toBeVisible();
  await expect(page.locator(".wiz-rank", { hasText: "学习成绩排名（名次/总人数）" })).toBeVisible();
  await expect(page.locator(".wiz-rank", { hasText: "综合测评排名（名次/总人数）" })).toBeVisible();
  // 组内小标：名次 / 总人数 能分清在填哪种
  const group = page.locator(".wiz-rank", { hasText: "学习成绩排名（名次/总人数）" });
  await expect(group.locator(".flabel", { hasText: "名次" })).toBeVisible();
  await expect(group.locator(".flabel", { hasText: "总人数" })).toBeVisible();
  // 材料步骤：每项有下一步动作列
  await page.getByTestId("wiz-step-2").click();
  const materials = page.getByTestId("wiz-materials");
  await expect(materials).toBeVisible();
  await expect(materials.locator("thead")).toContainText("下一步动作");
  await expect(materials.locator("tbody tr")).toHaveCount(3);
});

test("9 右侧实时预览：桌面常显并随填写更新；改值的那行有轻提示", async ({ page }) => {
  await page.goto("/workflows/national_inspirational_2025");
  await page.getByTestId("slot-student_type").selectOption("本科");
  await expect(page.locator(".fprev")).toBeVisible();
  // 预览里的学生层次同步为本科
  await expect(page.locator(".fprev")).toContainText("本科");
  await expect(page.locator(".fprev")).toContainText("2025 年度历史演示");
  // 填名次 → 预览同步（走 rankPair）
  await page.getByTestId("wiz-step-1").click();
  await page.getByTestId("slot-study_rank").fill("12");
  await expect(page.locator(".fprev")).toContainText("12 / （总人数待填）");
});

test("10 普通聊天：学生证丢了 → 办事单卡（地点房间大字、电话、出发前确认、沙盘入口）", async ({ page }) => {
  await page.goto("/chat");
  const ta = page.locator(".composer textarea");
  await ta.fill("我的学生证丢了去哪补办");
  await ta.press("Enter");
  const card = page.getByTestId("errand-card");
  await expect(card).toBeVisible({ timeout: 10_000 });
  await expect(card).toContainText("大学生活动中心（南楼）");
  await expect(page.getByTestId("errand-room")).toHaveText("301-302室");
  await expect(page.getByTestId("errand-phone")).toHaveAttribute("href", "tel:09932058029");
  await expect(page.getByTestId("errand-confirms")).toContainText("补办所需材料");
  await expect(page.getByTestId("errand-confirms")).toContainText("办公时间");
  await expect(card).toContainText("学生事务管理办公室（学生处）");
  await expect(page.getByTestId("errand-sandbox")).toBeVisible();
});

test("11 沙盘：问学生证补办去处 → 面板出办事单并自动落楼（大学生活动中心）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
  // 按需定位：只有明确问「去哪」才自动飞；只问「怎么办」时办事单照常、镜头不动
  await page.fill('[data-testid="stage-input"]', "我的学生证丢了去哪补办");
  await page.press('[data-testid="stage-input"]', "Enter");
  await expect(page.getByTestId("stage-act-errand")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("stage-errand-place")).toContainText("大学生活动中心（南楼）");
  await expect(page.getByTestId("stage-errand-phone")).toHaveAttribute("href", "tel:09932058029");
  await expect(page.getByTestId("stage-errand-confirms")).toContainText("办公时间");
  // actions 里的 place 定位优先于文字：直接落楼 ZQ-B023（大学生活动中心），红色高亮出现
  await expect(page.getByTestId("stage-panel-place")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("stage-panel-place")).toContainText("大学生活动中心");
});

test("12 首页「继续办理」：显示事项名、停在哪一步、下一项待补；点击恢复草稿", async ({ page }) => {
  await page.goto("/workflows/national_inspirational_2025");
  await page.getByTestId("slot-student_type").selectOption("本科");
  await page.getByTestId("wiz-step-1").click();
  await page.getByTestId("slot-grade").selectOption("二年级");
  await page.goto("/classic");
  const resume = page.getByTestId("continue-drafts");
  await expect(resume).toBeVisible();
  await expect(resume).toContainText("国家励志奖学金申请");
  await expect(resume).toContainText("条件对照");
  await expect(resume).toContainText("本学年是否已通过家庭经济困难认定");
  await page.getByTestId("resume-draft-0").click();
  await expect(page).toHaveURL(/\/workflows\/national_inspirational_2025\?draft=sess-/);
  await expect(page.getByTestId("wiz-form")).toBeVisible();
  // 恢复的是草稿：年级还在，步骤停在条件对照
  await expect(page.getByTestId("slot-grade")).toBeVisible();
  await expect(page.getByTestId("slot-grade")).toHaveValue("二年级");
});

test("13 窄屏 390：预览折叠为「查看预览」按钮，点开可见且不溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workflows/national_inspirational_2025");
  await expect(page.getByTestId("wiz-form")).toBeVisible();
  const toggle = page.getByTestId("mobile-preview-toggle");
  await expect(toggle).toBeVisible();
  await expect(page.locator(".fprev")).toBeHidden();
  await toggle.click();
  await expect(page.locator(".fprev")).toBeVisible();
  await expect(toggle).toContainText("收起预览");
  await toggle.click();
  await expect(page.locator(".fprev")).toBeHidden();
  // 横向不溢出
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
