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
  // 会话：POST 新建返回递增会话（每次重置会话都是一个新 id，才能测「新会话不带入旧草稿」）；
  // GET 消息返回空列表（每个测试都是新上下文，localStorage 空）。
  let sessionSeq = 0;
  await page.route("**/api/v1/sessions", async (route) => {
    if (route.request().method() === "POST") {
      sessionSeq += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          session_id: `sess-stage-test-${sessionSeq}`,
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

    // 纯问候 / 致谢：故意塞进正文楼名、图书馆 issuer 和一张单目的地 place 卡，
    // 验证「误带地点也保持视角」（按需定位的 hold）。
    const bare = msg.trim();
    if (bare === "你好" || bare === "您好" || bare === "谢谢" || bare === "谢谢你") {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            {
              kind: "note",
              text: "你好！我是石大智多星，可以问校园办事、政策条件和办理地点。",
              citation_ids: ["lib-hold"],
            },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "lib-hold",
            title: "图书馆服务说明（误带出处）",
            issuer: "石河子大学图书馆",
            url: "https://lib.shzu.edu.cn/about",
            published_at: "2025-06-01",
            locator: null,
            excerpt: "图书馆为全校师生提供借阅与咨询服务。",
            time_condition: null,
          },
        ],
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: false,
            matches: [{ building_id: "ZQ-B034", label: "图书馆", category: "文教", campus: "中区", note: "误带" }],
            fallback_text: null,
          },
        ],
        timing_ms: 600,
      });
      return;
    }

    // 图书馆几点关门：有时间没地点 → 保持视角
    if (msg.includes("图书馆几点") || msg.includes("几点关门")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            { kind: "fact", text: "图书馆周一至周日 8:00–22:30 开放，节假日以官网通知为准。", citation_ids: ["lib-time"] },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "lib-time",
            title: "图书馆开放时间",
            issuer: "石河子大学图书馆",
            url: "https://lib.shzu.edu.cn/hours",
            published_at: "2025-06-01",
            locator: null,
            excerpt: "每日 8:00–22:30 开放。",
            time_condition: null,
          },
        ],
        timing_ms: 700,
      });
      return;
    }

    // 慢回应（1.6 秒）：验证等待期间用户换校区/选楼后，旧回应不会把人拉回去
    if (msg.includes("慢问")) {
      await new Promise((r) => setTimeout(r, 1600));
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            { kind: "office", text: "图书馆在中区。", citation_ids: ["lib-slow"] },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "lib-slow",
            title: "图书馆位置",
            issuer: "石河子大学图书馆",
            url: "https://lib.shzu.edu.cn/loc",
            published_at: "2025-06-01",
            locator: null,
            excerpt: "图书馆位于中区。",
            time_condition: null,
          },
        ],
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: false,
            matches: [{ building_id: "ZQ-B034", label: "图书馆", category: "文教", campus: "中区", note: "登记楼" }],
            fallback_text: null,
          },
        ],
        timing_ms: 1600,
      });
      return;
    }

    // 图书馆在哪：结构化唯一目标 → 自动定位
    if (msg.includes("图书馆在哪")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            { kind: "office", text: "图书馆在中区，从北门进校后沿主路向南约 300 米。", citation_ids: ["lib-loc"] },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "lib-loc",
            title: "图书馆位置与开放说明",
            issuer: "石河子大学图书馆",
            url: "https://lib.shzu.edu.cn/loc",
            published_at: "2025-06-01",
            locator: null,
            excerpt: "图书馆位于中区。",
            time_condition: null,
          },
        ],
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: false,
            matches: [{ building_id: "ZQ-B034", label: "图书馆", category: "文教", campus: "中区", note: "登记楼" }],
            fallback_text: null,
          },
        ],
        timing_ms: 800,
      });
      return;
    }

    // 图书馆能借几本书：问数量 → 保持视角（即使带结构化地点）
    if (msg.includes("借几本")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            { kind: "fact", text: "本科生一次最多借 20 本，借期 30 天。", citation_ids: ["lib-loan-q"] },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "lib-loan-q",
            title: "图书借阅规则",
            issuer: "石河子大学图书馆",
            url: "https://lib.shzu.edu.cn/loan",
            published_at: "2025-06-01",
            locator: null,
            excerpt: "本科 20 册、30 天。",
            time_condition: null,
          },
        ],
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: false,
            matches: [{ building_id: "ZQ-B034", label: "图书馆", category: "文教", campus: "中区", note: "误带" }],
            fallback_text: null,
          },
        ],
        timing_ms: 700,
      });
      return;
    }

    // 哪里能还书：两个不同楼号 → 手动候选，不默认第一条
    if (msg.includes("哪里能还书")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            { kind: "office", text: "北区图书馆与中区图书馆都可以还书。", citation_ids: ["lib-return"] },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "lib-return",
            title: "图书归还地点",
            issuer: "石河子大学图书馆",
            url: "https://lib.shzu.edu.cn/return",
            published_at: "2025-06-01",
            locator: null,
            excerpt: "两馆通还。",
            time_condition: null,
          },
        ],
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: true,
            matches: [
              { building_id: "BQ-B018", label: "北区图书馆", category: "文教", campus: "北区", note: "通还" },
              { building_id: "ZQ-B034", label: "图书馆", category: "文教", campus: "中区", note: "通还" },
            ],
            fallback_text: null,
          },
        ],
        timing_ms: 900,
      });
      return;
    }

    // 只有文字地址：不给楼号，保留原话
    if (msg.includes("老行政楼")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            { kind: "office", text: "到老行政楼后面的平房办理（未登记楼号）。", citation_ids: ["old-office"] },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "old-office",
            title: "临时办公点说明",
            issuer: "后勤管理处",
            url: "https://www.shzu.edu.cn/hq/notice",
            published_at: "2025-09-01",
            locator: null,
            excerpt: "老行政楼后面的平房。",
            time_condition: null,
          },
        ],
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: false,
            matches: [],
            fallback_text: "老行政楼后面的平房（未登记楼号，位置以现场指示为准）",
          },
        ],
        timing_ms: 600,
      });
      return;
    }

    // 学生证丢了 → 办事单场景（errand 卡 + 沙盘定位 action，照后端 student_card_reissue 的取值）
    // 追问「怎么补办卡」选「学生证」时也走这份响应（choice-xsz 分支在下面）
    const studentCardErrand = (payloadBase: Record<string, unknown>) => ({
      ...payloadBase,
      status: "answer",
      answer: {
        blocks: [
          { kind: "office", text: "学生证补办：到大学生活动中心南楼301-302室学生事务管理办公室窗口办理，可同时补办乘车优惠卡。", citation_ids: ["xg-ks-c1"] },
          { kind: "note", text: "所需材料与办公时间请以办公室当期公示为准。", citation_ids: ["xg-ks-c1"] },
        ],
        unknown_fields: [],
      },
      citations: [
        {
          id: "xg-ks-c1",
          title: "学生事务管理办公室窗口说明",
          issuer: "石河子大学学生处",
          url: "https://www.shzu.edu.cn/xg/ks",
          published_at: "2025-09-01",
          locator: "第 2 条",
          excerpt: "学生事务管理办公室（大学生活动中心南楼301-302室）电话0993-2058029，负责学生证、乘车优惠卡办理。",
          time_condition: null,
        },
        {
          id: "xg-ks-c2",
          title: "学生事务服务指南",
          issuer: "石河子大学学生处",
          url: "https://www.shzu.edu.cn/xg/guide",
          published_at: "2025-09-01",
          locator: null,
          excerpt: null,
          time_condition: null,
        },
      ],
      actions: [
        {
          kind: "errand",
          title: "学生证 / 乘车优惠卡补办 · 办事单",
          place: { building: "大学生活动中心（南楼）", room: "301-302室", building_id: "ZQ-B023", campus: "中区", evidence_id: "xg-ks-c1" },
          dept: "学生事务管理办公室（学生处）",
          service_scope: "学生证、乘车优惠卡的办理",
          phone: "0993-2058029",
          hours: null,
          materials_confirmed: false,
          confirms: [
            { text: "补办所需材料（如身份证明、照片等）目前没有官方文件确认，请打办公楼电话核实后再去", state: "needs_user" },
            { text: "办公时间尚未在官方资料中登记，建议去电确认（避免白跑）", state: "needs_office" },
          ],
        },
        {
          kind: "place",
          title: "地点定位",
          ambiguous: false,
          matches: [{ building_id: "ZQ-B023", label: "大学生活动中心（南楼）", category: "办公", campus: "中区", note: "办事单定位" }],
          fallback_text: null,
        },
      ],
      timing_ms: 1800,
    });

    // 追问选「学生证」：POST 带 choice_id（没有 message），返回办事单响应
    if (body.choice_id === "choice-xsz") {
      await ok(studentCardErrand(base));
      return;
    }

    if (msg.includes("学生证丢了")) {
      await ok(studentCardErrand(base));
      return;
    }

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
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: false,
            matches: [{ building_id: "ZQ-B034", label: "图书馆", category: "文教", campus: "中区", note: "借阅服务台" }],
            fallback_text: null,
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
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: false,
            matches: [{ building_id: "ZQ-B024", label: "行政楼", category: "办公", campus: "中区", note: "自助打印" }],
            fallback_text: null,
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

    // 转专业 + 国家励志奖学金 → 办理路线（checklist 卡 + 三节点，年度待补充）
    if (msg.includes("转专业")) {
      await ok({
        ...base,
        status: "answer",
        answer: {
          blocks: [
            {
              kind: "note",
              text: "转专业不是国家励志奖学金的排除条件；但转专业后的排名口径需要向转入学院确认。",
              citation_ids: ["xg-lz-c2"],
            },
          ],
          unknown_fields: [],
        },
        citations: [
          {
            id: "xg-lz-c1",
            title: "国家励志奖学金评审办法",
            issuer: "石河子大学学生处",
            url: "https://www.shzu.edu.cn/xg/lz",
            published_at: "2025-09-01",
            locator: "第二条",
            excerpt: "国家励志奖学金每生每年 6000 元。",
            time_condition: null,
          },
          {
            id: "xg-lz-c2",
            title: "国家励志奖学金资格条件",
            issuer: "石河子大学学生处",
            url: "https://www.shzu.edu.cn/xg/lz2",
            published_at: "2025-09-01",
            locator: "第三条",
            excerpt: "二年级以上、家庭经济困难、双排名前 30%。",
            time_condition: null,
          },
          {
            id: "xg-lz-c6",
            title: "国家励志奖学金办理与材料",
            issuer: "石河子大学学生处",
            url: "https://www.shzu.edu.cn/xg/lz6",
            published_at: "2025-09-01",
            locator: null,
            excerpt: "申请表纸质版一式一份。",
            time_condition: null,
          },
        ],
        actions: [
          {
            kind: "checklist",
            title: "国家励志奖学金申请核对",
            award: "国家励志奖学金",
            year: null,
            year_note: "用户未说明申报年度；年度要求待确认。",
            items: [
              { label: "基本申请资格", state: "verified", detail: "二年级以上在籍在校生。", evidence_ids: ["xg-lz-c1"], key: "eligibility" },
              { label: "学习成绩排名与综合测评排名（双排名要求）", state: "needs_user", detail: "两项均须位于前 30%。", evidence_ids: ["xg-lz-c2"], key: "rank" },
              { label: "转专业后的学院归属与排名口径", state: "needs_college", detail: "需要向转入学院学生工作办公室确认。", evidence_ids: ["xg-lz-c2"], key: "transfer_major" },
              { label: "申请材料", state: "needs_web", detail: "申报年度未确认，往年口径仅作参考。", evidence_ids: [], key: "materials" },
            ],
            checks: [],
          },
        ],
        process: {
          title: "国家励志奖学金申请核对",
          nodes: [
            { id: "year", title: "核实申报年度", detail: "请补充申报年度（例如 2025 年度）。", state: "needs_user", citation_ids: [] },
            {
              id: "eligibility",
              title: "核对申请资格",
              detail: "学习成绩排名与综合测评排名（待你补充）；转专业后的学院归属与排名口径（待学院确认）：需要向转入学院学生工作办公室确认",
              state: "needs_user",
              citation_ids: ["xg-lz-c2"],
            },
            { id: "materials", title: "查看材料", detail: "申报年度未确认：当年申请表版本与材料清单需以正式通知为准（往年口径，仅作参考）。", state: "needs_check", citation_ids: [] },
          ],
          edges: [
            { from_id: "year", to_id: "eligibility", label: null },
            { from_id: "eligibility", to_id: "materials", label: null },
          ],
          focus_id: "year",
          workflow_entry: null,
        },
        timing_ms: 1200,
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
          // 会话里学生自述过“本科 / 大二”（后端 seed_slots 抽取）：进入向导时作为待确认预设
          preset_slots: { student_type: "本科", grade: "二年级" },
          preset_note: "你刚才提到自己是本科二年级学生",
        },
        citations: [
          {
            id: "xg-lz-c1",
            title: "国家励志奖学金评审办法",
            issuer: "石河子大学学生处",
            url: "https://www.shzu.edu.cn/xg/lz",
            published_at: "2025-09-01",
            locator: "第二条",
            excerpt: "国家励志奖学金每生每年 6000 元。",
            time_condition: null,
          },
          {
            id: "xg-lz-c6",
            title: "国家励志奖学金办理与材料",
            issuer: "石河子大学学生处",
            url: "https://www.shzu.edu.cn/xg/lz6",
            published_at: "2025-09-01",
            locator: null,
            excerpt: "申请表纸质版一式一份。",
            time_condition: null,
          },
        ],
        // 向导状态同样带办理路线：入口挂在「文书生成」节点（不再另出按钮）
        process: {
          title: "国家励志奖学金申请（2025年度历史演示）",
          nodes: [
            { id: "policy", title: "事项与政策确认", detail: "确认申请国家励志奖学金、学生层次与申报年度（2025历史演示）。", state: "upcoming", citation_ids: ["xg-lz-c1"] },
            { id: "conditions", title: "条件对照", detail: "按规则逐项核对年级、困难认定、双排名。", state: "upcoming", citation_ids: ["xg-lz-c1"] },
            { id: "materials", title: "材料清单", detail: "生成已准备/待准备/需确认的材料清单。", state: "ready", citation_ids: ["xg-lz-c6"] },
            { id: "document", title: "文书生成", detail: "按 2025 年学校申请表结构生成可编辑申请表，签名与审核栏留白。", state: "ready", citation_ids: ["xg-lz-c1"] },
            { id: "export", title: "预览与导出", detail: "导出 Word/PDF，附填写依据与办理提示。", state: "upcoming", citation_ids: ["xg-lz-c6"] },
          ],
          edges: [
            { from_id: "policy", to_id: "conditions", label: null },
            { from_id: "conditions", to_id: "materials", label: null },
            { from_id: "materials", to_id: "document", label: null },
            { from_id: "document", to_id: "export", label: null },
          ],
          focus_id: "policy",
          workflow_entry: { node_id: "document", flow_id: "national_inspirational_2025", historical: true },
        },
        timing_ms: 1500,
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
        actions: [
          {
            kind: "place",
            title: "地点定位",
            ambiguous: false,
            matches: [{ building_id: "JJ-B019", label: "文学艺术学院", category: "学院", campus: "将军山", note: "学院驻地" }],
            fallback_text: null,
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

// ---- 办事体验改造：向导详情 / 预览 / 导出（照后端契约与 flows.json 结构） ----
const LIZHI_STEPS = [
  { key: "policy", name: "事项与政策确认", desc: "确认申请国家励志奖学金、学生层次与申报年度（2025历史演示）", slot_keys: ["student_type"], evidence_ids: ["xg-lz-c1"] },
  { key: "conditions", name: "条件对照", desc: "按规则逐项核对年级、困难认定、双排名，输出三态结果", slot_keys: ["grade", "difficulty_confirmed", "study_rank", "study_total", "zongce_rank", "zongce_total"], evidence_ids: ["xg-lz-c1", "xg-lz-c2"] },
  { key: "materials", name: "材料清单", desc: "生成已准备/待准备/需确认的材料清单", slot_keys: [], evidence_ids: ["xg-lz-c6"] },
  { key: "document", name: "文书生成", desc: "按2025年学校申请表结构生成可编辑申请表", slot_keys: ["name", "college", "major_class", "reason"], evidence_ids: ["xg-lzform-c1", "xg-lz-c5"] },
  { key: "export", name: "预览与导出", desc: "导出Word/PDF，附填写依据与办理提示", slot_keys: [], evidence_ids: ["xg-lz-c5", "xg-lz-c6"] },
];

const LIZHI_SLOTS = [
  { key: "student_type", label: "学生层次", type: "choice", options: ["本科", "专科"], required: true, personal: false },
  { key: "grade", label: "当前年级", type: "choice", options: ["一年级", "二年级", "三年级", "四年级"], required: true, personal: false },
  { key: "difficulty_confirmed", label: "本学年是否已通过家庭经济困难认定", type: "choice", options: ["是", "否", "不确定"], required: true, personal: false },
  { key: "study_rank", label: "学习成绩排名（名次）", type: "number", options: [], required: true, personal: false, group: "学习成绩排名（名次/总人数）" },
  { key: "study_total", label: "学习成绩排名总人数", type: "number", options: [], required: true, personal: false, group: "学习成绩排名（名次/总人数）" },
  { key: "zongce_rank", label: "综合测评排名（名次）", type: "number", options: [], required: true, personal: false, group: "综合测评排名（名次/总人数）" },
  { key: "zongce_total", label: "综合测评排名总人数", type: "number", options: [], required: true, personal: false, group: "综合测评排名（名次/总人数）" },
  { key: "name", label: "姓名", type: "text", options: [], required: false, personal: true },
  { key: "college", label: "院（系）", type: "text", options: [], required: false, personal: true },
  { key: "major_class", label: "专业与班级", type: "text", options: [], required: false, personal: true },
  { key: "reason", label: "申请理由", type: "textarea", options: [], required: true, personal: false, note: "简述家庭经济情况与在校表现" },
];

const LIZHI_MATERIALS = [
  { name: "国家励志奖学金申请表", status: "generated", submit_or_keep: "由向导生成后打印，与材料一并提交", evidence_ids: ["xg-lz-c5"] },
  { name: "家庭经济困难认定申请表", status: "to_prepare", submit_or_keep: "先在学院完成本学年困难认定，留存复印件", evidence_ids: ["xg-lz-c3"] },
  { name: "成绩与综合排名证明", status: "conditional", submit_or_keep: "向学院教务秘书申请盖章", evidence_ids: ["xg-lz-c2"] },
];

/** 由输入算一个简单 token：字段一变 token 变（模拟后端 inputs sha256 前缀） */
function fakePreviewToken(inputs: Record<string, unknown>): string {
  const s = JSON.stringify(inputs ?? {});
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h * 31) + s.charCodeAt(i)) & 0xffffff;
  return "tok-" + h.toString(16);
}

const LIZHI_REQUIRED = ["student_type", "grade", "difficulty_confirmed", "study_rank", "study_total", "zongce_rank", "zongce_total", "reason"];

export async function mockWorkflowApi(page: Page): Promise<void> {
  // GET /api/v1/workflows/{id} —— 向导详情（steps.slot_keys 分组 + 槽位 group）
  await page.route("**/api/v1/workflows/*", async (route) => {
    const url = new URL(route.request().url());
    const flowId = url.pathname.split("/").pop() ?? "";
    if (flowId !== "national_inspirational_2025") {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ detail: { code: "flow_not_found", message: "向导不存在", retryable: false, status: 404 } }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        flow_id: "national_inspirational_2025",
        name: "国家励志奖学金申请（2025 年度历史演示）",
        version: "v2025-demo",
        historical: true,
        demo_notice: "本流程基于 2025 年度历史资料构建，仅作功能演示。",
        scope: { boards: ["学工"], award_type: "国家励志奖学金" },
        steps: LIZHI_STEPS,
        slots: LIZHI_SLOTS,
        rule_results: [],
        materials: LIZHI_MATERIALS,
        timeline: [
          { owner: "学生", action: "准备材料并向学院提交申请" },
          { owner: "学院", action: "初审与公示后报学生处" },
          { owner: "学生处", action: "复核汇总后报上级评审" },
        ],
        contact: { person: "学生处资助管理科", phone: "0993-2058029", email: null },
        evidence_ids: ["xg-lz-c1"],
      }),
    });
  });

  // POST /api/v1/workflows/{id}/preview —— 按必填项与历史勾选给出三态核对
  await page.route("**/api/v1/workflows/*/preview", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { inputs?: Record<string, any>; historical_confirmed?: boolean };
    const inputs = body.inputs ?? {};
    const fieldErrors = LIZHI_REQUIRED
      .filter((k) => String(inputs[k] ?? "").trim() === "")
      .map((k) => ({ slot_key: k, message: "该项为必填，请填写后再核对" }));
    const historicalError = body.historical_confirmed !== true
      ? [{ slot_key: "_historical", message: "请先勾选「我已了解这是 2025 年度历史案例演示」" }]
      : [];
    const allErrors = [...fieldErrors, ...historicalError];
    const rankOk = Number(inputs.study_rank) > 0 && Number(inputs.study_rank) <= Number(inputs.study_total) / 2;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        preview_token: fakePreviewToken(inputs),
        flow_id: "national_inspirational_2025",
        flow_version: "v2025-demo",
        field_errors: allErrors,
        rule_results: allErrors.length ? [] : [
          { rule_id: "r-grade", name: "年级范围（二年级及以上）", state: inputs.grade === "一年级" ? "fail" : "pass", explain: `当前年级：${inputs.grade}；规则要求二年级及以上`, evidence_ids: ["xg-lz-c1"] },
          { rule_id: "r-rank", name: "学习成绩排名靠前（前 50%）", state: rankOk ? "pass" : "unknown", explain: `学习成绩排名 ${inputs.study_rank}/${inputs.study_total}`, evidence_ids: ["xg-lz-c2"] },
        ],
        materials: LIZHI_MATERIALS,
        missing_personal_fields: ["姓名", "院（系）", "专业与班级"].filter((label, i) => String(inputs[["name", "college", "major_class"][i]] ?? "").trim() === ""),
        document_kinds: ["apply_form"],
        evidence_ids: ["xg-lz-c1"],
        generated: allErrors.length === 0,
      }),
    });
  });

  // POST /api/v1/workflows/{id}/export —— 返回一个占位 docx（真实文件校验由后端冒烟负责）
  await page.route("**/api/v1/workflows/*/export", async (route) => {
    await route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "content-disposition": "attachment; filename*=UTF-8''%E5%9B%BD%E5%AE%B6%E5%8A%B1%E5%BF%97%E5%A5%96%E5%AD%A6%E9%87%91%E7%94%B3%E8%AF%B7%E8%A1%A8.docx",
      },
      body: Buffer.from("docx-placeholder", "utf-8"),
    });
  });
}
