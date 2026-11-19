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

> AI生成
