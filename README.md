# 石大智多星：校园一站式服务智能体

**赛道一 · 揭榜命题五（“石大智多星”——校园一站式服务智能体）工程实现**

产品主张：**问得明白，查得到依据，带着材料去办事。**

本仓库是方案《石大智多星_Vue3_FastAPI_详细技术方案》的落地工程：
**Vue 3 + TypeScript + Pinia + Vue Router 前端**（瑞士国际主义风格，六路由多视图）、
**FastAPI 后端**（版本化 /api/v1 契约、DeepSeek + LangChain/LangGraph 对话图）。
决策策略为**模型优先 + 工具调用 + 规则校验**：每轮把当前消息、相关会话历史和工具清单交给
DeepSeek（LangChain 工具调用协议），模型自行判断直接回答、追问或调用工具；LangGraph 执行工具并
把真实结果返回模型，由模型生成全部用户可见正文（reply）。关键词/别名/日期规则不再提前结束对话：
仅用于查询规范化（别名归一/身份识别）、检索候选匹配（主题触发词）、结果校验（证据 ID 合法性、
向导适用性、机构范围防串答）。模型不可用/超时/输出未过校验时返回 `error` 技术错误状态
（页面显示失败与重试入口，不冒充智能体回答；重试会真实重跑）。
前端提供问答与证据联动、办事向导（表单→规则核对→文书导出）、服务目录与证据详情。

- 知识版本：`kb-2026-11-19-r5`（45 份官方来源、79 条审定条款；含信科院与文学艺术学院两个学院概况主题）
- 五大办事板块：学工、教务、后勤、保卫、图书馆；学院概况经离线导入流水线接入（`scripts/import_college_intro.py`，从原始采集资料逐段对照入库）
- 三个向导：国家励志奖学金（2025 历史演示）、课程请假（生命科学学院模板）、教学场所借用
- 对话策略：对话图（`backend/app/agent/graph.py`）每轮执行 prepare（规范化+校验提示注入：年度覆盖/时间窗/歧义/学院机构）→ model（LangChain 绑定工具，模型调用次数 ≤4、单轮预算 ≤24s、硬超时看门狗）⇄ tools（LangGraph 执行）→ publish（校验后发布）。三个工具：`search_campus_knowledge`（分段多路 BM25+RRF 融合+主题触发词候选置顶；学院信息类意图按机构严格过滤防串答）、`list_campus_colleges`（全校教学机构目录，含“（筹）”筹建限定，条目数仅作采集清单口径不作官方总数）、`find_service_workflow`（向导适用性校验：2025 历史演示年度/生科院模板等硬边界）
- 所有聊天正文（问候/身份/能力/澄清/资料不足/超出范围/向导摘要）由 DeepSeek 按当轮问题撰写；发布前校验证据 ID ⊆ 工具返回集合、flow_id ∈ 工具确认可用集合，前端原样渲染 reply 并按 ID 填充引用、选项与向导按钮（不再按状态或原因码替换正文）
- 评测：核心 50 题 + 边界 25 题，模型优先链路全量通过（75/75，每题独立会话避免历史噪声）；平均约 2.6s，最大 <5s；验收含模拟模型唯一测试文本经 LangChain→FastAPI 到 Vue 气泡的端到端断言与真实 DeepSeek 复测
- 模型配置：项目根 `.env`（已 git ignore）设置 `DEEPSEEK_API_KEY / DEEPSEEK_MODEL / DEEPSEEK_BASE_URL / DEEPSEEK_TIMEOUT`，后端启动时自动加载

> 演示与测试使用虚构个人信息；2025 国家励志奖学金流程明确标注“历史演示，不可用于当前年度申报”。

---

## 1. 快速启动（Windows）

**方式一（推荐）：双击一键启动**

```text
双击工程目录下的 start.bat
```

脚本会按顺序：启动后端（8300，等待就绪）→ 启动前端 Vite 开发服务器（5180）→ 自动打开浏览器。
停止服务：关闭「石大智多星-后端」「石大智多星-前端」两个黑窗口。
> 前端默认端口为 5180：5173 常被其他项目占用，已在 vite.config.ts 中固定。

**方式二：命令行分步启动**

```powershell
cd shzu-service-agent

# 1) 后端依赖（首次）
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt

# 2) 前端构建（首次或前端改动后）
cd frontend
npm install
npm run build
cd ..

# 3) 启动服务（默认 http://127.0.0.1:8300）
.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8300
```

打开 `http://127.0.0.1:8300/` 即可使用完整应用（后端同时托管构建后的前端）。

前端开发模式（可选，热更新）：

