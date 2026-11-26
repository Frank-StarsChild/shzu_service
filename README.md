# 石大智多星：校园一站式服务智能体

**赛道一 · 揭榜命题五（“石大智多星”——校园一站式服务智能体）工程实现**

产品主张：**问得明白，查得到依据，带着材料去办事。**

本仓库是方案《石大智多星_Vue3_FastAPI_详细技术方案》的落地工程：
**Vue 3 + TypeScript + Pinia + Vue Router 前端**（瑞士国际主义风格，六路由多视图）、
**FastAPI 后端**（版本化 /api/v1 契约、DeepSeek + LangChain/LangGraph 对话图）。
本地模式使用 **DeepSeek、LangGraph 工具调用与发布校验**。命中已审定主题的首轮问题先查本地证据，
模型可直接引用或继续补查。依据与范围已明确的事实及部分已登记的歧义由服务端直接答复或追问。
等待超过 5 秒时，页面显示正在继续核查，
完成后自动展示结果。`POST /api/v1/chat` 的整轮故障兜底时限默认 60 秒，可用 `SHZU_CHAT_BUDGET_SECONDS` 配置。
达到该时限时，接口以 `turn_deadline` 标记结果，并附上已核验的引用（如有）。
首次提问的电动自行车校门通行规则可直接引用审定事实。询问当日图书馆闭馆时间时，
若库内时间通知均已过适用期，则直接说明资料缺口。能找到可能适用的时间通知时，继续按正常流程核查。
正常结果继续校验证据和向导适用性。配置赛事 Workflow 网关后，聊天通过可复用的 HTTP 连接转发给网关，并保存上游运行 ID。
本地模型连接失败时，如查询已预取并核对到直接依据，聊天仍展示这部分官方资料，并标记 `model_connection`。
前端提供问答与证据联动、办事向导（表单→规则核对→文书导出）、服务目录与证据详情。

- 知识版本 `kb-2026-11-20-r13`，含 1,637 份来源、24,830 条审定条款与 1,216 条结构化事实。运行时数据见 `/api/v1/health/ready` 和 `/api/v1/kb/info`。
- 五大办事板块：学工、教务、后勤、保卫、图书馆；学院概况经离线导入流水线接入（`scripts/import_college_intro.py`，从原始采集资料逐段对照入库）
- 三个向导：国家励志奖学金（2025 历史演示）、课程请假（生命科学学院模板）、教学场所借用
- 对话图经过 prepare → model ⇄ tools → publish。搜索工具以 BM25、主题匹配和 RRF 召回证据，按学院和年度控制适用范围。官网补查在工具执行时开始计时，模型请求超时后会在剩余时间内自动重试一次。
- 题集含 50 道核心题与 25 道边界题。2026-11-25 整改前复测通过 67/75，平均 2,877ms，P95 4,537ms，P99 5,307ms。原始结果见该次本地评测 CSV `evaluation/results/eval_report_20261125_101323.csv`。整改后成绩以真实模型或赛事 Workflow 的 CSV 为准。
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

### 运行 75 题评测

```powershell
$env:SHZU_API = 'http://127.0.0.1:8300'
.\.venv\Scripts\python.exe -X utf8 evaluation\run_eval.py
# 报告输出到 evaluation/results/eval_report_*.csv
```

评测通过命令行运行。脚本核对知识版本、为每题建立独立会话，并记录端到端时延、时限降级和 Workflow 运行 ID。

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
  evaluation/                     # 50 道核心题、25 道边界题与 v1 评测脚本
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
| `POST /api/v1/chat` | 对话轮按 session_id + request_id 识别。已完成的答复可重放，时限降级可用原 request_id 重试。平台模式返回 `workflow_run_id`。 |
| `GET /api/v1/platform/status` | 当前调度模式、网关配置状态及已填写的 H5 和二维码地址 |
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
  "knowledge_version": "kb-2026-11-20-r13",
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
  ]
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

评测口径见 `evaluation/questions.json`。B-04 对未核实别名接受有具体问题的 `clarify` 或明确说明资料缺口的 `insufficient`。时限降级和模型连接异常均单独统计，不计为通过。以完整应答的状态、关键词、引用、禁用内容与 5 秒时限共同判定结果。

## 5. 首页校园沙盘（夜景 v2）

首页「01 — 服务板块」上方是石河子大学中区的夜景沙盘（资产包 v2）：深色校园、亮灯的窗、
沿路光斑与冷色轮廓线，光柱/光圈/道路流光会持续流动，每隔数秒有一圈扫描波扫过。

- **它就是导航**：五栋楼对应五个板块。鼠标移到板块按钮上，镜头转向对应的楼，红色从楼底
  涌起并升起红色光柱；鼠标指到楼、点击楼，与点击对应板块按钮相同。
