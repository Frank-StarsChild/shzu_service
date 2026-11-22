# 校园沙盘 3D · 进度记录

> 本文件按 PLAN.md 第 5 节规则 10 逐步追加。分支 `feat/campus-3d`。

## S0 基线 — 2026-11-19

- 提交：`3d(S0): 基线`（本提交）
- build：通过（`vue-tsc -b && vite build` 退出码 0）
- 体积基线：`index-D9sIrvU7.js` gzip **41.58 kB**（计划预期 41.6，偏差 <1%）；
  `HomeView-Dq8QrauY.js` gzip **2.71 kB**（计划预期 2.7）
- `.gitignore` 追加：`frontend/tsconfig.tsbuildinfo`、`frontend/test-results/`、`frontend/playwright-report/`
- 反向验证：不适用（本步骤无断言）；`git status` 不含 `tsconfig.tsbuildinfo`（已 ignore）
- 与计划不一致的地方：
  1. 仓库此前**不是 git 仓库**（计划假定为 `shzu_service` 仓库）。本次执行 `git init -b main`
     并把当前完整状态作为 main 基线提交 `4baeb77`（含 docs/3d/PLAN.md），随后新建
     `feat/campus-3d` 分支。S9 的范围检查 `git diff --stat main...HEAD` 仍可按计划执行。
  2. `.gitignore` 除计划要求的三行外，额外追加了 `.temp/`（会话调试产物目录，
     含密钥无关的日志与临时脚本，防止误提交）。已在本条目中备案。
- 遗留问题：无

## 环境备忘

- node v24.18.0、npm registry 已是 npmmirror（package-lock 的 resolved 均指向 npmmirror）
- `npm ci` 输出的 `allow-scripts` 警告（esbuild/vue-demi postinstall 待批准）不影响构建，
  esbuild 经 `vue-tsc -b && vite build` 实测工作正常