```powershell
cd frontend
npm run dev        # http://127.0.0.1:5180 ，已配置 /api 代理到 8300
```

### 运行 50+20 题评测

```powershell
$env:SHZU_API = 'http://127.0.0.1:8300'
.\.venv\Scripts\python.exe -X utf8 evaluation\run_eval.py
# 报告输出到 evaluation/results/eval_report_*.csv
```

也可以在页面“50题自测”中一键运行并导出 CSV。

---

## 2. 工程结构

```text
shzu-service-agent/
  frontend/                       # Vue 3 + TypeScript + Vite + Pinia + Vue Router
    src/views/                    # Home / Chat / Services / Workflow / Source / Unavailable
    src/components/               # AnswerBlocks（要点块+引用角标）、EvidencePanel
    src/stores/                   # chat / workflow / source（Pinia）
    src/api/client.ts             # fetch + AbortController + 超时 + 统一错误（v1 契约类型）
    src/styles/swiss.css          # 瑞士风设计令牌（白底黑字/红强调/直角/网格）
  backend/
    app/api/v1.py                 # v1 契约：sessions/chat/services/evidence/workflows/export
    app/api/chat|tasks|sources|system.py   # 旧接口（挂 /legacy 供旧脚本兼容）
    app/agent/                    # deepseek_adapter（JSON 决策） + graph（LangGraph 五节点图）
    app/knowledge/                # loader / retriever(BM25+RRF) / intent / answer
    app/rules/                    # 三态规则引擎（pass/fail/unknown）
    app/documents/                # DOCX 模板填充与“填写依据”独立文件
    app/models/store.py           # SQLite（sessions+chat_turns 幂等、tasks、artifacts）
  data/
    reviewed/                     # 审定知识包（documents/clauses/facts/qa_topics）
    workflows/                    # 流程配置 flows.json、rules.json、aliases.json
  evaluation/                     # 50+20 题集与 v1 契约评测脚本
  prompts/                        # 路由/回答/规则解释/文书表达 Prompt（冻结 v1）
  deployment/                     # Dockerfile 与 compose 示例
  scripts/                        # 冒烟测试（smoke_v1.py 验证 v1 契约）
  docs/                           # 接口与数据对象说明
```

---

## 3. 核心接口（v1 契约，`/api/v1`）

| 接口 | 职责 |
|---|---|
| `POST /api/v1/sessions` / `GET /sessions/{id}/messages` / `DELETE /sessions/{id}` | 会话生命周期（24h 过期，410 语义） |
| `POST /api/v1/chat` | 对话轮：session_id + request_id 幂等（重复 ID 不同内容 409）；判别响应 answer/clarify/insufficient/out_of_scope/workflow |
| `GET /api/v1/services` | 服务目录（板块/关键词筛选） |
| `GET /api/v1/evidence/{id}` | 证据详情（含摘录、定位、生效期） |
| `GET /api/v1/workflows` / `GET /workflows/{id}` | 向导清单与详情（slots/steps/rules/materials） |
| `POST /api/v1/workflows/{id}/preview` | 校验字段并返回 preview_token（flow_version+kb_version+inputs 哈希） |
| `POST /api/v1/workflows/{id}/export` | 校验 token 后生成 DOCX；内容变更后导出返回 409 preview_stale |
| `GET /api/v1/health/live|ready` | 存活与就绪（含知识库版本与模型状态） |

对话响应示例（节选，v1 判别联合）：

```json
{
  "status": "answer",
  "session_id": "ses-...", "request_id": "req-...", "trace_id": "trace-...",
  "knowledge_version": "kb-2026-11-19-r4",
  "answer": {
    "blocks": [
      {"kind": "fact", "text": "国家励志奖学金金额：6000元/生·年（application_year:2025）", "citation_ids": ["xg-lz-c1"]},
      {"kind": "note", "text": "以下是审定资料中的对应要点（每条可点开官方原文）：", "citation_ids": []}
    ],
    "unknown_fields": []
  },
  "citations": [
    {"id": "xg-lz-c1", "title": "关于做好2025年本专科生国家励志奖学金、国家助学金评审工作的通知",
     "issuer": "石河子大学学生处", "locator": "网页正文·三、资助范围和标准",
     "url": "https://xgb.shzu.edu.cn/2025/1001/c1025a224593/page.htm"}
  ],
  "timing_ms": 76
}
```

> 旧 React 版接口保留在 `/legacy`（开发期兼容），正式交付以 v1 契约为准。

---

## 4. 知识工程口径