- **真实数据**：右下角显示当前楼的楼名、说明和该板块的服务数量（来自 `/api/v1/services`）。
- **开场动画**：本标签页第一次进入时播放 2.7 秒的「线框立起 → 楼一栋栋长出 → 光柱点亮」，
  镜头同时落到默认机位。用 `?intro=1` 强制重播，`?intro=0` 跳过。
- **回退**：`?3d=1` 强制开 3D，`?3d=0` 强制静态。默认按 WebGL2、视口宽度、显卡是否为软件
  渲染、设备内存、省流量模式、`prefers-reduced-motion` 和用户自己的开关决定。静态版显示同一
  机位的夜景海报、五个编号标记和四角信息条，五个入口照常可点；3D 加载失败时停在静态图并可重试。
- **数据署名**：校园示意模型，依据公开资料复原，非测绘成果；办事地点以学校官方通知为准。
  底图数据 © OpenStreetMap contributors。

前端验证：在 `frontend/` 下运行 `npm run verify`（构建 + 体积检查 + 单元测试 + 端到端测试）。
沙盘资源位于 `frontend/public/campus3d/`（`campus.glb`、`campus.meta.json` 与两张海报），
代码不得修改这些资产。

## 6. 交付边界与待办（如实说明）

- **平台发布**。应用需在赛事控制台完成 Workflow 配置与发布，后端 API 的调用契约以对应应用服务管理页为准。平台前端页面渠道提供访问链接与二维码。[中国电信发布渠道配置](https://www.teleai.com.cn/doc/o0o7Iu0RoFsKoKfUQkKx/zERT6CTMCNqNHtruruHE)
- **本项目的 Workflow 网关**。设置 `SHZU_PLATFORM_MODE=teleagent`、`SHZU_TELEAGENT_WORKFLOW_URL`（HTTPS）和 `SHZU_TELEAGENT_WORKFLOW_TOKEN`。网关接收 JSON `session_id`、`request_id`、`query`、`slots`、`history`、`timeout_ms`，返回 `{"run_id":"上游运行ID","result":{"final":{...},"slots":{...}}}`。`final` 使用 v1 会话响应结构。网关负责按赛事控制台的实际接口完成调度。后端将运行 ID 和答复一并写入会话历史。发布后可用 `SHZU_TELEAGENT_H5_URL`、`SHZU_TELEAGENT_QR_URL` 登记平台签发的链接。
- **容器配置**。在项目根目录使用 `docker compose --env-file .env -f deployment/docker-compose.yml up -d --build`，将本机配置传入容器。模型密钥和 Workflow 令牌均使用服务端环境变量。
- **文档导出**。已支持 DOCX，满足 Word 导出路径。浏览器也可将预览打印为 PDF。
- **向量检索**。按本地向量资产可用性启用，与 BM25 用 RRF 融合。服务启动先载入 BM25，再后台预热可选向量通道。
- **数据示例**：演示使用虚构个人信息；正式使用时敏感字段可留空、下载后线下填写。

## 7. 验收对照（方案第 1.2 节矩阵）

| 编号 | 本轮实现状态 |
|---|---|
| R1 官方知识库与 RAG | ✅ r13，1,637 来源 / 24,830 条款 / 1,216 条结构化事实 |
| R2 答案附官方链接/摘录 | ✅ 事实卡 ↔ 出处侧栏/抽屉联动；服务端生成 URL 与定位 |
| R3 口语、错别字、多轮追问 | ✅ 别名表（生科院/一卡通）、歧义澄清（补办卡）、身份追问、年度缺口 |
| R4 请假、场地、评奖向导 | ✅ 三个 FlowSpec + 任务状态 + 自动保存 |
| R5 政策→条件→材料→生成 Workflow | ✅ 规则引擎三态 + 材料清单 + 时间线 + 版本化导出 |
| R6 标准化文档与导出 | ✅ DOCX（申请表/请假条含存根/办理清单）+ 独立“填写依据”；PDF 走打印 |
| R7 平台发布 | 网关接入代码已实现，待赛事控制台实发并校验访问链接与二维码 |
| R8 核心题与边界验证 | 整改前 67/75。已将题集对齐 r13，整改后待真实模型全量复测 |
| R9 端到端 ≤5 秒 | 默认 4.2 秒调度时限，记录降级。生产 P99 待复测 |
| R10 文档、视频、地址、测试报告 | 工程和评测脚本可用。赛题提交材料按团队进度准备 |

## 8. 开发与测试

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

## 9. 团队分工占位（请按实际情况填写）

| 角色 | 姓名 | 负责 |
|---|---|---|
| 数据与测试 |  | 条款台账、题集校对、评测报告 |
| 平台与后端 |  | TeleAgent 编排、工具服务、发布链接 |
| 前端与交付 |  | 界面与移动端、录屏、提交包 |

---

*本项目为学生参赛作品；界面与文档中的“石大智多星”标识为原创“星点 + 书页”图形。*

> AI生成