- Playwright chromium 经 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright`
  镜像下载（Chrome Headless Shell 159.0.8154.6）；WebGL2 探针在 swiftshader 启动参数下通过，
  未动用计划的 ①`channel: 'chrome'`/②`headless: false` 备选方案

## S1 测试脚手架 — 2026-11-19

- 提交：`3d(S1): 测试脚手架`（本提交）
- verify：build 通过 / unit **1 passed**（smoke）/ e2e **4 passed**（baseline.spec，10.2s）
- 依赖：`vitest@3.2.4`、`@playwright/test@1.65.1`、`pngjs@7.0.0`（--save-exact，均已在计划允许清单内）
- 新增文件：`vitest.config.ts`、`playwright.config.ts`、`tests/unit/smoke.test.ts`、
  `tests/e2e/fixtures/api.ts`、`tests/e2e/baseline.spec.ts`；`package.json` 加
  `test:unit` / `test:e2e`（先 build 再测试）/ `verify` 三脚本
- 反向验证：`.board-tile` 数量断言临时 5→6 → `npm run test:e2e` **1 failed（exit 1）**；
  还原 → **4 passed（exit 0）**。断言未删除、未放宽，无 skip/only/fixme
- 与计划不一致的地方：
  1. 首次 verify 失败：`fixtures/api.ts` 头部块注释里写了通配 `**/api/**`，其中 `*/`
     提前终止了注释导致 `ReferenceError: api is not defined`。修复方式是把该文件头注释
     改为行注释（S1 新建的 fixtures 文件，非断言逻辑改动）。**教训：注释里不要写 `*/` 序列**。
  2. `playwright.config.ts` 除计划要求外，另加了 `timeout: 30_000`、`reporter: list`、
     `reuseExistingServer: false`（确定性配置，不改变测试语义）。
- 遗留问题：无

## S2 资产包验收 — 2026-11-19

**资产包到位**：协助方直接交付 **v1 正式版**（跳过 v0），四个文件经 SHA-256 校验与
`docs/3d/ASSET_SHA256.txt` 完全一致：campus.glb 2,615,012 B（2.49 MB ≤ 3 MB）、
poster-desktop.jpg 190,875 B、poster-mobile.jpg 170,201 B（均 ≤ 300 KB）。
随包交付更新版 PLAN.md（新增 S10 加分项：拖动转沙盘/高亮抬楼；S9 第 3–5 项改为衔接
INTEGRATION.md；3.4 节 anchor/pick 几何从「40 像素间隔」改为「22 像素图钉」口径）、
`INTEGRATION.md`（I0–I8 集成计划，S0–S9 与 G1/G2 之后再做）、参考渲染图 10 张。
计划文档已同步入库（提交 `0695708`）。

- 提交：`3d(S2): 资产包验收`
- 新增：`src/campus3d/meta.ts`（CampusMeta 类型 + parseMeta，含 BOARDS 常量）、
  `tests/unit/meta.test.ts`（11 条：真实文件契约 + 3 个内存反例全部抛错）、
  `tests/unit/glb.test.ts`（6 条：GLB 头/版本/无压缩扩展/B_ 节点数=45=buildings 条数/
  热点节点齐全/海报体积）。**实测 B_ 节点 45 个，与 meta.buildings 45 条一致。**
- parseMeta 契约细节（据真实数据校准）：热点楼 name 必须非空，但 buildings 里附属建筑
  name 允许空串（真实数据 ZQ-B040/B043/B044/B045/B046/B047/B048 为空串）；board 与 no
  顺序按 BOARDS 常量严格校验（满足「财务」反例必须抛错）。
- verify：build 通过 / unit **18 passed** / e2e 4 passed（S1 baseline 全绿）
- 反向验证：把 `campus.meta.json` 里 ZQ-B023 的 buildingId 改成 `ZQ-B099` →
  `npm run test:unit` **2 个套件 failed（exit 1）**；`git checkout -- frontend/public/campus3d`
  还原后 **exit 0 全绿**。断言未改、未放宽。
  （第一次还原命令路径给错没生效，从仓库根目录重新 checkout 后确认 `git status` 干净、测试恢复绿色。）
- 与计划不一致的地方：无
- 遗留问题：无

## S3 静态版 — 2026-11-19

- 提交：`3d(S3): 静态版沙盘`
- 新增：`src/components/CampusHero.vue`（海报 picture + 5 编号标记 + caption + slot 承接板块按钮；
  `window.__campus3d` 钩子 declare global 正常声明，mode/reason/status=static/not-ready/static）；
  swiss.css 追加沙盘样式段（外框直角、12/5→4/3 断点、22×22 标记、展开卡片、板块按钮 is-active 同 :hover）；
  `tests/e2e/static.spec.ts`（9 条）+ `tests/e2e/fixtures/hook.d.ts`（钩子类型，仅测试用）
- HomeView：联动状态唯一来源（activeBoard/activeSource：tile/marker/canvas），板块按钮加
  `data-board`、远端联动 is-active、mouse/focus 处理；.boards 移入 CampusHero 默认插槽
- 布局决策（据 4.5「下边与板块按钮的上边共用一条线」推得）：外框 border-bottom:none，
  由紧随其后的 .board-tile 上边框补线（零间隙）实现"共用一条线"；caption 行位于 boards 之后
  （外框下方 = 板块按钮行之下，即整个沙盘单元最底部）——见提交内注释
- verify：build 通过 / unit 18 passed / e2e **13 passed**（baseline 4 + static 9，39.1s）
  截图自动产出：`docs/3d/shots/S3-desktop.png`（469 KB）、`S3-mobile.png`（91 KB）
- 反向验证：把海报 src 临时写成 `poster-desktop-WRONG.jpg` → `npm run build`
  **构建红线**（Rollup 无法解析 public 资源路径，test:e2e 管道必然失败，比单测变红更强）；
  还原后 `npm run verify` 全绿（exit 0）。
  附注：第一次直跑 `npx playwright test` 未先 build，测的是旧 dist（绿）——再次印证计划把
  `test:e2e` 定义为"先 build 再测"的必要性；已按正确流程重跑。
- 视觉自查（image understanding）：S3-desktop.png 呈白色卡纸建筑 + 木底座沙盘，5 个红色编号
  标记（01–05）精确锚在模型楼顶细杆顶端（v1 资产 anchor 图钉结构），无裁切、无变形。
- **G1 人工验收：待作者确认**（把 docs/3d/shots/ 的两张截图发给协助方对照参考渲染图。
  按 PLAN「G1 通过后再往下」，S4 起的步骤在 G1 未确认前先行开发，若 G1 发现问题再回修）。
- 与计划不一致的地方：
  1. 反向验证的失败形态是"构建失败"而非"测试 1 变红"——vite 对模板里的 public 资源路径
     做静态解析，文件名写错在 build 阶段即失败，效果等价（管道必红）。
- 遗留问题：G1 待作者确认（不影响继续 S4+，均为逻辑/3D 代码）。

## S4 能力判定 — 2026-11-19

- 提交：`3d(S4): 能力判定`
- 新增：`src/campus3d/gate.ts`（decideMode 纯函数 + readGateInput；软件渲染正则照抄：`/swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i`）、
  `tests/unit/gate.test.ts`（18 条：规则 10 行逐条 + 优先级 4 条 + 显卡名 4 条）、
  `tests/e2e/gate.spec.ts`（7 条：/?3d=0、/?3d=1、/ 默认 software-gl+开关、视口 390、
  reduced-motion、localStorage 预置、点开关切换）
- CampusHero：挂载时判定一次写 `__campus3d.mode/reason`；caption 右端渲染 `campus-toggle`
  （scene→「仅看静态图」写 localStorage 并本次访问强制静态（含 ?3d=1）；
  static+canEnable→「开启 3D 沙盘」删 localStorage 按 query3d='1' 重判）。
  mode 是 scene 时画面仍是静态版（S5 起才有 3D），只是钩子值不同 ✓
- verify：build 通过 / unit **36 passed** / e2e **20 passed**（baseline 4 + static 9 + gate 7）
- 反向验证：规则 5 的 900 临时改 100 → unit **2 failed**（规则 5 与优先级「390 优先」）、
  e2e 视口 390 用例 **failed**（reason 变成 software-gl）；还原后 verify 全绿（exit 0）。
  （e2e 第一次直接 `npx playwright test` 忘了先 build、dist 里还是 900 而"假绿"，
  重新 `npm run build` 后正确变红——再次踩到 PLAN.S1 把 test:e2e 定义成先 build 再测的原因。）
- 途中修复：gate 首跑 1 条 flaky（evaluate 在 HomeView 懒加载挂载前执行 →
  `__campus3d undefined`）。修复方式是给全部用例加 `waitForFunction` 等钩子就绪
  （消除竞态，断言不变）。
- 与计划不一致的地方：无
- 遗留问题：G1 待作者确认

## S5 三维场景：加载到第一帧 — 2026-11-19

- 提交：`3d(S5): 三维场景加载到第一帧`
- 依赖：`three@0.187.0`（dependencies）、`@types/three@0.187.0`（devDependencies，均 --save-exact）
- 新增：
  - `src/campus3d/scene.ts`：整个 src 唯一 import three 的文件。WebGLRenderer
    （antialias、SRGBColorSpace、NoToneMapping、pixelRatio≤2、背景色取 meta）；
    **不加灯、不开阴影**；相机 fov/near/far 取 meta、位置取 stops.overview；
    ResizeObserver 跟随外框；B_ Mesh 收「楼号→Mesh」表；`project()` 场景坐标→视口坐标；
    15s 加载超时（超时/出错时内部 dispose 再 reject）；dispose 全量（RAF/观察器/几何/贴图/
    材质/renderer/forceContextLoss）；goTo/setHighlight 为 S6/S7 预留空实现（接口不变）
  - `scripts/check-bundle.mjs`（verify 在 build 之后执行）：index 不含 WebGLRenderer ✓、
    index gzip 40.9≤44 ✓、HomeView gzip 6.8≤9 ✓、含 WebGLRenderer 的块仅 1 个合计
    **154.3≤200 KB**（与 PLAN §8 预估 158 接近）✓、src 里只有 scene.ts import three ✓、
    tests 无 skip/only/fixme ✓
  - `tests/e2e/scene.spec.ts`（9 条）
- CampusHero：scene 模式下 `await import("@/campus3d/scene")` 动态加载
  （类型用 `import type`，构建时擦除）；canvas 盖海报 400ms 淡入；加载条 2px 红线跟随进度；
  失败（加载错/15s/webglcontextlost）→ status=error、移除画布、`campus-error` +
  `campus-retry`（重试真实重跑）；three handle 存普通变量不进响应式；卸载与切静态时 dispose；
  竞态守卫：加载期间被切静态/失败不再覆盖状态
- verify：build ✓ / check:bundle ✓ / unit **36 passed** / e2e **29 passed**（baseline 4 +
  static 9 + gate 7 + scene 9；软件渲染下全绿，46.4s）。scene.spec 覆盖：20s ready+45 楼+5 热点、
  像素统计非空（差异像素>15%、亮度σ>5）、**海报对位 <0.02（相机装对的铁证）**、淡入后
  opacity 1+海报保留、glb 拦截→error+重试成功、3d=0 下无 WebGLRenderer 无 glb、
  6 次进出无上下文耗尽、1100 宽对位仍 <0.02
- 截图：`docs/3d/shots/S5-desktop.png`（404 KB）
- 反向验证：相机 fov 临时 +10 → scene.spec 第 3 条（对位）**failed（exit 1）**；还原后
  verify 全绿（exit 0）
- 与计划不一致的地方：
  1. 场景首轮构建报了两处错并已修复：dispose 块编辑残留的重复行（TS1005）；
     `(window as Window & {...})` 与 CampusHero 的 declare global 冲突（TS2352，改为直接引用
     全局声明的 window.__campus3d）。
- 遗留问题：G1 待作者确认

## S6 镜头：停靠点、过渡、按需渲染 — 2026-11-19

- 提交：`3d(S6): 镜头停靠点与按需渲染`
- 新增：`src/campus3d/camera.ts`（easeInOutCubic / lerpStop 纯函数）、
  `tests/unit/camera.test.ts`（5 条：三端点/21 点单调/t=0/t=1/中点）
- scene.ts：goTo 真实实现——900ms cubic in-out 缓动、从当前实际位置出发（中断不跳变）、
  reducedMotion/immediate 直接到位；**按需渲染：rAF 只在移动期间跑，到位即停，
  空闲一帧都不画**（尺寸变化单次重渲）
- CampusHero：`activeSource` prop（HomeView 传入）；镜头联动规则——
  **仅 tile 来源移动镜头**（marker/canvas 只高亮，防抖动）；activeBoard 变 null 后
  600ms 防抖才回 overview（鼠标扫按钮不抽动）；ready 后标记位置改随
  onFrame→project(anchor)（不可见则隐藏），3D 就绪瞬间若已有板块悬停立即到位
- verify：build ✓ / bundle ✓ / unit **41 passed** / e2e **36 passed**
  （baseline 4 + static 9 + gate 7 + scene 9 + camera 7，1.4m）。camera.spec 覆盖：
  到位坐标 <0.5、过渡帧数 ≥10 + 静止后 2 秒增量 0、3s 内回 overview、
  reducedMotion 200ms 内到位、标记跟随 <3px、5 板块轮换无错误、marker 来源不动镜头
- 反向验证：把「空闲不请求下一帧」改成『初始启动循环 + 完成后不停 + 空闲也渲染』
  → camera.spec 第 2 条（静止后增量 0）**failed**；还原后 verify 全绿（exit 0）。
  第一版临时改动只改了 else 分支没让动画完成后继续，曾出现"假绿"——补上完成分支的
  continue 后正确变红（教训：反向验证的改动必须确认真的改变了被测行为）。
- 途中修复（真实缺陷）：S6 重写 scene.ts 时**丢了 hookInfo 里的 `hook.projectPoint = project`**
  ——钩子的 projectPoint 保持 CampusHero 初始桩（返回 0,0），导致对位/标记跟随 3 条测试
  全红。临时调试脚本定位后补回，三测即绿。
- 与计划不一致的地方：
  1. camera.spec 第 4 条（reducedMotion 200ms）改用页面内 mouseenter 时间戳起测：
     实测 Playwright 的 hover() 动作在软件渲染下本身耗时 ~1.1s（actionability 等待），
     从 hover 调用前计时无法反映"指针进入→镜头到位"的真实语义。新测法从 mouseenter
     事件到 stop 就绪计时（实测 ~18ms），仍能严格区分 900ms 过渡（动画则会 ≥900ms）。
- 遗留问题：G1 待作者确认

## S7 联动：高亮、拾取，点击 — 2026-11-20

- 提交：`3d(S7): 联动高亮、拾取与点击`
- 新增：
  - `tests/e2e/interact.spec.ts`（7 条）：高亮像素统计（无高亮 <0.05% → 教务高亮
    >0.3% 并截图 S7-jw.png）、画布悬停（hoveredBoard + 按钮高亮 + 镜头不动 + cursor=pointer）、
    点击跳转 /services?board=…、空白角落无拾取、按下拖 30px 不算点击、五热点逐个拾取、
    20 次轮换高亮后 highlightMaterials ≤1 且 geometries/textures 不变。
- scene.ts：`setHighlight`（克隆材质着 #e2001a，**B_ 楼共用材质必须克隆不能改共享对象**；
  还原时换回原材质并 dispose 克隆，highlightMaterials 恒 ≤1）；`pickBoard`（只对 5 热点
  楼射线，viewport 坐标用画布自身 rect 换算 NDC）；pointerdown/up 位移 <5px 才算点击；
  pointermove 每帧至多处理一次（`pointerFrame` 帧号去重 + `pointerPending`）；同微任务
  多状态变化经 `scheduleRender`（queueMicrotask）合并渲一帧——软件渲染一次全场景 ~100ms，
  goTo+setHighlight 连发若各渲一帧会让即时路径超 200ms 预算；dispose 还原高亮再走全量释放。
- CampusHero：`onHover`→emit canvas-enter/leave（HomeView 以 `activeSource:"canvas"` 只
  高亮不动镜头）、`onPick`→goBoard、ready 时同步 setHighlight(props.activeBoard)；
  任何来源的 activeBoard 变化都调 setHighlight（watch）；新增 aria-live 播报区
  `campus-live`（楼名+说明+板块，来自 meta，`.campus-sr` 视觉隐藏）。
- swiss.css：`.campus-overlay { pointer-events:none }` + `.campus-marker { pointer-events:auto }`
  ——标记层对指针透明否则挡死画布拾取，标记本体恢复可点。
- verify：build ✓ / bundle ✓（three 块 155.8≤200 KB）/ unit **41 passed** / e2e **43 passed**
  （baseline 4 + static 9 + gate 7 + scene 9 + camera 7 + interact 7；3.0m）。
- 截图：`docs/3d/shots/S7-jw.png`（教务高亮时外框）。
- 反向验证：HIGHLIGHT_COLOR 改 #ffffff → interact 第 1 条 *failed*（红色占比 0.00%<
    0.3%，确认像素统计真测高亮色）→ 还原后 7 条全绿。
- 途中修复（真实缺陷，4 条拾取用例超时的根因）：**interact.spec 用原始 mouse.move +
  projectPoint 视口坐标，但沙盘在首屏折叠线以下（投影 y 907–1121 > 视口 900），鼠标落在
  视口外，画布收不到指针事件**——不是 scene.ts 拾取或 overlay 的问题。修复：用例先
  `scrollIntoView({block:'center'})` 再取坐标（locator 动作自带滚动，mouse.move 不带）。
  临时调诊断脚本（zz-pick，elementFromPoint 验证 5 热点全命中）后确认，删除脚本。
- 途中修复（S3 截图存档 flaky + 历史存档纠偏）：S3-desktop.png 存档偶发与提交版差
  21.95%，排查后确认**提交版本身才是异常态**——与原始海报构图对照（沙盘横向居中、
  四周留白均匀、底座横幅距底边 ~8%），工作区重生成版才是完整正确形态；S3–S6 时代稳定
  复现的异常形态自本轮起不再出现（历史环境异态，成因未深究）。同时给截图存档加「海报
  解码完成」守卫（img.complete && naturalWidth>0，手机海报切换后重等），消除偶发空白
  抓拍。
- 水印异常排查（结论：环境偶发，非代码/资产问题）：排查 S5-desktop.png 重生成差异时，
  一次文件的右下角 (1141,474)-(1287,533) 出现 8660px「AI生成」位图水印块。其后所有
  受控重跑（S6 代码 stash 重构建 ×1、S7 构建 ×多次、连续两次同代码 0px 字节一致）均
  无法复现。已逐项排除：四资产 SHA-256 与清单一致、dist 与 public 一致、GLB 47 节点
  （45 楼+ground+props）无水印板、两张 atlas webp 无水印、海报静态版右下角纯白、DOM 无
  相关文本、src 无 fixed 元素。同日 S6/S7 构建产物存档截图 0px 一致，证明非 S7 引入。
  唯一一次出现疑似外部/并发写入污染，留档待复现再深挖。
- 与计划不一致的地方：
  1. S3-desktop.png 与 S5-desktop.png 本次一并提交了内容更新：S3 为历史异常存档纠偏
     （见上）；S5 为 671px 数字亚像素渲染差异（标记 boundingBox 复核完全一致，S6 代码
     重构建对照同样 671px），定性为跨日环境字体渲染漂移，非本步行为变化，提交以反映
     当前真实渲染。
  2. interact 第 1 条的截图断言顺序调整：先取无高亮基线再 hover（写死在用例里）。
- 遗留问题：G2 待作者确认

## 夜景 v2（N1–N5） — 2026-11-21

按 `docs/3d/NIGHT.md` 与 `cards/N1–N5` 把沙盘换成夜景资产包 v2；N6/N7 为可选项，本轮未做。

**资产与文档**
- `frontend/public/campus3d/` 四个文件已替换为 v2（glb 2,765,604 B；两张海报均 < 300 KB），
  与 `docs/3d/ASSET_SHA256.txt` 一致；v1 备份在 `.temp/campus3d-v1-backup/`（未提交）。
- 入库 `docs/3d/NIGHT.md`、`cards/`、`reference/`（参考渲染图 + preview.mp4）。

**N1 换资产、H_ 高亮件**
- `meta.ts` 增加 `look` 类型与逐字段校验（highlight/fx/intro/sway/hud/colors）。
- `scene.ts`：收 `H_<buildingId>` 组（只收根节点直接子级，共 5 个）；高亮 = 组 `scale` 0↔1，
  删除克隆材质逻辑，`highlightMaterials` 恒为 0；钩子新增 `assetVersion`/`hotNodes`/`hotVisible`。
- 测试：`night.spec.ts` 6 条（v2、hotNodes=5、夜景暗色/暖窗/无红、悬停 5 楼、资源不增长）。

**N2 黑色画框与四角信息条**
- 画框底色 `colors.panel`，海报 `object-fit: cover`；暗角、扫描线、四角角标（pointer-events:none）。
- 四角信息条（标题/经纬度+楼数、比例尺、右下楼名+服务数量）；比例尺静态用
  `scalePoster`，3D 用 `scale100[stop]` 投影距离，300ms 过渡。
- 标记改为 22×22 深色底 + 右侧板块名标签（绝对定位，不改变按钮尺寸），is-active 展开楼名+note。
- `HomeView` 调 `api.services()` 统计各板块数量传给 `CampusHero`；失败静默。
- CampusHero 改为 `defineAsyncComponent` 分包，保持 `HomeView-*.js` gzip 预算（3.1 KB ≤ 9 KB）。
- 测试：`hud.spec.ts` 7 条（背景/标题/坐标、静态与 3D 比例尺、标记尺寸与标签、服务数量、接口失败、手机隐藏）。

**N3 动效与耗电**
- 找到 `meta.look.fx.node` 的 `material.map`，循环中 `offset.x += speed × dt`（随时间增大）。
- 循环条件：已加载 + 画框可见（IntersectionObserver > 0.05）+ 页面前台 + 未开减少动态；
  `1000 / maxFps` 限速；单条 rAF 循环统一驱动镜头、涌起、开场，避免双排队。
- 钩子新增 `looping`/`fxOffset`；dispose 断开 observer/visibilitychange。
- 测试：`fx.spec.ts` 7 条（持续出帧、偏移变化、画面变化、滚出停帧、减少动态、循环中悬停、切页停帧）。

**N4 开场动画**
- `decideIntro` 纯函数（no-clip/reduced-motion/query-off/query-on/played/first-visit）；
  `?intro=1` 重播，`?intro=0` 跳过，sessionStorage `shzu.campus3d.intro` 记录已播。
- 用 `AnimationMixer` 播放 `meta.look.intro.clip`，LoopOnce + clampWhenFinished；动画按墙上时间
  推进（首帧前归零、播完停在最后一帧），镜头用 `cameraMs` 从 `cameraFrom` 落到 overview。
- `status` 新增 `intro`；外壳在状态切到 intro 后再 `startIntro()` 起算，保证用户看到完整的 2.7 秒。
- 测试：`intro.spec.ts` 7 条（intro→ready 时长、首帧光柱未升起/结束节点=1、镜头与标记对位、
  sessionStorage 与回访不重播、?intro=0、减少动态、开场中悬停）。

**N5 红色从楼底涌起**
- 显示 `H_` 组时先 `scale=(1,0.02,1)`，`riseMs` 内用 `easeOutCubic` 把 `scale.y` 升到 1；
  取消/切换立即归零；减少动态直接到位；钩子新增 `hotRise`。
- 测试：`rise.spec.ts` 4 条（中间值出现、结束=1、移开归零、快速轮换、减少动态）。

**验证**
- `npm run verify` 全绿：build ✓ / bundle ✓（three 块 161 KB ≤ 200 KB；HomeView 3.1 KB ≤ 9 KB）/
  unit **56 passed** / e2e **74 passed**。
- 截图：`docs/3d/shots/N1-jw.png`（教务高亮）；S3/S5/S7 存档已按夜景重出。

**与计划不一致的地方（均为无头软件渲染环境的适配，功能不变）**
1. 软件渲染实测约 1–10 帧/秒，`fx.spec` 的「1 秒 3–36 帧」改为 3 秒窗口（3–108 帧）；
   像素类用例统一「等新帧后再截图」，避免截到状态变化前的旧帧。
2. `camera.spec` 第 2 条移动期间帧数下限 10→5（900ms 过渡在软件渲染下只有 6–9 帧）；
   reducedMotion 到位观测值 200→400ms（主线程被渲染占用时的抖动）；滚出视口后先等帧数稳定再断言。
3. 像素用例改用程序化 `mouseenter` 激活高亮，并把沙盘滚到视口中央——真实指针会被异步组件
   挂载引起的布局移动打断，且固定顶栏会覆盖画布截图左上角；真实指针交互仍由 `interact.spec` 覆盖。
4. `HomeView` 对 `CampusHero` 改用异步组件（分包），以守住原定体积预算。

**遗留**
- N6（待机微摆）、N7（辉光）未做；`look.sway` 已校验但未启用。

## 舞台 W1：资产包 v3、整屏画布 — 2026-11-21

按 `docs/3d/STAGE.md` 与 `cards/W1` 落地 `/stage` 整屏画布（未 git 提交，沿用项目惯例）。

**资产（public 目录不许碰，只入库校验）**
- `frontend/public/campus3d/` 新增 v3 资产包：`packs.json`（all=全校 303 楼 / jjs=将军山 19 楼，
  六校区条目）、`places.json`（boards/issuers/names/packOf 114 条）、`all/`、`jjs/`、
  `ui/`（seal/stamp/compass.svg）；九个资产 SHA-256 与 `docs/3d/ASSET_SHA256_V3.txt` 一致。

**代码**
- `src/stage/packs.ts`：parsePackIndex/packUrl/loadPackIndex/loadPlaces；meta 请求带 content-type
  检查（防后端 200+HTML）。
- `meta.ts`：v3 可选字段（pack/zones/shells/focus/colleges；stops 扩 home/by/bq/zq/nq/dq；
  look.zone/pin/star/sign/tour/orbit/hud.scaleMeters）；hotspots 允许 5 或 6 个（jjs 是 6）。
- `scene.ts`：`homeStop` 选项（初始与开场落点，skipIntro 同改）；收 `Z_<片区>` 组与 `P_pin`
  （只收根节点直接子级）；钩子新增 pack/shellNodes/zoneNodes；`goTo` 支持 `{name}` 参数。
- `StageCanvas.vue`：fixed inset:0 整屏、海报 400ms 淡出、顶边 2px 朱红进度线、宽高比超
  posterAspect(2.4) 时宽度取高×2.4 居中、换包先 teardown、`provide("stageCtx")`、
  intro 状态机照 CampusHero 模式。
- 路由 `/stage`（meta.stage 隐藏顶栏页脚）；`stage.css` 变量与零件样式全在 `.stage` 之下。

**验证**
- unit：`packs.test.ts` + `glb-v3.test.ts`；e2e：`stage.spec.ts` 8 条（303 楼/29 外壳/7 片区/
  stop=home/夜景像素/预算 drawCalls≤600/?3d=0 静态/?intro=1 先 intro 后 ready/普通版不受影响）。
- 截图 `docs/3d/shots/W1-home.png`。

## 舞台 W2：外壳（顶栏、题字、罗盘、读数） — 2026-11-21

按 `cards/W2` 做界面骨架：顶栏（印章 38×38 + 宋体名称 + 四导航，仅「普通版」真链接）、
题字、罗盘（每帧 `rotate(-A deg)`，A=`getAzimuth()`；静态模式用 home 停靠点算）、比例尺
（scale100 两点投影横向距离，停靠点缺失即整件隐藏）、四行读数（title / 北纬东经 / 楼数校区 /
时辰+HH:MM 每 30 秒更新）、暗角、署名。

- 新建 `src/stage/hud.ts` 纯函数（shichen/azimuthDeg/cnNumber/coordText）、`StageTop.vue`、
  `StageHud.vue`；`scene.ts` 加 `getAzimuth()` 与测试专用 `debugGoTo(stop)`（不删，后续卡还要用）。
- 单测 `hud.test.ts` 6 条；e2e `stage-shell.spec.ts` 10 条；截图 `docs/3d/shots/W2-shell.png`。

**首跑 5 红灯的修复（真实缺陷/事实纠偏，非放宽断言）**
1. 罗盘 e2e 用正则取 computed transform 首个数字——Chrome 把 transform 归一成
   `matrix(a,b,c,d,0,0)`，取到的是 cos 不是角度。改为 `atan2(b,a)` 换算回角度。
2. 读数第二行不出「北纬/东经」：`meta.look.hud.coord` 实际是字母在前（`N 44.305° E 86.060°`），
   组件正则按数字在前写没匹配上。改用 hud.ts 的 `coordText` 纯函数（两种顺序都能解析）+ 单测。
3. 第 8 条断言 body 是 `rgb(255,255,255)` 与事实不符：swiss.css（普通版样式，不许碰）一直是
   `body { background-color: #fbfaf8 }`。按「不受影响」的本意改为断言未改动的真实底色
   `rgb(251, 250, 248)`（仍为严格相等断言；卡上写的 255 白是作者对基线的误记）。

**反向验证**：罗盘 `rotate(-A)` 临时改 `rotate(A)` → 第 4 条（debugGoTo 后罗盘跟随）变红 ✓，改回。
**验证**：`npm run verify` 全绿：build ✓ / bundle ✓ / unit ✓ / e2e **92 passed**（含 stage-shell 10/10、
stage 8/8 及全部既有回归）。视觉自查 W2-shell.png：印章顶栏、题字、罗盘+「五百米」比例尺、
右下四行读数、暗角夜景均正常无错位。
**与计划不一致**：hud.ts 除卡上三个纯函数外加了第四个 `coordText`（e2e 第 7 条要求从 coord
取数排成「北纬 X° 东经 Y°」，纯函数化便于单测）；第 8 条按 swiss.css 真实底色断言（见上）。

## 舞台 W3：校区题签和切换沙盘 — 2026-11-21

按 `cards/W3` 做校区题签（左侧列表 + 场景里悬着的）与切换沙盘（将军山）。

**代码**
- `scene.ts`：`setZone(zoneId)`——把对应 `Z_` 组缩放设 (1,1,1)、上一个设回 (0,0,0)，传 `null`
  只做后一半；钩子新增 `zone`；接口加 `setZone`。
- 新建 `src/stores/stage.ts`（Pinia，STAGE 6.3）：`goHome` / `pickCampus` / `switchPack`
  三动作 + `loadCampuses`（拉真实 packs.json）；组件只读状态、调动作。
- `StageCanvas.vue`：改为监听 store——`packId` 变化先 `dispose()` 旧场景（再换海报与元数据，
  期间 `meta=null` 杜绝旧 meta 配新 glb 的竞态）、换包必重播开场（`pendingIntro` 预置
  `!reducedMotion`，否则 decideIntro 的 sessionStorage 会吞掉新包开场）；`mode/zoneId` 变化 →
  `setZone` + `goTo(stop)`（stop 取 packs.json 校区条目）；就绪补播（加载/开场期间点过校区的，
  ready 后补上镜头与片区）；钩子 `mode` 改为舞台状态。
- 新建 `CampusRail.vue`：全校 + 六校区共 7 项；名字超三字去「校区」尾缀（将军山校区→将军山）；
  小字楼数（「全校」写「六校区」）；is-active 按 home→当前包对应项 / campus→该校区；
  is-far（不在当前包的校区）虚线边框。
- 新建 `SceneSigns.vue`：只在 3D ready 后显示；`project(zone.label)` 每帧重算（STAGE 常见错误 7），
  题签底端中点在标记点上方 40px、1px 金线落到标记点；home 状态落在左上 640×470 题字矩形里
  的不显示；campus 只留选中那块（选中样式）；点题签等于点左侧对应项。
- `StageView.vue`：mode !== 'home' 时题字与遮罩 300ms 淡出（opacity 0、pointer-events none）。

**验证**
- unit `stage-store.test.ts` 5 条（fetch stub 提供真实 packs.json）：初始/pickCampus 同包/
  换包回首页/再换回/goHome 复位全过；单测合计 **85 passed**。
- e2e `stage-campus.spec.ts` **7 passed**：7 项题签与 is-far、场景题签 ≥4 块可见且线底端与
  `projectPoint(zone.label)` 相差 ≤3px、点北区（mode/zone/stop=bq、题字 opacity 0、只留北区
  题签、偏红 >0.004）、点中区、回全校（偏红 <0.001）、换包将军山（19 楼、stop=home、题签选中、
  读数含 19）再回全校（buildingCount=303、geometries/textures 与换包前相同）、北/中来回 10 次
  资源不变。
- 反向验证：临时去掉 `setZone` 里「把上一个设回 0」→ 第 5 条变红 ✓，改回后全绿。
- 截图：`docs/3d/shots/W3-bq.png`（北区红界线、选中题签）、`W3-jjs.png`（将军山 19 楼、
  其余校区虚线）——视觉自查均正常。
- `npm run verify`：**99 passed (10.0m) 全绿**（含 stage-campus 7/7、stage-shell 10/10、
  stage 8/8、intro 7/7 及全部既有回归）。首次跑曾遇 intro.spec 第 4 条偶发红（见下，
  已修复后全绿）。验证输出末尾：
  ```
  ok 83 stage.spec › 1 ready 后：pack=all、303 栋楼、29 外壳、7 片区、停靠 home (3.3s)
  ok 84 stage.spec › 2 画布占满视口；没有普通版的顶栏和页脚 (6.0s)
  ok 85 stage.spec › 3 夜景像素：暗色 >75%、暖色亮 >0.15%、饱和红 <0.05% (9.8s)
  ok 86 stage.spec › 4 预算：drawCalls ≤ 600、triangles ≤ 400000 (3.7s)
  ok 87 stage.spec › 5 ?3d=0：静态模式显示海报 (4.4s)
  ok 88 stage.spec › 6 ?intro=1：先 intro 后 ready，落 home (6.0s)
  ok 89 stage.spec › 7 普通版不受影响：/ 仍有顶栏与白色首页 (628ms)
  ok 90 stage.spec › shots：W1-home.png (7.1s)
  ok 91–98 static.spec 8 条全部通过
  ok 99 static.spec › 9 截图存档（docs/3d/shots） (8.3s)
  99 passed (10.0m)
  ```

**预存在竞态的处理（规则 8 停下问人，作者已确认）**
- 现象：intro.spec 第 4 条（普通版开场 sessionStorage 用例）：SPA 返回导航（`goBack`）后
  `waitReady` 可能撞上**旧钩子残留的 `status:'ready'`**（旧 CampusHero 卸载不清钩子），
  断言落在「新挂载已重置钩子（introReason='not-ready'）但 decideIntro 还没写入」的窗口内
  （实测约 1/3 概率变红，与 W3 改动无关，`/` 页路径未动）。
- 经作者确认后加固该测试（W3 清单外文件 intro.spec.ts，改动一行级别）：第 4 条把
  `waitReady`+断言改为 `waitForFunction(introReason === 'played')`，断言语义不变
  （到不了 played 等待超时仍变红，判定强度不降）。加固后连跑 3 次 3 绿；完整 verify 全绿。

**与计划不一致**
1. 钩子 `mode` 按 STAGE 6.4 从 W1 的「闸门 static/scene」迁移为舞台状态（home/campus/…）；
   W1 的 stage.spec 第 5 条相应从 `mode==='static'` 改为 `reason==='query-off' && mode==='home'`
   （静态与否由 reason 判定，断言同样严格；海报 naturalWidth 断言未动）。
2. 卡上 e2e 第 6、7 条合并为一个用例（第 7 条需要与第 6 条同页的换包前后资源对比，
   跨用例页面会重建，断言完全保留）。
3. 校区题签在 1440×900 的 home 机位下五个锚点投影均在 x>640（题字矩形外），无一被遮蔽，
   满足「至少 4 块可见」；该规则保留实现（x≤640 且 y≤470 时隐藏）。

## 舞台 W4：问话栏和回答面板 — 2026-11-21

按 `cards/W4` 在舞台上能问能答：底部问话栏 + 右侧回答面板 + 盖章公文卡；镜头不动（W5 的事）。

**代码**
- 新建 `AskDock.vue`（stage-dock）：状态行（金色小菱形 + 「智多星在线 · 知识库 N 条审定证据」/
  「正在连接知识服务…」，busy 时「正在翻查审定资料…」+「不等了」调 cancel）；输入框与
  「问」字钮（去空白、空或 busy 不发、发完清空，**不用 useGo().ask()**——不跳 /chat）；turns
  为空时四个示例问题，点了直接发；进入页面 restore()。题字里的知识库行（W2 加的）移到这里。
- 新建 `AnswerPanel.vue`（stage-panel + 上方 stage-question 宣纸问话条）：只显示最后一轮
  （最后一条 assistant + 前面最近一条 user，无记录不渲染）；八种状态——pending/answer（右上
  「依据 N 条审定证据 · S 秒」、AnswerBlocks 渲染正文、公文卡列表）/clarify（选项钮调
  pickChoice）/insufficient（message +「还缺：」用「；」连接 + 照样列出处）/out_of_scope/
  workflow（名称、摘要、历史演示小标签、进入向导）/error（再试一次调 retry）/cancelled；
  公文卡（stage-doc-N）：标题、issuer·locator、time_condition 增行、右侧 stamp.svg 50×50
  转 −12° 不透明 0.86，点击展开 excerpt +「看原文」（/sources/）；AnswerBlocks 的 cite 事件
  展开对应卡并滚动；面板底部小字 +「全部对话」（/chat）+「重新开始」（newSession）。
- `stage.css`：问话栏（底部居中 30px、宽 min(800px,100vw−640px)、上下压边、渐变底、问钮
  按下下沉 1px）；面板（右 30px 上 118px 宽 428px、最高 calc(100vh−118px−190px) 内部细滚动
  条、四角 L 形金包角用四个空元素、进场 260ms 从右 16px 滑入淡入）；公文卡（宣纸底、顶边
  3px 红色双线、宋体标题）；**AnswerBlocks 舞台覆盖**（`.stage .blocks` 等选择器）：外框
  去掉、段背景透明、段间 rgba(232,237,243,0.10) 细线、正文月白、小标签宋体鎏金、kind-note
  透明底 --st-moon2、cite 角标鎏金且悬停不变底——面板里无红色字。
- `fixtures/api.ts` 只追加：POST sessions / GET messages / POST chat（按 message 关键词分流：
  学生证=两段答案含大学生活动中心南楼301-302室+两条学生处出处+timing 1800；借书=无楼名+
  图书馆；成绩单=行政楼一楼大厅或博学楼B区+教务处；补办卡=clarify 两选项；校长=out_of_scope；
  奖学金怎么申请=workflow（national_inspirational_2025）；音乐=无楼名+文学院；出错=HTTP 500；
  其余=insufficient 缺两项）。

**验证**
- e2e `stage-ask.spec.ts` **11 passed**：状态行与示例、学生证问答（不跳页、答/回答/官方出处/
  楼名、两卡、右上「依据 2 条审定证据 · 1.8 秒」）、公文卡宣纸底 rgb(239,232,216) + 印章
  naturalWidth、正文块透明底 + .no 鎏金 rgb(232,201,138)、点卡展开看原文 /sources/、clarify
  选择后内容变、out_of_scope、进入向导去 /workflows/、出错重试、资料不足还缺、空输入不发
  请求、全程 status=ready 且 stop=home 且仍在出帧。
- 反向验证：公文卡背景临时改 #ffffff → 第 3 条变红 ✓，改回。
- `npm run verify`：**110 passed (7.5m) 全绿**（stage-ask 11/11、rise 4/4、scene 9/9 及全部
  既有回归）。截图 W4-answer.png 视觉自查：问话栏、问话条、面板与公文卡、金色包角与标签、
  正文无红字，均正常。

**与计划不一致 / 途中修复（均为环境适配，断言语义不变）**
1. 卡上第 11 条「画布仍然在渲染」：我加的帧数观察窗口初为 900ms——软件渲染实测约 1 帧/1.5 秒
   （当场上限 ~0.7fps，looping=true、fxOffset 在推进），900ms 内常无新帧。窗口放宽到 3 秒、
   只要求期间仍在出帧（与夜景篇 fx.spec 的 3 秒窗口适配同一性质）。
2. rise.spec 第 1 条（涌起中间值）在整场负载下连续变红、隔离跑 3/3 绿（**经作者确认加固**，
   W4 清单外文件）：一帧可长达约 1 秒、涌起只有 260ms，中间值整段被一次阻塞渲染盖住，
   事后任何轮询都读不到（第一版改 100ms 定时轮询仍红）。终版给钩子 hotRise 装写入记录器、
   在写入现场捕获样本：「经历中间值」= 样本含 0<h<1（涌起起点 0.02 必然写入），终值仍按
   1.5 秒后为 1；功能回归（不涌起/直达 1）仍会红。
3. scene.spec 第 7 条（反复进出 6 次压测）曾有一次整场负载下 20 秒 ready 超时：隔离复跑 9/9
   绿，属环境偶发，未改任何代码即稳定；机器上另有两个不属于本项目的 uvicorn（端口 8000/8735）
   在跑，可能间歇争用 CPU。
4. 题字里的知识库行（W2 自行加的）移到问话栏状态行（STAGE 4.5 文案本来就把这行放在问话栏）；
   无任何测试依赖它。

## 舞台 W5：回答落到楼上 — 2026-11-21

按 `cards/W5` 让回答落到楼上：问「学生证丢了去哪补办」，镜头飞到大学生活动中心、H_ 外壳
涌起红色、楼上方展开题签、面板「办理地点」红线连着它；楼在别的沙盘显示「换过去」；
没有外壳的楼用图钉。原理：不让大模型猜地点——楼名/发布单位查 places.json。

**代码**
- 新建 `src/stage/places.ts`：`resolvePlace(response, places)` 纯函数，严格按 5.5 节四条
  （只处理 answer；逐段取「出现位置最靠前、同位置取更长」的楼名，对到 null 的学院作废
  本段继续看下一段；段落全无楼名时按顺序看 citations 的 issuer；再没有→null）。
- `scene.ts`：`setShell`（即 showHot——沿用 N5 涌起过渡）、`setPin`（先把 P_pin 的 position
  设成 (anchor.x, 0, anchor.z) 再显隐，STAGE 12.3/12.4）；goTo 接口放宽接受机位对象
  （`{ name: 'focus:<楼号>' }` 记进 stop）；钩子新增 `shell`、`pin`。
- `stores/stage.ts`：`showAnswer(buildingId)`（packOf 同包→answer 态；异包→otherPack 不自动
  切；packOf 里没有的楼只有测试入口会传，当作当前包兜底）；新增 `loadPlacesData`、
  `setPackMeta`（StageCanvas 同步当前包元数据，取楼名用）；pickCampus 同包分支清
  place/otherPack（goHome/switchPack 本来就清）。
- `StageView.vue`：监听 chat store 最后一条助手记录——变 `pending`→showAnswer(null)
  （上一问的楼必须收掉），变 `done` 且请求号是本页新发出的→showAnswer(resolvePlace(...))；
  `restore()` 恢复的旧记录（进来即 done、请求号对不上）不触发（卡常见错误第 5 条）。
- `StageCanvas.vue`：answer 分支——setZone(null)，楼在 `meta.shells` → setShell，否则
  setPin；`goTo(meta.focus[楼号], { name: 'focus:'+楼号 })`；非 answer 分支收掉
  shell/pin；钩子测试入口 `debugShowAnswer(楼号)`。
- `SceneSigns.vue`：answer 态不显示校区题签，显示楼的题签（stage-sign-<楼号>，文字去掉
  括号内容，标记点 = anchor+look.sign.lift，线长 60px）。
- `AnswerPanel.vue`：「办理地点」一节（stage-panel-place：小标题+朱红小方块+楼名+片区名）
  放在「回答」之前；otherPack 时同位置显示「这栋楼在将军山校区，点这里换过去」
  （点了 switchPack，等新场景 ready 后再 showAnswer 补上）；红色引线（stage-leader：
  fixed 全屏 svg 不设 viewBox，1.2px 折线三点——办理地点左缘下 36px→左移 70px→
  anchor−6 投影右移 30px，末端 8×8 朱红方块；每帧重算；办理地点滚出面板可见区隐藏）。

**验证**
- unit `places.test.ts` 11 条全过（真实 places.json：楼名位置优先/行政楼在前/第二段楼名
  优先于发布单位/靠发布单位/北区图书馆同位置取更长/学院迁将军山/护理学院（筹）作废后靠
  发布单位且不误指理学院/都没有→null/clarify→null）。单测合计 **100 passed**。
- `stage-store.test.ts` 追加 4 条（showAnswer 同包/异包/null/pickCampus 清 place）。
- e2e `stage-place.spec.ts` **10 passed**：学生证→answer 态 shell=ZQ-B023 stop=focus:
  ZQ-B023 偏红>0.011、办理地点含楼名与中区、楼题签可见、anchor 投影在 25%–55%、引线末端
  与 anchor−6 投影横差 30±3 纵差≤3、成绩单→ZQ-B024 借书→ZQ-B034、超出范围回 home 无引线
  无办理地点、音乐系→otherPack 钮含将军山→点了换包后落到 JJ-B019、debugShowAnswer
  ('BQ-B001') pin 生效偏红>0.0035、点北区收壳收针、连问 10 问题资源不变。
- 反向验证：resolvePlace「取出现位置最靠前」临时改「取最长的」→ 单测第 2 行（行政楼在前）
  变红 ✓，改回。
- `npm run verify`：**120 passed (8.6m) 全绿**。截图 `W5-answer.png`（红壳+光柱+题签+办理
  地点+引线，均确认）、`W5-pin.png`（BQ-B001 图钉+光圈+题签；该测试流程未提问，无面板
  属正确行为）。

**与计划不一致 / 途中修复**
1. **W4 的 e2e 第 11 条前提被 W5 按设计取代**：W4 卡写明「镜头移动是 W5 的事」，其第 11 条
   「全程 stop=home」在 W5 落地后必然变红（学生证问题现在就该飞到 ZQ-B023）。按原验证意图
   改为问无地点的问题（校长→超出范围，stop 保持 home），镜头飞楼的行为由 stage-place
   第 1–5 条覆盖；W4-answer.png 截图挪到第 2 条（学生证面板）拍。
2. rise.spec 第 1 条终值读取（固定 1.5 秒）在 120 条测试的重负载下读到仍在涌起的 0.02：
   改为有界等待（8 秒超时、100ms 轮询，到不了 1 照样红）——与已获确认的该条加固同一性质。
3. packOf 只收 places 可解析的 114 栋楼；测试入口传的其他楼（BQ-B001）按「当前沙盘」兜底，
   正常产品路径不会走到（resolvePlace 的结果必在 packOf，已逐一核对）。

## 舞台 W6：把首页换成舞台 — 2026-11-21

按 `cards/W6` 把 `/` 从普通版首页换成按设备/视口/偏好判定的入口：能跑 3D 且窗口 ≥1100
打开网站就是整屏舞台；手机、软件渲染、省流量、关过 3D、窄窗口、点过「普通版」的用户首页
仍是白色普通版。舞台顶栏「问答/服务/普通版」做实，普通版顶栏末尾多一个「校园」回舞台。

**代码**
- 新建 `src/stage/entry.ts`：`decideEntry(input)` 纯函数（六条规则按序命中：?stage=0→
  query-off；mode=static→static；视口<1100→narrow；?stage=1→query-on；prefer=classic→
  prefer-classic；其余→default），另导出 `entryIsStage` 响应式标记（App.vue 顶栏页脚联动用）。
- 新建 `src/views/EntryView.vue`：薄壳，defineAsyncComponent 分包加载 StageView/HomeView
  （普通版不下载舞台代码；构建实测 EntryView 1.17KB、StageView 28.65KB、HomeView 4.98KB
  各自独立 chunk）。挂载时判一次；舞台时给 `<html>` 加 `is-stage` 同步 entryIsStage，
  卸载时复位（W6 常见错误 3）。**同一路由内 query 变化会重判**（见「途中修复」2）；
  不用 keep-alive（常见错误 2）。
- `router/index.ts`：`/` → EntryView；新增 `/classic` → HomeView（meta.title 服务入口）；
  `/stage` 原样保留。
- `App.vue`：顶栏页脚 `v-if` 改为 `!route.meta.stage && !entryIsStage`；普通版顶栏导航末尾
  新增「校园」链接（朱红描边呼应舞台的「普通版」钮）——只在 decideMode()=scene 且视口
  ≥1100 时显示（挂载算一次），点击删 `shzu.stage` 再去 `/?stage=1`；当前页带 `?3d=1` 时
  链接带上它（见「途中修复」3）。
- `StageTop.vue`：「问答」聚焦问话栏输入框；「服务」router-link 去 /services；「普通版」
  点击设 `shzu.stage='classic'` 去 /classic；「观景」W8 之前不响应。
- `StageView.vue`：onBeforeUnmount 时 `store.goHome()`（见「途中修复」1）。

**验证**
- unit `entry.test.ts` 新增 8 例全过（六规则各一 + `{static,'1'}→static` +
  `{scene,1099}→narrow`）。单测合计 **108 passed**。
- e2e `stage-entry.spec.ts` 新增 7 例全过：1440/?3d=1 进舞台无 .topbar、pack=all；
  /?3d=0 与 1000 宽走普通版（board-tile 恰 5、无 stage）；「普通版」往返（去 /classic、
  记住选择、点「校园」回舞台且 shzu.stage 已清）；舞台点「服务」去 /services（暖白底、
  顶栏在），后退回舞台场景重新就绪；/?3d=0 无 .glb 请求、无 StageView 分包；问一个问题
  点「全部对话」去 /chat，后退面板仍是那轮回答、镜头 stop=home/shell/pin=null 不重飞（
  第 7 条对 messages 路由加了测试内覆盖，带记忆返回该轮问答；fixtures 本身未动）。
- 反向验证：规则 3 的 1100 临时改 900 → 第 3 条（1000 宽走普通版）变红（页面进了舞台） ✓，改回。
- `npm run verify`：**127 passed (9.1m) 全绿**。末尾 20 行：

```
  ok  111 tests\e2e\stage.spec.ts:43:1 › 1 ready 后：pack=all、303 栋楼、29 外壳、7 片区、停靠 home (2.0s)
  ok  112 tests\e2e\stage.spec.ts:62:1 › 2 画布占满视口；没有普通版的顶栏和页脚 (3.6s)
  ok  113 tests\e2e\stage.spec.ts:72:1 › 3 夜景像素：暗色 >75%、暖色亮 >0.15%、饱和红 <0.05% (6.3s)
  ok  114 tests\e2e\stage.spec.ts:82:1 › 4 预算：drawCalls ≤ 600、triangles ≤ 400000 (3.8s)
  ok  115 tests\e2e\stage.spec.ts:93:1 › 5 ?3d=0：静态模式显示海报 (1.4s)
  ok  116 tests\e2e\stage.spec.ts:104:1 › 6 ?intro=1：先 intro 后 ready，落 home (5.3s)
  ok  117 tests\e2e\stage.spec.ts:113:1 › 7 普通版不受影响：/classic 仍有顶栏与白色首页 (518ms)
  ok  118 tests\e2e\stage.spec.ts:120:1 › shots：W1-home.png (4.8s)
  ok  119 tests\e2e\static.spec.ts:26:1 › 1 海报可见：naturalWidth > 0，alt 非空 (560ms)
  ok  120 tests\e2e\static.spec.ts:36:1 › 2 外框宽高比：桌面 2.35–2.45；手机 1.28–1.38 且用手机海报 (869ms)
  ok  121 tests\e2e\static.spec.ts:59:1 › 3 标记恰好 5 个；中心与 posterDesktop 相差 < 0.01 (878ms)
  ok  122 tests\e2e\static.spec.ts:77:1 › 4 悬停「教务」按钮：标记 02 高亮且钩子 activeBoard 正确；移开复原 (814ms)
  ok  123 tests\e2e\static.spec.ts:89:1 › 5 悬停标记 05：第 5 个板块按钮高亮；点击跳服务目录 (820ms)
  ok  124 tests\e2e\static.spec.ts:99:1 › 6 键盘聚焦标记 01：第 1 个板块按钮高亮 (606ms)
  ok  125 tests\e2e\static.spec.ts:105:1 › 7 数据说明含 OpenStreetMap 与「示意」 (730ms)
  ok  126 tests\e2e\static.spec.ts:112:1 › 8 meta 请求被中断：海报仍可见、标记 0 个、pageerror 0 次 (1.2s)
  ok  127 tests\e2e\static.spec.ts:124:1 › 9 截图存档（docs/3d/shots） (3.6s)

  127 passed (9.1m)
```

**旧测试改地址（逐条，W6.md「旧测试要改的地方」）**
- baseline.spec.ts:13,19,28 `goto("/")`→`goto("/classic")`（前三条；38 行 WebGL2 探针与
  页面内容无关，不动）
- camera.spec.ts:25,41,86,105,133,168,186 `/?3d=1`→`/classic?3d=1`（7 处）
- fx.spec.ts:16,28,45,66,82,93,110 `/?3d=1&intro=0`→`/classic?3d=1&intro=0`（7 处）
- gate.spec.ts:22 `/?3d=1`→`/classic?3d=1`；32,40,47,53,58 `goto("/")`→`goto("/classic")`
  （测试名「/ 默认」同步改为「/classic 默认」；27 行 /?3d=0 强制静态、任何环境不红，不动）
- hud.spec.ts:154 `/?3d=1`→`/classic?3d=1`；192 `goto("/")`→`goto("/classic")`
  （82,98,110,123,145 五处 /?3d=0 不动，理由同上）
- interact.spec.ts:58,82,106,122,137,154,170 `/?3d=1`→`/classic?3d=1`（7 处）；
  150 行断言 `pathname`toBe("/")`→`toBe("/classic")`（goto 改址后「拖动不触发点击」
  的地址不变断言随页面路径联动，语义等价，不改必红）
- intro.spec.ts:28,40,65,88,120,129 `/?3d=1`→`/classic?3d=1`（6 处）；108
  `/?3d=1&intro=0`→`/classic?3d=1&intro=0`；95 `waitForURL(/\/\?3d=1/)`→
  `(/\/classic\?3d=1/)`
- night.spec.ts:78,91,102,127,149,162 `/?3d=1`→`/classic?3d=1`（6 处）
- rise.spec.ts:53,92,111,139 `/?3d=1&intro=0`→`/classic?3d=1&intro=0`（4 处）
- scene.spec.ts:61,69,100,106,120,173,190,199 `/?3d=1`→`/classic?3d=1`（8 处）；176
  `waitForURL(/\/\?3d=1/)`→`(/\/classic\?3d=1/)`；150 行 /?3d=0 不动
- stage.spec.ts:114 `goto("/")`→`goto("/classic")`（测试名注释同步）
- stage-shell.spec.ts:124 `goto("/")`→`goto("/classic")`（测试名同步）
- static.spec.ts:27,37,60,78,90,100,106,116,128 `goto("/")`→`goto("/classic")`（9 处）
- 其余 spec 均为 `/stage?3d=1&intro=0`（/stage 保留）或断言 /classic 无关路径，未动。

**与卡不一致 / 途中修复**
1. **StageView 卸载不复位舞台 store（真实缺陷，stage-entry 第 7 条首跑暴露）**：点
   「全部对话」是 SPA 内导航，后退回来 chat/stage 两个 Pinia store 都在内存——stage
   store 残留 answer 态（place=ZQ-B023），StageCanvas 重挂后就绪回调里
   `applyStageMode()` 把镜头重新飞到 focus:ZQ-B023。修复：StageView onBeforeUnmount
   调 `store.goHome()`。回来时镜头=初始 home 机位（不重飞）、面板靠 chat store 保留那轮
   回答，正是卡第 7 条要的形态；顺带修正了「换校区/问完题后离开再回来还停在旧状态」的
   整类问题（packId 保留，用户选的沙盘不丢）。
2. **EntryView 同路由 query 变化不重判（真实缺陷，stage-entry 第 4 条首跑暴露）**：普通版
   `/?3d=1` 上点「校园」去 `/?stage=1&3d=1`，Vue Router 视为同一路由仅 query 变化、复用
   组件实例，挂载时的判定（普通版）不再执行，页面停在普通版。修复：EntryView watch
   `route.fullPath` 重判（重读 ?stage= 与 shzu.stage；视口/设备变化仍不实时切换，符合
   卡第 5 条）。App.vue「校园」先删 shzu.stage 再导航，click 处理先于路由，时序正确。
3. **App.vue「校园」链接带 ?3d=1 的取舍**：卡写「链接到 /?stage=1」。测试环境（swiftshader
   软件渲染）里不带 3d=1 时 decideMode 恒为 software-gl 静态版，/?stage=1 回不了舞台，
   第 4 条必红；真机无此问题。实现为：当前页 URL 带 ?3d=1 时链接变为 /?stage=1&3d=1，
   其余情况维持 /?stage=1——对真机行为零影响，测试环境可回舞台。
4. stage-entry 第 4 条选择器 `getByRole("link", { name: "校园" })` 首跑歧义（顶栏还有
   「校园对话」）：给该断言加 `exact: true`（测试代码修正，非产品缺陷）。

## 舞台 W7：智多星 — 2026-11-21

按 `cards/W7` 加智多星：一颗十字星芒光点悬在校园上空（页面 div，非 3D 物体），旁边
「智多星」三个字；提问后光晕每 1.2 秒一闪（thinking）；回答落到楼上时 900ms 飞过去、
身后一道渐隐弧线（flying），飞完 300ms 拖尾淡出。静态模式不显示星；减少动态：不闪、
瞬移、无拖尾。

**代码**
- 新建 `src/components/stage/ZdxStar.vue`：星本体（10×10 白点 + 三层光晕 box-shadow +
  一横一竖 74px 星芒伪元素 + 右上「智多星」宋体白字深影，全部按卡原文）。目标点 =
  `meta.look.star.home`（home/campus/tour 态）或 楼 anchor+`look.star.lift`（answer 态）；
  位置只在 `onFrame` 回调里算（`project()` → 直接写 transform，不走响应式，常见错误 1）；
  目标变化 900ms `easeInOutCubic` 缓动飞行（与镜头同款），途中 Y 加 `sin(π·t)×两点距离×0.25`
  拱起；`data-state` = idle/thinking（chat.busy 且未在飞）/flying；层 z-index 3 低于面板；
  `visibility` 为假的投影时隐藏。key/type 必须从普通 `<script>` 块导出（script setup 不允许
  ES 导出），STAR_TRAIL_KEY 容器由 StageView provide（provide/inject 不能跨兄弟组件）。
- `SceneSigns.vue`（白名单内、只为画拖尾）：连线层里加固定全屏 svg（stage-star-trail，
  不设 viewBox、不接鼠标），二次贝塞尔 path 从起飞点的屏幕快照到星当前位置（控制点取
  中点上移 0.25×屏距，呼应 3D 弧高比例），描边用透明→白的线性渐变（卡：属于星的一部分），
  飞完 300ms 淡出后由 ZdxStar 撤除。
- `StageView.vue`：挂 ZdxStar、provide 拖尾容器。
- 拖尾/星本身无 stage.css 改动（样式都在组件 scoped 内，符合卡 3.4 节边界）。

**验证**
- e2e `stage-star.spec.ts` 7 条全过（两次连跑确认）：ready 后 idle 且中心与
  `projectPoint(star.home)` ≤3px、含「智多星」；延迟 1.5s 的 chat 路由下提问 → thinking；
  回答到达后观察到 flying 且拖尾在；落定后 idle、中心与 `projectPoint(anchor+lift)` ≤3px、
  拖尾已撤（截图 `W7-star.png`）；点全校（rail-ALL）星飞回 home 投影；`?3d=0` 无星；
  减少动态全程无 flying（MutationObserver 记账 data-state 出现值）无拖尾且落点仍准。
- 反向验证：answer 态 `+ look.star.lift` 临时去掉 → 第 4 条变红 ✓，改回。
- `npm run verify`：**134 passed (13.0m) 全绿**（127 旧 + 7 新）。末尾 20 行：

```
  ok 116 tests\e2e\stage-star.spec.ts:207:1 › 6 静态模式（?3d=0）：没有星 (2.2s)
  ok 117 tests\e2e\stage-star.spec.ts:213:1 › 7 减少动态：全程无 flying、无拖尾、落点仍准 (5.7s)
  ok 118 tests\e2e\stage.spec.ts:43:1 › 1 ready 后：pack=all、303 栋楼、29 外壳、7 片区、停靠 home (3.3s)
  ok 119 tests\e2e\stage.spec.ts:62:1 › 2 画布占满视口；没有普通版的顶栏和页脚 (6.3s)
  ok 120 tests\e2e\stage.spec.ts:72:1 › 3 夜景像素：暗色 >75%、暖色亮 >0.15%、饱和红 <0.05% (10.0s)
  ok 121 tests\e2e\stage.spec.ts:82:1 › 4 预算：drawCalls ≤ 600、triangles ≤ 400000 (3.8s)
  ok 122 tests\e2e\stage.spec.ts:93:1 › 5 ?3d=0：静态模式显示海报 (4.6s)
  ok 123 tests\e2e\stage.spec.ts:104:1 › 6 ?intro=1：先 intro 后 ready，落 home (6.6s)
  ok 124 tests\e2e\stage.spec.ts:113:1 › 7 普通版不受影响：/classic 仍有顶栏与白色首页 (942ms)
  ok 125 tests\e2e\stage.spec.ts:120:1 › shots：W1-home.png (7.9s)
  ok 126 tests\e2e\static.spec.ts:26:1 › 1 海报可见：naturalWidth > 0，alt 非空 (1.1s)
  ok 127 tests\e2e\static.spec.ts:36:1 › 2 外框宽高比：桌面 2.35–2.45；手机 1.28–1.38 且用手机海报 (2.3s)
  ok 128 tests\e2e\static.spec.ts:59:1 › 3 标记恰好 5 个；中心与 posterDesktop 相差 < 0.01 (1.8s)
  ok 129 tests\e2e\static.spec.ts:77:1 › 4 悬停「教务」按钮：标记 02 高亮且钩子 activeBoard 正确；移开复原 (1.1s)
  ok 130 tests\e2e\static.spec.ts:89:1 › 5 悬停标记 05：第 5 个板块按钮高亮；点击跳服务目录 (5.0s)
  ok 131 tests\e2e\static.spec.ts:99:1 › 6 键盘聚焦标记 01：第 1 个板块按钮高亮 (1.0s)
  ok 132 tests\e2e\static.spec.ts:105:1 › 7 数据说明含 OpenStreetMap 与「示意」 (1.2s)
  ok 133 tests\e2e\static.spec.ts:112:1 › 8 meta 请求被中断：海报仍可见、标记 0 个、pageerror 0 次 (1.4s)
  ok 134 tests\e2e\static.spec.ts:124:1 › 9 截图存档（docs/3d/shots） (5.0s)

  134 passed (13.0m)
```

**与卡不一致 / 途中修复**
1. 瞬态等待的池化方式（环境问题，同 rise.spec 确认过的先例）：`waitForFunction` 默认
   按页面 rAF 轮询，无头软件渲染一帧可达 1 秒，thinking（往返 1.5s 窗口）与
   flying（900ms 窗口）可能被整段错过——诊断脚本实测 thinking 在 250ms 内出现且功能
   正常，纯轮询方式缺漏。给两处瞬态等待加 `polling: 100`（定时器轮询，窗口错过照样
   超时变红，不断言语义）。
2. 测试路由的延迟实现：route 回调里用 `page.waitForTimeout` 会在测试结束时报
   "Test ended"，改用原生 `setTimeout` Promise。
3. 第 2 条首版多写了一条卡上没有的断言（延迟期间 panel 应为 0）——实际发问后
   AnswerPanel 本就以 pending 态显示「正在翻查」，删掉该断言（对照卡文：只要求
   thinking），按面板真实行为改为断言「正在翻查」。
4. `<script setup>` 不允许 ES 导出：STAR_TRAIL_KEY/StarTrailState 移到同文件的普通
   `<script>` 块（双 script 并存是 Vue SFC 标准用法，未新建文件，不越白名单）。

## 舞台 W8：拖动旋转和观景 — 2026-11-21

按 `cards/W8` 加鼠标交互与观景：按住左键拖动沙盘跟着转、滚轮拉近拉远（参数全部来自
`meta.look.orbit`，用 three 自带的 OrbitControls，不是新依赖）；点顶栏「观景」界面全部
淡去、镜头绕目标点竖直轴匀速转（`degPerSec`，方位角随时间增大），Esc 或右上角
「退出观景」回到原机位；观景模式与减少动态时不显示「观景」。

**代码**
- `scene.ts`：`setOrbit(enabled)` 懒创建一次 OrbitControls（enablePan/Damping 关，极角、
  距离夹持换算自 meta）；`start` 事件记 `stop='free'`，`change` 事件 hookInfo+请求渲染
  （题签/罗盘/星跟着动）；`syncControls()`：镜头飞行、开场、观景期间 `enabled=false`，
  `goTo` 到位后把 `controls.target` 同步成当前目标点（不调 `update()`、不给停靠点施夹持）。
  `setTour(on)`：开——快照当前机位、禁 controls、每帧绕「过目标点的竖直轴」转
  `degPerSec × dt` 度（dt 用 tick 里已有的 ≤0.1 秒封顶值）；关——用 `goTo`（900ms，走
  `name: 快照stop`）飞回快照机位。`dispose` 里 `controls.dispose()`；钩子 `tour`。
- `stores/stage.ts`：`tourPrev` 字段 + `setTour(on)`（开记旧 mode 置 tour，关恢复；
  setTour 未在 W8 白名单的 store 部分之外动任何东西）。
- `StageCanvas.vue`：ready 两处（initScene 无开场分支、finalizeIntro）后
  `setOrbit(true)`（含换包后重挂）；mode 变 tour 调 `setTour(true)`、离开调
  `setTour(false)`（镜头自己回快照机位，不再跑 applyStageMode）；根元素
  `:class="{ 'is-tour': store.mode === 'tour' }"`。
- `StageTop.vue`：「观景」做实（`canTour` = 闸门 scene 且未开减少动态，两者任一不满足
  不渲染）；「问答/服务/普通版」不变。
- `StageView.vue`：window Esc 退出观景；舞台页 `body.overflow=hidden`（滚轮留给沙盘缩放，
  离开恢复）；`stage-tour-exit` 退出钮（宋体 13px、淡金边，右上角）。
- `stage.css`：`is-tour` 下顶栏/校区列/题字/问话栏/面板/罗盘/场景题签（含题签自身，
  它单独设了 pointer-events:auto）/引线/星/署名 300ms 淡到 0 且不可点；暗角与退出钮保留；
  给淡出清单基线 300ms 过渡。

**验证**
- e2e `stage-orbit.spec.ts` 8 条全过：中央右拖 200px 方位角 >5°、stop=free、距离变动 <1%；
  上下各拖 2000px 极角被 [minPolarDeg−0.5, maxPolarDeg+0.5] 夹住且相机 Y 恒 >0（逐步采样）；
  滚轮 ±50 次距离落在 [minDistance×0.99, maxDistance×1.01]；拖动后罗盘仍 = −方位角
  （±1°）；拖动后点北区仍精确落 bq 停靠点（±0.5）；观景（mode=tour、tour=true、界面
  opacity 0、退出钮在、2 秒方位角 ≈ 2×degPerSec ±40%、相机高度不变；隔日复跑 2 次稳定）；
  Esc 恢复 campus 停 bq、界面 opacity 1；减少动态无「观景」。
- 反向验证：`maxPolarAngle` 临时改 `Math.PI` → 第 2 条变红 ✓，改回。
- 首跑 `npm run verify`：**141 passed / 1 failed**（stage-campus 第 2 条「至少 4 块题签可见」
  只见 3 块），末尾如下：

```
  1) tests\e2e\stage-campus.spec.ts:63:1 › 2 场景题签：至少 4 块可见；线底端与 projectPoint(zone.label) 相差 ≤3px ───

    Error: expect(received).toBeGreaterThanOrEqual(expected)

    Expected: >= 4
    Received:    3

  1 failed
    tests\e2e\stage-campus.spec.ts:63:1 › 2 场景题签：至少 4 块可见；线底端与 projectPoint(zone.label) 相差 ≤3px ────
  141 passed (15.9m)
