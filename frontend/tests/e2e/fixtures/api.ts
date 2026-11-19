import type { Page } from "@playwright/test";

// PLAN S1 第 5 步：测试不启动后端，用 page.route 拦截 /api。
// 先注册兜底（所有 api 路径一律 503 + JSON），再注册具体路由；
// Playwright 后注册的规则优先。返回字段照 src/api/client.ts 的类型填。
export async function mockApi(page: Page): Promise<void> {
  // 兜底：未 mock 的 /api 一律 503（用于断言“没有请求打到真实后端”类场景）
  await page.route("**/api/**", async (route) => {
    await route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        detail: {
          code: "api_unavailable",
          message: "测试兜底：该 API 未被 mock 覆盖",
          retryable: true,
          trace_id: "test-trace",
        },
      }),
    });
  });

  // GET /api/v1/health/ready —— useKbMeta()
  await page.route("**/api/v1/health/ready", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        status: "ok",
        knowledge_version: "kb-test-000",
        knowledge_sources: 45,
        knowledge_evidence: 79,
        model_provider: "deepseek",
        model_configured: true,
      }),
    });
  });

  // GET /api/v1/workflows —— HomeView 办事向导清单
  await page.route("**/api/v1/workflows", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        workflows: [
          {
            flow_id: "national_inspirational_2025",
            name: "国家励志奖学金申请（2025 年度历史演示）",
            version: "v2025-demo",
            historical: true,
            boards: ["学工"],
            steps: ["填写资格与排名", "规则自动核对", "生成材料清单", "导出申请表"],
          },
          {
            flow_id: "leave_request",
            name: "课程请假（生命科学学院模板）",
            version: "v1",
            historical: false,
            boards: ["教务"],
            steps: ["填写请假信息", "预览请假条", "导出 Word"],
          },
        ],
      }),
    });
  });

  // GET /api/v1/services（?board=…&q=…）—— ServicesView
  await page.route("**/api/v1/services*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        services: [
          {
            service_id: "test-svc-1",
            name: "国家励志奖学金申请",
            board: "学工",
            summary: "面向家庭经济困难且品学兼优学生的国家级奖励资助",
            evidence_ids: ["xg-lz-c1"],
            flow_id: "national_inspirational_2025",
            data_status: "reviewed",
            sample_questions: ["国家励志奖学金要什么条件？"],
          },
          {
            service_id: "test-svc-2",
            name: "图书借阅与续借",
            board: "图书馆",
            summary: "在借期限内可续借一次，须校园网内操作",
            evidence_ids: ["lib-loan-c4"],
            flow_id: null,
            data_status: "reviewed",
            sample_questions: ["一次能借几本书？"],
          },
        ],
        knowledge_version: "kb-test-000",
      }),
    });
  });
}
