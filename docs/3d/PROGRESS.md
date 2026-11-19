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

> AI生成