```

**与卡不一致 / 途中修复**
1. **OrbitControls 构造函数会拧歪镜头朝向（真实缺陷，首跑 verify 暴露）**：three r187 的
   构造函数以默认 `target=(0,0,0)` 调一次内部 `update()`，末尾 `object.lookAt(0,0,0)`——
   我们在构造之后才 `controls.target.copy(currentTarget)`，晚了；镜头位置没动但朝向被指向
   世界原点，校区题签投影全偏（home 机位在画面里的题签只剩 3 块可见）。隔离复跑 3/3 红，
   排除环境偶发。修复：构造前存镜头位置，设完 target 后
   `camera.position.copy(saved); camera.lookAt(currentTarget)` 摆回原机位。修复后第 2 条
   3/3 绿；stage-orbit 8 条与 stage-campus 其余不受影响。
2. **观景 2 秒转速断言**（我在开工前标注的风险）：实测通过（无头渲染期间 rAF 出帧够密，
   dt 封顶未触发）。未做任何放宽；第 6 条单独复跑 2 次均绿。
3. **第 6/7 条不透明度读取**：软件渲染主线程拥塞会把 300ms 过渡的启动推迟几百毫秒，
   固定等 500ms 时可能读到 0.0017（过渡收尾中）。改 `expect.poll` 有界等 8s 到确值
   （最终值仍是严格相等断言）。
4. **第 3 条滚轮测试放宽单测时限到 90s**：每次滚轮触发一次重渲染（设计的按需渲染），
   50 次等待超过默认 30s 测试预算；只放宽时间，不动断言。

## 舞台 W9：学院和五个板块 — 2026-11-21

按 `cards/W9` 做校区面板：选中校区右侧列出学院（沙盘上对应楼顶「一二三」序号标记），
点学院镜头飞过去楼变红；中区面板上方多一排五个板块钮，点板块飞到对应楼并显示板块
面板（办理地点 + 服务清单 + 示例问题直发）。

**代码**
- `stores/stage.ts`：`showBuilding(buildingId)`（效果同 showAnswer、不清 board——学院/板块
  的入口用）；抽出 `applyPlace()` 供两者共用；`board` 字段，`goHome`/`pickCampus`/
  `switchPack`/`showAnswer` 清成 null（新问一发 board 即清、面板自然换回回答面板）。
- 新建 `CampusPanel.vue`（一组件两形态，卡第 3 条允许）：campus 形态（stage-campus-panel）——
  校区名 + 「N 栋楼 · M 个学院」，学院行（中文序号 cnNumber、去括号名、右侧第一栋楼名，
  confirmed=false 标「位置待确认」），空片区一句「主要是宿舍和生活设施」；板块行（仅当
  选中片区 = places.boards 楼所在片区）五个 stage-board-<板块名> 钮。board 形态
  （stage-board-panel）——板块名 + 办理地点（同 W5 样式）+ 「这个板块能办的事」
  （api.services(board)，加载中/失败/空各一行；每服务 name+summary+最多两条示例问题，
  点了 chat.send）。mounted 预取 places（板块显示条件要用）。
- `StageView.vue`：`boardPanelActive`（answer 且 board）时 AnswerPanel 让位给 CampusPanel
  的板块形态（AnswerPanel 本身一个字没改，卡第 3 条）。
- `SceneSigns.vue`：campus 态给片区每学院的第一栋楼画序号标记（stage-mark-<序号>：
  20×20 近黑底、月白 1px 边、宋体 700 11px 中文序号、右侧学院名小标签；同楼两院只画
  第一个；位置每帧 project(anchor)）；点标记 = 点列表那一行（先清 board 再 showBuilding）；
  answer 态仍按 W5 显示楼的题签。
- 服务清单的路由覆盖写在 `stage-colleges.spec.ts` 内（Playwright 后注册优先，
  fixtures/api.ts 一处未动——hud.spec 的 mockServices 是同一先例）。

**验证**
- unit `stage-store.test.ts` 追加 3 例全过（pickCampus('ZQ')+showBuilding('ZQ-B034')→
  answer+place；showBuilding 不动 board、pickCampus 清 board/place；goHome 与 showAnswer
  都清 board）。文件合计 12 passed。
- e2e `stage-colleges.spec.ts` 8 条全过（一次通过）：北区面板含「北区/109」、学院行数 =
  元数据 zone==='BQ'（4）；序号标记中心与 projectPoint(anchor) ≤3px；点第一行学院
  answer 态 shell='BQ-B025'（在 shells 里）且楼的题签可见；点回北区复 campus 收壳收针
  列表还在；中区五个板块钮、点图书馆 shell='ZQ-B034'、板块面板含「图书馆/这个板块能办的
  事/办理地点」、服务行数 = 假数据 2 条（截图 `W9-zq.png`、`W9-lib.png`）；点示例问题
  发出 1 次 POST /api/v1/chat 且面板换回回答面板；东区一行「经济与管理学院」；将军山
  再点进 campus、行数 = jjs 元数据学院数（4）、无板块钮。
- 反向验证：把学院列表的 `zone === 选中片区` 过滤临时去掉（第一版破坏写法逻辑等价于
  原条件、没有生效，换成真正绕过后重做）→ 第 1 条变红 ✓，改回。
- `npm run verify`（W8 修复 + W9 合入后的全量）：**150 passed (16.9m) 全绿**。末尾 20 行：

```
  ok 132 tests\e2e\stage-star.spec.ts:207:1 › 6 静态模式（?3d=0）：没有星 (1.3s)
  ok 133 tests\e2e\stage-star.spec.ts:213:1 › 7 减少动态：全程无 flying、无拖尾、落点仍准 (6.3s)
  ok 134 tests\e2e\stage.spec.ts:43:1 › 1 ready 后：pack=all、303 栋楼、29 外壳、7 片区、停靠 home (3.6s)
  ok 135 tests\e2e\stage.spec.ts:62:1 › 2 画布占满视口；没有普通版的顶栏和页脚 (5.9s)
  ok 136 tests\e2e\stage.spec.ts:72:1 › 3 夜景像素：暗色 >75%、暖色亮 >0.15%、饱和红 <0.05% (9.1s)
  ok 137 tests\e2e\stage.spec.ts:82:1 › 4 预算：drawCalls ≤ 600、triangles ≤ 400000 (3.2s)
  ok 138 tests\e2e\stage.spec.ts:93:1 › 5 ?3d=0：静态模式显示海报 (4.7s)
  ok 139 tests\e2e\stage.spec.ts:104:1 › 6 ?intro=1：先 intro 后 ready，落 home (6.0s)
  ok 140 tests\e2e\stage.spec.ts:113:1 › 7 普通版不受影响：/classic 仍有顶栏与白色首页 (648ms)
  ok 141 tests\e2e\stage.spec.ts:120:1 › shots：W1-home.png (7.0s)
  ok 142 tests\e2e\static.spec.ts:26:1 › 1 海报可见：naturalWidth > 0，alt 非空 (896ms)
  ok 143 tests\e2e\static.spec.ts:36:1 › 2 外框宽高比：桌面 2.35–2.45；手机 1.28–1.38 且用手机海报 (1.2s)
  ok 144 tests\e2e\static.spec.ts:59:1 › 3 标记恰好 5 个；中心与 posterDesktop 相差 < 0.01 (981ms)
  ok 145 tests\e2e\static.spec.ts:77:1 › 4 悬停「教务」按钮：标记 02 高亮且钩子 activeBoard 正确；移开复原 (1.0s)
  ok 146 tests\e2e\static.spec.ts:89:1 › 5 悬停标记 05：第 5 个板块按钮高亮；点击跳服务目录 (1.2s)
  ok 147 tests\e2e\static.spec.ts:99:1 › 6 键盘聚焦标记 01：第 1 个板块按钮高亮 (973ms)
  ok 148 tests\e2e\static.spec.ts:105:1 › 7 数据说明含 OpenStreetMap 与「示意」 (833ms)
  ok 149 tests\e2e\static.spec.ts:112:1 › 8 meta 请求被中断：海报仍可见、标记 0 个、pageerror 0 次 (1.3s)
  ok 150 tests\e2e\static.spec.ts:124:1 › 9 截图存档（docs/3d/shots） (9.4s)

  150 passed (16.9m)
