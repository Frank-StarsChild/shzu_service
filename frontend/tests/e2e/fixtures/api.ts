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

  // ---- STAGE W4（只许追加）：舞台问话栏的会话与问答假数据 ----
  // 会话：POST 新建返回固定会话；GET 消息返回空列表（每个测试都是新上下文，localStorage 空）。
  await page.route("**/api/v1/sessions", async (route) => {
    if (route.request().method() === "POST") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: "sess-stage-test",
          expires_at: "2026-12-31T00:00:00Z",
        }),
      });
      return;
    }
    await route.fallback();
  });

  await page.route("**/api/v1/sessions/*/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [] }),
    });
  });

  // POST /api/v1/chat：按 message 关键词返回不同的回答（字段照 ChatResponse 填）
  await page.route("**/api/v1/chat", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = (req.postDataJSON() ?? {}) as {
      message?: string;
      choice_id?: string;
      session_id?: string;
      request_id?: string;
    };
    const msg = body.message ?? "";
    const base = {
      session_id: body.session_id ?? "sess-stage-test",
      request_id: body.request_id ?? "req-stage-test",
      trace_id: "trace-stage-test",
      knowledge_version: "kb-test-000",
      unknown_fields: [] as string[],
      citations: [] as Record<string, unknown>[],
      timing_ms: null as number | null,
    };
    const ok = (payload: Record<string, unknown>) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(payload),
      });

    if (msg.includes("学生证")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            {
              kind: "office",
              text: "补办学生证：本人携带身份证和一张近照，到大学生活动中心南楼301-302室学生处窗口办理，当场领取。",
              citation_ids: ["xsz-1"],
            },
            {
              kind: "note",
              text: "乘车优惠卡与学生证在同一窗口办理，可一并补办。",
              citation_ids: ["xsz-2"],
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
            excerpt: "学生证遗失补办在大学生活动中心南楼 301-302 室学生处窗口受理，工作日当场领取。",
            time_condition: "工作日 10:00–13:30",
          },
          {
            id: "xsz-2",
            title: "学生事务服务指南",
            issuer: "石河子大学学生处",
            url: "https://www.shzu.edu.cn/students/guide",
            published_at: "2025-09-01",
            locator: null,
            excerpt: null,
            time_condition: null,
          },
        ],
        timing_ms: 1800,
      });
      return;
    }

    if (msg.includes("借书")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            {
              kind: "fact",
              text: "图书借阅须在校园网内操作：一次最多借 20 本，借期 30 天，到期前可续借一次。",
              citation_ids: ["lib-1"],
            },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "lib-1",
            title: "图书借阅与续借规则",
            issuer: "石河子大学图书馆",
            url: "https://lib.shzu.edu.cn/loan",
            published_at: "2025-06-01",
            locator: "借阅规则第 3 条",
            excerpt: "借阅上限 20 册、借期 30 天，可续借一次。",
            time_condition: null,
          },
        ],
        timing_ms: 900,
      });
      return;
    }

    if (msg.includes("成绩单")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            {
              kind: "office",
              text: "中文成绩单可在行政楼一楼大厅或博学楼B区自助打印终端打印，英文成绩单需先到教务处审核。",
              citation_ids: ["jwc-1"],
            },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "jwc-1",
            title: "成绩单打印与翻译办理说明",
            issuer: "教务处",
            url: "https://jwc.shzu.edu.cn/transcript",
            published_at: "2025-04-15",
            locator: "第 1 条",
            excerpt: "中文成绩单在自助终端打印；英文成绩单须经教务处审核盖章。",
            time_condition: "工作日 16:00 前",
          },
        ],
        timing_ms: 1200,
      });
      return;
    }

    if (msg.includes("补办卡")) {
      await ok({
        ...base,
        status: "clarify",
        clarify: {
          question: "你说的是校园卡（一卡通）还是学生证？两边的补办地点不同。",
          choices: [
            { id: "choice-card", label: "校园卡（一卡通）" },
            { id: "choice-xsz", label: "学生证" },
          ],
        },
      });
      return;
    }

    if (msg.includes("校长")) {
      await ok({
        ...base,
        status: "out_of_scope",
        message: "这个问题不在校园办事范围内。智多星只回答与学校办事相关的问题。",
      });
      return;
    }

    if (msg.includes("奖学金怎么申请")) {
      await ok({
        ...base,
        status: "workflow",
        workflow: {
          flow_id: "national_inspirational_2025",
          flow_version: "v2025-demo",
          scope: { boards: ["学工"] },
          historical: true,
          name: "国家励志奖学金申请（2025 年度历史演示）",
          summary: "面向家庭经济困难且品学兼优学生的国家级奖励资助",
        },
      });
      return;
    }

    if (msg.includes("音乐")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            {
              kind: "fact",
              text: "音乐类讲座与演出的公告在文学艺术学院发布；艺术实践中心负责琴房预约。",
              citation_ids: ["art-1"],
            },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "art-1",
            title: "文学艺术学院活动公告汇总",
            issuer: "文学艺术学院（新闻传播学院）",
            url: "https://www.shzu.edu.cn/art/news",
            published_at: "2025-10-01",
            locator: null,
            excerpt: "音乐类活动公告由学院统一发布。",
            time_condition: null,
          },
        ],
        timing_ms: 1000,
      });
      return;
    }

    if (msg.includes("出错")) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({
          detail: {
            code: "model_error",
            message: "模型服务暂时不可用（测试模拟的 500）",
            retryable: true,
            trace_id: "trace-stage-test",
          },
        }),
      });
      return;
    }

    // 其余：资料不足，缺两项
    await ok({
      ...base,
      status: "insufficient",
      message: "现有审定资料里没有足够信息回答这个问题，需要补充以下内容。",
      unknown_fields: ["办理部门", "所需材料"],
    });
  });
}