- 审定知识位于 `data/reviewed/*.json`：Document / Clause / Fact / qa_topics，字段对齐方案 6.3；
- 每条事实 `evidence_ids` 指向条款，条款指向文档；**URL、页码与文件名称由服务端来源表生成，模型不生成**；
- 关键数字（金额、天数、电话、地点、借阅数量）由结构化事实直接渲染；普通说明优先原文摘录；
- 时间条件文档（延长开馆、元旦/暑期安排）带明确适用期间，当前日期不适用时给出警示或“资料不足”；
- 未核实别名（如“小绿”）只提问不下结论；“补办卡”区分校园卡/银行卡/学生证；已核实别名含“信科院→信息科学与技术学院”（依据：官网新闻发布者署名）；
- 机构概况类问法（“介绍一下某某学院”）不按范围外硬拒：有审定主题则带引用回答（如信科院），无证据的学院返回“资料不足”说明缺口；
- 2025 励志奖学金流程为历史演示包；2026 年度缺口（通知正文、模板确认、学院收件截止日）明确列出。

评测口径见 `evaluation/questions.json` 的 meta：状态一致 + 关键词命中 + 应引出处命中 + 无禁止内容 + ≤5000ms。

## 5. 交付边界与待办（如实说明）

- **平台发布**：`/api/v1/platform/status` 显示当前为 `local-stub`。赛事账号确认后（方案 4.2 的 D0 项）：
  用平台 Workflow 承载路由/澄清/工具调用，本服务的 `/tools/*` 作为被调用工具；发布 Web/H5 链接与二维码。
- **PDF**：当前通过浏览器“打印 → 另存为 PDF”（真实用户操作）；生产可按方案用 LibreOffice 将同一 DOCX 转 PDF。
- **向量检索**：首轮使用 jieba 分词 + BM25 + RRF 融合结构（`retriever.py` 已预留向量候选接口）；
  bge-small-zh 向量模型在效果与时延本地测试后再冻结启用。
- **50 题标准答案**：当前题集为开发验收基线，正式提交前须由审核人交叉校对标准要点与允许的澄清问题。
- **数据示例**：演示使用虚构个人信息；正式使用时敏感字段可留空、下载后线下填写。

## 6. 验收对照（方案第 1.2 节矩阵）

| 编号 | 本轮实现状态 |
|---|---|
| R1 官方知识库与 RAG | ✅ 43 份来源 / 67 条款 / 106 事实；BM25+主题路由+范围过滤 |
| R2 答案附官方链接/摘录 | ✅ 事实卡 ↔ 出处侧栏/抽屉联动；服务端生成 URL 与定位 |
| R3 口语、错别字、多轮追问 | ✅ 别名表（生科院/一卡通）、歧义澄清（补办卡）、身份追问、年度缺口 |
| R4 请假、场地、评奖向导 | ✅ 三个 FlowSpec + 任务状态 + 自动保存 |
| R5 政策→条件→材料→生成 Workflow | ✅ 规则引擎三态 + 材料清单 + 时间线 + 版本化导出 |
| R6 标准化文档与导出 | ✅ DOCX（申请表/请假条含存根/办理清单）+ 独立“填写依据”；PDF 走打印 |
| R7 平台发布 | ⏳ 待赛事账号（D0） |
| R8 50 题 100% 一致、库外不编造 | ✅ v1 契约全量评测 70/70；边界案例覆盖范围外/缺口/过期/对象不符/夹带指令 |
| R9 ≤5 秒 | ✅ v1 契约下平均约 76ms，P95 约 75ms，最大值 <2s（冷启动） |
| R10 文档、视频、地址、测试报告 | ✅ 工程、测试报告与运行说明；视频与平台地址见团队交付 |

## 7. 开发与测试

```powershell
# v1 契约冒烟（会话/幂等/五态响应/预览导出）
.\.venv\Scripts\python.exe -X utf8 scripts\smoke_v1.py

# 旧版冒烟（知识库加载、路由、规则 /legacy）
.\.venv\Scripts\python.exe -X utf8 scripts\smoke_test.py

# 文档生成冒烟
.\.venv\Scripts\python.exe -X utf8 scripts\doc_smoke_test.py

# 全量评测（需先启动服务，v1 契约默认 8300）
.\.venv\Scripts\python.exe -X utf8 evaluation\run_eval.py
```

## 8. 团队分工占位（请按实际情况填写）

| 角色 | 姓名 | 负责 |
|---|---|---|
| 数据与测试 |  | 条款台账、题集校对、评测报告 |
| 平台与后端 |  | TeleAgent 编排、工具服务、发布链接 |
| 前端与交付 |  | 界面与移动端、录屏、提交包 |

---

*本项目为学生参赛作品；界面与文档中的“石大智多星”标识为原创“星点 + 书页”图形。*

> AI生成