```

**与卡不一致 / 途中修复**
1. 反向验证第一版破坏写法 `if (c.zone !== zid && zid !== "XXX")` 与原条件逻辑等价（没有
  破坏任何东西，测试仍绿属于应当），换成真正的绕过后第 1 条按预期变红。记录在此提醒：
  反向验证必须确认「缺陷真的被制造出来了」。
2. `meta.colleges[].confirmed` 在类型里是可选的（v2 语义），面板按 `=== true` 取严格布尔。


## 舞台第二阶段总览：七包「近看」架构落地 — 2026-11-22

协助方交付了七包结构的新资产（`frontend/public/campus3d/` 全量替换，与 `docs/3d/ASSET_SHA256_V3.txt`
对照 24 项全部一致）和更新后的 STAGE.md、W1/W3/W5/W9 卡与全新 W10 卡。第二阶段在一个会话里按卡顺序
完成：W1 适配（zones 字段）、W3 重构（近看与换包）、W5 适配（只看 meta.buildings）、W9 补充（地标题签
可点）、W10 全新（回答里近看）；W2/W4/W6/W7/W8 与 N 系列不受影响、未改动。每张卡的验证与反向验证
均重做，末尾全量 `npm run verify` 全绿（单测 153、e2e 161）。

## 舞台 W1（二阶段适配）：七包 packs.json 与元数据 — 2026-11-22

**做了什么**
- `packs.ts`：`Pack` 增加 `zones`（非空字符串数组）与 `buildings`（正整数）两个字段并校验；
  `CampusZoneRef` 删除 `stop`（v3 里校区镜头停靠一律看当前包 `meta.zones[].stop`，单片区沙盘
  没有 stop 就退回 overview）。
- `meta.ts`：v3 热点数校验从 5/6 放宽到 5/6/7（zq、nq 两块沙盘有 7 个地标楼，放宽前会拒绝解析）。
- `StageCanvas.vue`：`campusStop()` 从查 `campuses[].stop` 改为查当前包 `meta.zones[].stop`
  （all 上五个主校区的值与旧表完全一致，旧 W3 e2e 语义不变），缺省 `overview`。
- `packs.test.ts` 重写：七包 id 顺序、default、campuses 六校区与各自 pack、三个反例（version 改 v2 /
  校区 pack 改 x / 某包 zones 置空）、七个包的 meta 循环校验（楼数=包表 buildings、pack.id、
  zones 片区号一致）、all 303/29/7、jjs 19、三个 meta 反例（focus 删一项 / stops.home / pin 空）、
  v2 元数据仍然可解析。
- `glb-v3.test.ts` 重写为七包循环：shells 的 H_ 节点（无 mesh、缩放 0）、带 node 片区的同城节点、
  look.pin.node 节点、B_ 前缀节点数=楼数。

**验证**：单测 packs 20 项、glb-v3 28 项全过。

## 舞台 W3（二阶段重构）：校区题签、近看和切换沙盘 — 2026-11-22

**做了什么**
- `stores/stage.ts` 按 STAGE 6.3 重写：字段 `packId / meta / mode / zoneId / place / otherPack /
  board`；动作 `goHome / pickCampus / enterCampus / switchPack / setMeta`（保留已有的 `setTour /
  showAnswer / showBuilding / applyPlace`）。pickCampus 三分支从上到下：①campus 态再点同一校区 =
  goHome（取消）；②当前包 zones 里有这个校区 → campus 态；③否则 switchPack(这个校区自己的包)，
  换包后停在 home。enterCampus 只在 campus 态有效。switchPack 传当前的 packId 时只 goHome、
  传不同的包时先 `meta = null` 再 goHome。loadCampuses 现在保存整个 packs.json（packs + default +
  campuses）——「在不在当前沙盘」「校区自己的沙盘」「默认沙盘」三个判断只查这三样，不写包名分支。
- `CampusRail.vue`：is-far 改看当前包 zones（不含的校区虚线边框）；「全校」钮走 default 而非写死
  'all'；新增「近看」钮（stage-rail-enter，campus 态且选中校区 pack ≠ 当前包时出现在选中项右侧，
  竖排金字）。
- `StageView.vue`：题字随沙盘换（默认包用固定文案；其他包小题「石河子大学」、大标题包名、
  说明 pack.note）。
- `SceneSigns.vue`：非默认包的 home 态显示 hotspots 地标小题签（stage-landmark-<no>，文字 board、
  锚点 anchor、26px 线）；校区题签只在默认包的 home 态显示。
- `CampusPanel.vue`：`packMeta` 引用更名为 `meta`（W9 组件，4 处最小编译修复）。
- `stage-store.test.ts` 重写（W3 卡 10 条 + 适配后的 W5/W9 断言）；`stage-campus.spec.ts` 重写
  12 条（6—11 条同页连续换包）。

**验证**：e2e 12 条全过。反向验证：把 setZone 里「把上一个设回 0」临时去掉 → 第 5 条变红
（偏红像素 0.0029 > 0.001，界线残留可见），改回后绿。

## 舞台 W5（二阶段适配）：落楼只看 meta.buildings — 2026-11-22

**做了什么**
- `applyPlace` 重写：「楼在不在当前沙盘上」只看 `meta.buildings`（不再拿 packOf 与 packId 比——
  在中区自己的沙盘里，中区的楼 packOf 是 all 但它就在眼前）；meta 为 null（换包中）一律复位；
  packOf 里没有这个楼号时也复位；place.name 从 meta.buildings 取。
- `AnswerPanel.vue`：其它沙盘钮文案改为「这栋楼在「全校」沙盘上，点这里换过去」——引号里取
  packs.json 包表的 name（all 在 campuses 里没有对应项，之前按校区表取会显示 id）。
- 单测追加 7 例（zq 沙盘里落 ZQ-B023 不误报 otherPack；BQ-B019 在 zq 里 otherPack=all；
  setMeta(null) 后 showAnswer 复位等）；e2e 追加第 11、12 条（换到 zq 再问学生证：同一栋楼直接落、
  第 3/4 条同样成立、偏红 >0.015；zq 里问音乐系指「将军山校区」、BQ-B019 指「全校」，点换过去照常落楼）。

**验证**：e2e 12 条全过（一次通过）。反向验证：resolvePlace「取出现位置最靠前」临时改成「取最长」
→ 第 2 行（行政楼在前）变红，改回后绿。

## 舞台 W9（二阶段补充）：地标题签可点 — 2026-11-22

**做了什么**
- `SceneSigns.vue`：stage-landmark-<no> 从「不响应点击」改为可点的 button——点了先清 board 再
  showBuilding(热点的 buildingId)，样式不变（26px 线、小一号字）。
- `stage-colleges.spec.ts` 追加第 9 条：换到中区自己的沙盘后点 05 号地标题签 → answer 态、
  shell = zq 元数据里 05 号热点的楼；再点中区回 campus，五个板块钮都在（板块楼就在这块沙盘的
  ZQ 片区，boardZone 判断自动成立），学院行数 = zq 元数据 zone === 'ZQ' 的学院数。

**验证**：e2e 9 条全过（一次通过）。反向验证：把学院列表的 zone 过滤临时去掉 → 第 1 条变红，
改回后绿。

## 舞台 W10（新增）：在回答里近看 — 2026-11-22

**做了什么**
- `stores/stage.ts`：新增 getter `nearPack`——place 或 meta 为空 → null；当前包不是默认包 →
  null（已经在近看的沙盘里）；否则取这栋楼的片区号，在 packs 里找一个不是默认包、zones 含这个
  片区号的包。按 zones 找而不是查 campuses：附属医院（FY）和护士学校（HX）不是校区，但它们的楼
  在 nq 沙盘上，按 zones 才找得到。
- 新增动作 `enterPlace()`：nearPack 为 null 时不动；否则记下楼号，switchPack(nearPack)，等新沙盘
  就绪再落回同一栋楼。「换包等 ready 再落楼」提取为 `waitPackThenShow(packId, buildingId, seq)`，
  与 W5 的 stage-other-pack 钮共用同一份实现（AnswerPanel 里原来 watch sceneStatus 的那份删除）。
- 作废机制：state 加 `placeSeq`（每次 applyPlace 递增）。等待期间用户又问了新问题（showAnswer 被
  再次调用，placeSeq 变）或又换了沙盘（packId 变），记下的楼号作废、不再 showAnswer。
- state 另加技术性字段 `sceneReady`（StageCanvas 把 sceneStatus === 'ready' 同步进来）与
  `setSceneReady` 动作——不在 STAGE 6.3 的字段/动作清单里，是 W10 等待逻辑的最小实现，特此说明。
- `AnswerPanel.vue`：nearPack 非空时在「办理地点」楼名右边显示「近看」小钮（stage-place-near，
  横排金字金边、宋体 600 12.5px、字距 0.34em、内边距 3px 8px、直角）。
- 单测追加 4 例（all 上五个片区的楼各指对自己的近看沙盘——zq/bq/nq/by/dq；showAnswer(null) 后
  为 null；zq、jjs 沙盘内为 null）。
- 新建 `stage-near.spec.ts` 8 条：答完学生证「近看」钮可见；点了换到 zq、开场动画后镜头落回
  ZQ-B023、面板全程在（正文与两张公文卡、办理地点、引线），且不再出现近看钮（截图
  `W10-near.png`）；换沙盘全程没有新的 POST /api/v1/chat；在 zq 里继续问借书照常落 ZQ-B034；
  回全校后面板还在；范围外的问题无办理地点无近看钮；「点近看后立刻问新问题」旧的那一问不再落下
  （作废机制，shell 是 ZQ-B034 或 null 而非 ZQ-B023）；近看来回 5 次每次回全校后 geometries、
  textures 都与第一次相同。

**验证**：e2e 8 条全过（一次通过）。反向验证：把 nearPack 第二条（非默认包返回 null）临时去掉 →
第 2 条里「没有 stage-place-near」变红（zq 上又冒出近看钮），改回后绿。

## 舞台第二阶段收尾：全量 verify — 2026-11-22

- `npm run verify`（build + bundle 检查 + 单测 + e2e）：单测 **153 passed**（11 个文件），
  e2e **161 passed (20.3m)** 全绿。比第一阶段净增 11 条 e2e（W3 系列重写后 12 条、W5 +2、
  W9 +1、W10 新增 8 条）与 24 例 store 单测里的 7 例 zq/meta 空等新校验。
- 途中修复：CampusPanel 曾被 PowerShell 5.1 的 Set-Content 写坏（UTF-8 重编码导致 vue-tsc
  Invalid character，与 PROGRESS 环境备忘「中文文件必须原字节写」同一条教训），git checkout 恢复后
  改用 node 读写完成 4 处更名，build 复绿。
- e2e 长流程的测试级超时：stage-campus 第 6—11 条（四次换包）与 stage-near 相关条目用
  `test.setTimeout` 放宽（240s/420s/120s），页面内等待本身不变。

**与卡不一致 / 说明**
1. W3 卡要求「一次只做一张卡、每卡 verify 全绿才做下一张」；本轮是资产全量替换后的适配工程，
   packs.json 换包瞬间旧 W3/W5 契约的测试必然变红（旧 campuses[].stop 删除、主校区 pack 不再是
   all），无法逐卡满足旧测试全绿，因此按 W1→W3→W5→W9→W10 顺序连续实施，各自完成验证与反向
   验证后，末尾以一次全量 verify 收口（161 全绿）。
2. `stores/stage.ts` 里的 `sceneReady`/`setSceneReady` 与 `placeSeq` 不在 STAGE 6.3 的
   清单里，见 W10 段——是共用等待逻辑所需的最小技术字段。

全量 `npm run verify` 末尾 20 行：

```
  ok 144 tests\e2e\stage-star.spec.ts:213:1 › 7 减少动态：全程无 flying、无拖尾，落点仍准 (5.9s)
  ok 145 tests\e2e\stage.spec.ts:43:1 › 1 ready 后：pack=all、303 栋楼、29 外壳、7 片区、停靠 home (2.9s)
  ok 146 tests\e2e\stage.spec.ts:62:1 › 2 画布占满视口；没有普通版的顶栏和页脚 (5.5s)
  ok 147 tests\e2e\stage.spec.ts:72:1 › 3 夜景像素：暗色 >75%、暖色亮 >0.15%、饱和红 <0.05% (9.4s)
  ok 148 tests\e2e\stage.spec.ts:82:1 › 4 预算：drawCalls ≤ 600、triangles ≤ 400000 (3.2s)
  ok 149 tests\e2e\stage.spec.ts:93:1 › 5 ?3d=0：静态模式显示海报 (4.3s)
  ok 150 tests\e2e\stage.spec.ts:104:1 › 6 ?intro=1：先 intro 后 ready，落 home (5.8s)
  ok 151 tests\e2e\stage.spec.ts:113:1 › 7 普通版不受影响：/classic 仍有顶栏与白色首页 (652ms)
  ok 152 tests\e2e\stage.spec.ts:120:1 › shots：W1-home.png (7.3s)
  ok 153 tests\e2e\static.spec.ts:26:1 › 1 海报可见：naturalWidth > 0，alt 非空 (1.1s)
  ok 154 tests\e2e\static.spec.ts:36:1 › 2 外框宽高比：桌面 2.35–2.45；手机 1.28–1.38 且用手机海报 (1.3s)
  ok 155 tests\e2e\static.spec.ts:59:1 › 3 标记恰好 5 个；中心与 posterDesktop 相差 < 0.01 (1.3s)
  ok 156 tests\e2e\static.spec.ts:77:1 › 4 悬停「教务」按钮：标记 02 高亮且 activeBoard 正确；移开复原 (1.3s)
  ok 157 tests\e2e\static.spec.ts:89:1 › 5 悬停标记 05：第 5 个板块按钮高亮；点击跳服务目录 (1.3s)
  ok 158 tests\e2e\static.spec.ts:99:1 › 6 键盘聚焦标记 01：第 1 个板块按钮高亮 (1.1s)
  ok 159 tests\e2e\static.spec.ts:105:1 › 7 数据说明含 OpenStreetMap 与「示意」 (874ms)
  ok 160 tests\e2e\static.spec.ts:112:1 › 8 meta 请求被中断：海报仍可见、标记 0 个、pageerror 0 次 (1.1s)
  ok 161 tests\e2e\static.spec.ts:124:1 › 9 截图存档（docs/3d/shots） (8.2s)

  161 passed (20.3m)
```



## 舞台第二阶段真机实测与两处竞态修复 — 2026-11-22

全量 verify 之后在 http://127.0.0.1:8300（uvicorn 托管 dist、真实后端与 DeepSeek 回答）上实测
近看主流程，抓到两个被 e2e 侥幸放过的**真缺陷**，均已修复并回归：

1. **TDZ（暂时性死区）**：`waitPackThenShow` 初版写成
   `const stop = watch(..., { immediate: true })`——immediate 回调同步执行时 `stop` 尚未赋值，
   真机一点「近看」即抛 `ReferenceError: Cannot access '_' before initialization`（压缩后变量名
   `_`）。e2e 未红是因为异常被 Vue 吞掉后第二个 ready 回调（此时 `stop` 已赋值）走完了正常路径。
   修复：`let stop` 先声明后赋值。
2. **immediate 抢跑**：修完 TDZ 后真机仍「换到 zq 但楼不落」——immediate 首次回调读到的是**旧场景
   残留的 sceneReady=true**（switchPack 还没来得及触发 teardown），作废检查恰好全过，`showAnswer`
   在新包 `meta` 还是 null 时被调用，直接走了复位分支（即 W10 卡常见错误第 1 条原话）。修复：
   等待条件改成「目标包的元数据已放进来（meta.pack.id === packId）且 sceneReady 且仍在目标包」——
   switchPack 会同步清 meta，旧场景的 ready 因此不可能再冒充新就绪。
3. 修复后回归 `stage-near.spec` + `stage-place.spec` 共 20 条全过；真机重测：学生证真实问答
   →「近看」→ 开场动画后镜头落回中区沙盘的同一栋楼（shell=ZQ-B023、focus:ZQ-B023），面板的
   办理地点/公告出处卡/红色引线全程在，console 零报错；zq 上 7 块地标题签（学工/教务/后勤/保卫/
   图书馆/博学楼/知行楼）悬在对应楼上，点 05 落图书馆；将军山 19 楼、回全校 303 楼后
   geometries=415 / textures=4 与 e2e 稳定值一致（无泄漏）。截图
   `docs/3d/shots/live-near-bq.png`、`live-near-answer.png`。

教训记录：**「e2e 全绿」不能替代真机首次实测**——两处缺陷都在时序边界上，压缩产物与真实交互的
时序和 headless swiftshader 不完全一致；本次幸而按惯例做了 8300 实测才兜住。


> AI生成


## A0 修六个现有问题 — 2026-11-23（feat/campus-alive）

按 `ALIVE.md` 6.1 节与 `cards/A0.md` 完成，六项全部落地：

1. `requirements.txt` 补齐六项锁定版本（venv `pip freeze` 实测口径：langchain 1.5.0 /
   langchain-core 1.8.2 / langchain-openai 1.8.1 / langgraph 1.2.22 / openai 3.54.0 /
   python-dotenv 1.2.4）。
2. `ChatState` 声明 `notes: List[str]`——用 langgraph StateGraph 复现确认修复前
   `node_prepare` 写入的校验提示在下一节点读作 `None`。
3. 退化路径改为 prepare →（模型↔工具按 `_route_after_model` 循环）→ publish；
   假模型两连调（第一次工具调用、第二次最终 JSON）断言 `answer` + 调用 2 次。
4. `v1._history_for(session_id)` 跳过 `error`/`model_unavailable` 助手轮；顺带修了
   HEAD 上 `v1.py` docstring 未闭合的语法错误与 `_attach_preset` 首轮未入库的抽出缺口
   （同会话第二轮才有 preset 的原因）。
5. `chat.ts`：`ChatTurn.choiceId` + `retry` 按选项 id 重发；`restore()` 有 pending
   轮次且会话未变时不被服务器记录覆盖。
6. 验证：`scripts/check_a0.py` 13 断言全过；两项反向验证均按预期红（删 `notes` →
   第 2 条 FAIL；retry 改回文字取 id → `chat-store.test.ts` 第 5 条 FAIL）后恢复；
   `chat-store.test.ts` 4 条；后端 smoke_backend 27/27 + smoke_v1 正常；
   前端 vue-tsc/构建/红线/单测 162/e2e 194 全绿。

提交：`fix(A0)` 7bb2d8f；同分支另有 `fix(errand)` 7f7a256（办事体验收尾）、
`3d(assets)` 425f7ae（v4 资产，SHA256 47/47 对上 ASSET_SHA256_V4.txt）。

> AI生成

## A1 院徽资产和 EmblemMark — 2026-11-23（feat/campus-alive）

按 `cards/A1.md` 完成，页面本身（不带 `?emblems=1`）看不出变化：

- `stage.css`：`.stage` 下新增 `--st-gilt`（全站唯一金属渐变，只用于院徽鎏金）。
- 新建 `src/stage/emblems.ts`：`loadEmblems()`（Promise 缓存、colleges≠24 抛错、
  失败不缓存可重试）、`emblemUrl()`（绝对地址，CSS 变量里 url() 按样式表位置解析）、
  `shortName()`（去全角括号）、`collegesOfBuilding()`（按 no 升序）、
  `collegeForPlace()`（按 text 分段找名字，段内比位置，前段优先；都没出现取 no 最小）。
- 新建 `EmblemMark.vue`：鎏金 = 渐变圆 + mask 抠形（`-webkit-mask`/`mask` 两行都写）；
  本色 = 原色图；`color` 为 null（19 继教、24 护理）本色回落鎏金；`data-tone` 写实际
  用的样子；ring 用 `--st-gold2` / `--st-red`。
- `stores/stage.ts`：新增 `emblems`（加载失败保持 null，舞台照常）、`collegeNo`、
  `showCollege(no)`（落到学院在当前沙盘的第一栋楼，走 W9 的 showBuilding）；
  `goHome`/`pickCampus` 清 collegeNo（switchPack 经 goHome 兜住）。
- `StageView`：挂载时拉 emblems（失败 console.warn）；`?emblems=1` 左上角自查排版
  （两行各 24 枚 40px，鎏金/本色），存 `docs/3d/shots/A1-sheet.png`。

验证：单测 `emblems.test.ts` 5 条（24 条契约 + PNG/RIFF 文件头 + 七包 meta 一致性
+ BY-B029=[2,3] + collegeForPlace 四例）；e2e `stage-emblems.spec.ts` 5 条（48 枚、
19/24 回落鎏金、no.5 鎏金金色像素 >25% 且纯白 <2%——像素统计用 node:zlib 手写
最小 PNG 解码，不引依赖、404 降级照常 ready）。夜间主题固定跑（日间浅底会混入
白像素，首跑 3.4% 即此因）。全量 verify：vue-tsc/构建/红线/单测 167/e2e 199 全绿。

反向验证（-webkit-mask）：删前缀行后像素用例**仍绿**——Chromium 159.0.8154.6
（Playwright 1.65.1）已支持无前缀 `mask`。按卡说明记录版本号，两行仍都保留（Safari
需要前缀，且成本为零）。

> AI生成
