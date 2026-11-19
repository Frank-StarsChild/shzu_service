# 石大智多星 · 首页「校园沙盘」3D 落地计划

> 读者：项目作者本人，以及替他写代码的 agent。
> 分工：**3D 资产（模型、海报图、元数据）由协助方做好交付；所有代码由作者和他的 agent 独立完成。** 本文只给目标、契约、步骤和验证办法，不给实现代码。
> 用法：一次只做一个步骤。每个步骤都有「验证」和「反向验证」，全部通过才算完成。

---

## 1. 要做成什么

在首页「01 — 服务板块」这一节里，五个板块按钮的正上方，加一个横向的**校园沙盘**：石河子大学中区的白色建筑模型，五个板块各对应沙盘里的一栋楼。

1. 打开页面先看到一张静态图（和 3D 场景同一个机位渲染出来的）。3D 准备好以后，原地淡入换成可交互的场景，位置不跳。
2. 鼠标移到某个板块按钮上：镜头缓缓转向对应的楼，楼变成品牌红色，楼旁的编号标记展开显示楼名。
3. 鼠标移到沙盘里的那栋楼上：楼变红，对应的板块按钮高亮（镜头不动）。点击这栋楼，进入该板块的服务目录。
4. 手机、低配电脑、没有 WebGL、用户自己关掉 3D：只显示静态图和五个编号标记，五个入口照常可点，功能一样不少。
5. 3D 加载失败：停在静态图，给一个重试按钮。

**不做的事**（本轮一律不做，见第 9 节待办池）：自由漫游的全校地图、建筑搜索、问答里的位置跳转、后期特效（辉光、景深）、昼夜切换。

**加分项**（主体全部验收通过以后再做，见 S10）：按住拖动可以把沙盘转个角度看，松手弹回；被高亮的楼微微抬起。

**这套做法的出处**：参考 felixrieseberg.com。它好看的原因不是「用了 3D」，而是这几条，本计划逐条照做：

| 它的做法 | 本计划里对应什么 |
|---|---|
| 光照离线烘焙进贴图，运行时不算光 | 资产包是烘焙好的模型，代码里不加灯、不开阴影 |
| 镜头是摆好的构图，不是自由视角 | 六个固定停靠点，只在停靠点之间平滑移动 |
| 场景里的物体就是导航 | 五栋楼就是五个板块的入口 |
| 静态页面是正文，3D 是加分项 | 静态版先做完、先验收（S3），3D 后加 |
| 进入 3D 前先判断设备行不行，留强开和强关的口子 | S4 的判定规则，`?3d=1` / `?3d=0` |
| 有加载显示，失败能退回静态页 | S5 |
| 静态图和 3D 是同一个画面 | S5 的「海报对位」测试 |

---

## 2. 分工与交付顺序

| 谁 | 做什么 |
|---|---|
| 协助方 | 资产包：`campus.glb`、`campus.meta.json`、两张海报图、每个停靠点的参考渲染图。先给 **v0**（契约正确、外观是临时的，够写代码用），再给 **v1**（烘焙完成的正式版）。v1 直接覆盖同名文件，代码不用改。 |
| 作者和他的 agent | 第 6 节 S0–S9 的全部代码和测试，以及可选的 S10。 |
| 作者本人 | 第 7 节的三次人工验收，把截图发给协助方看。 |

S0、S1 不需要资产包，现在就可以开始。**S2 开始需要资产包**；`frontend/public/campus3d/` 里没有文件时，在 S2 停下来等。

---

## 3. 资产包契约

资产包原样放进 `frontend/public/campus3d/`，**代码不许修改这些文件**。

```
frontend/public/campus3d/
  campus.glb            模型，不超过 3 MB
  campus.meta.json      元数据：热点、停靠点、楼名、署名
  poster-desktop.jpg    1920×800（宽高比 12:5），overview 机位渲染，不超过 300 KB
  poster-mobile.jpg     1200×900（宽高比 4:3），不超过 300 KB
```

### 3.1 `campus.glb`

- glTF 2.0 二进制。单位米，Y 轴朝上，+X 是东，−Z 是北，原点在中区中心。
- **只用 three 自带的 `GLTFLoader` 就能读**：没有 Draco、meshopt、KTX2，不需要任何解码器。贴图是 WebP，浏览器自己会解，`GLTFLoader` 直接支持，代码里不用做任何事。
- 外观：桦木胶合板底座上的白色卡纸建筑模型，光影、木纹、窗洞、底座上的铭牌全部已经烘焙进贴图。
- 材质全部是「不受光照」的烘焙材质（`KHR_materials_unlit`），three 读出来是 `MeshBasicMaterial`。所以：**不加任何灯，不开阴影，不改材质参数**（高亮除外，见 S7）。
- 节点命名：
  - `B_<楼号>`，例如 `B_ZQ-B034`：一栋楼一个 Mesh，可以被高亮和点击。
  - `S_` 开头：地面、道路、树、其他片区，不参与交互。
- 所有 `B_` 节点共用同一个材质对象。**高亮时必须克隆材质，不能改共用的那个。**
- 上限：三角面不超过 30 万，绘制调用不超过 120。

### 3.2 `campus.meta.json`

```jsonc
{
  "version": "v0",
  "attribution": "校园示意模型，依据公开资料复原，非测绘成果；办事地点以学校官方通知为准。底图数据 © OpenStreetMap contributors",
  "background": "#ffffff",
  "camera": { "fov": 30, "near": 5, "far": 6000 },
  "stops": {
    "overview": { "position": [0, 0, 0], "target": [0, 0, 0] },
    "xg": {}, "jw": {}, "hq": {}, "bw": {}, "lib": {}
  },
  "hotspots": [
    {
      "no": "01", "board": "学工", "stop": "xg",
      "buildingId": "ZQ-B023", "label": "大学生活动中心", "note": "学生处、资助中心",
      "anchor": [0, 0, 0],            // 标记点：编号标记的中心放在这里。场景坐标，在楼的正上方
      "pick": [0, 0, 0],              // 拾取点：楼顶上的一个点，鼠标指到这里一定指中这栋楼
      "posterDesktop": [0.5, 0.5],    // anchor 在桌面海报上的位置，左上角为 (0,0)，右下角为 (1,1)
      "posterMobile": [0.5, 0.5]
    }
    // 共 5 个，no 为 01–05，顺序与首页五个板块按钮一致
  ],
  "buildings": {
    "ZQ-B034": { "name": "图书馆", "category": "图书馆", "anchor": [0, 0, 0] }
    // 每个 B_ 节点一条
  }
}
```

上面的数字都是占位，真实值以交付的文件为准。`fov` 是竖直视场角（three 的 `PerspectiveCamera` 第一个参数）。

### 3.3 五个热点（以 meta 为准，代码里不许写死楼名）

| 编号 | 板块 | 楼 | 说明 |
|---|---|---|---|
| 01 | 学工 | 大学生活动中心 | 学生处、资助中心在此 |
| 02 | 教务 | 行政楼 | 教务处在此 |
| 03 | 后勤 | 会泽食府 | 餐饮服务的代表点，不代表后勤管理处的办公地点 |
| 04 | 保卫 | 保卫部楼 | |
| 05 | 图书馆 | 图书馆（总馆） | |

### 3.4 协助方保证的事

- 每个热点的 `pick` 在 `overview` 和它自己的停靠点下都不被别的东西挡住：从相机朝 `pick` 打一条射线，最先碰到的一定是这栋楼。
- `anchor` 在 `pick` 的上方（模型里有一根细杆从屋顶伸到 `anchor`，编号标记就像插在楼上的图钉）。`overview` 机位、外框宽 1000 像素以上时，两者在屏幕上相距不少于 22 像素，所以 22 像素见方的编号标记不会盖住拾取点。
- 画布宽高比为 12:5、相机用 meta 里的 `fov` 和 `overview` 停靠点时，每个热点 `anchor` 投影到屏幕的位置，与 `posterDesktop` 一致（误差小于画面的 1%）。S5 用这一条检查相机有没有装对。
- `overview` 画面里，与背景色有明显差别的像素不少于 30%；模型本身不含饱和的红色；热点楼的屋顶是亮色。S5、S7 的像素统计依赖这三条。
- v0 和 v1 的文件名、节点名、meta 结构完全相同，只有外观和 `version` 不同。**测试不许依赖具体颜色或某个像素的值**，只许用第 6 节写明的统计量。

---

## 4. 代码约定（名字固定，后面的步骤和验收都按这些名字找东西）

### 4.1 文件位置

```
frontend/
  src/campus3d/
    meta.ts        类型和 parseMeta()，纯函数
    gate.ts        decideMode() 纯函数，readGateInput() 取浏览器信息
    camera.ts      缓动和停靠点插值，纯函数
    scene.ts       全部 three.js 代码。整个 src 里只有这个文件可以 import three
  src/components/CampusHero.vue   外壳：海报、标记、加载条、开关；用动态 import() 加载 scene.ts
  tests/unit/*.test.ts            vitest
  tests/e2e/*.spec.ts             Playwright
  tests/e2e/fixtures/api.ts       /api 的假数据
  scripts/check-bundle.mjs        体积和分包检查
  vitest.config.ts
  playwright.config.ts
```

### 4.2 `scene.ts` 对外的接口（实现自己写，形状照这个来）

```ts
export interface CampusSceneHandle {
  goTo(stop: string, opts?: { immediate?: boolean }): void;
  setHighlight(board: string | null): void;
  onHover(cb: (board: string | null) => void): void;   // 鼠标在画布里移到或移出热点楼
  onPick(cb: (board: string) => void): void;           // 点击热点楼
  onFrame(cb: () => void): void;                       // 每渲染一帧后回调，用来更新标记位置
  project(point: [number, number, number]): { x: number; y: number; visible: boolean };  // 场景坐标 → 视口坐标（CSS 像素）；visible 表示在画面范围内
  dispose(): void;
}
export function createCampusScene(
  canvas: HTMLCanvasElement,
  meta: CampusMeta,
  opts: { glbUrl: string; reducedMotion: boolean; onProgress: (p: number) => void },
): Promise<CampusSceneHandle>;   // 第一帧画完才 resolve
```

### 4.3 调试钩子 `window.__campus3d`（所有自动验证都靠它，必须始终存在）

| 字段 | 类型 | 含义 |
|---|---|---|
| `mode` | `'static' \| 'scene'` | 判定结果 |
| `reason` | string | 判定原因代码，见 S4 |
| `status` | `'static' \| 'loading' \| 'ready' \| 'error'` | 当前显示状态 |
| `hotspotCount` | number | meta 里的热点数 |
| `buildingCount` | number | 场景里 `B_` Mesh 的数量，未加载时为 0 |
| `activeBoard` | string \| null | 当前高亮的板块 |
| `hoveredBoard` | string \| null | 鼠标在画布里指着的板块 |
| `stop` | string | 镜头当前或正要去的停靠点 |
| `moving` | boolean | 镜头是否在移动 |
| `frames` | number | 累计渲染帧数 |
| `drawCalls` / `triangles` | number | 取自 `renderer.info.render` |
| `geometries` / `textures` | number | 取自 `renderer.info.memory` |
| `highlightMaterials` | number | 当前存活的克隆高亮材质数 |
| `camera` | `{ position: number[], target: number[], fov: number }` | 相机现状 |
| `projectPoint(point)` | 函数 | 同 4.2 的 `project`，传场景坐标 `[x, y, z]` |

### 4.4 其他固定名字

- 地址栏参数：`?3d=1` 强制开 3D，`?3d=0` 强制静态。
- `localStorage` 键：`shzu.campus3d`，值 `off` 表示用户关掉了 3D。
- `data-testid`：`campus-hero`（外框）、`campus-poster`（海报 img）、`campus-canvas`、`campus-overlay`（标记层）、`campus-marker-01` … `campus-marker-05`、`campus-progress`、`campus-error`、`campus-retry`、`campus-toggle`、`campus-caption`。
- 首页五个板块按钮加属性 `data-board="学工"` 等；被联动高亮时加 class `is-active`，样式与它现在的 `:hover` 相同。标记被联动高亮时同样加 `is-active`。
- 联动状态放在 `HomeView` 里，是唯一来源：`activeBoard`（板块名或 `null`）和 `activeSource`（`'tile'`、`'marker'`、`'canvas'` 或 `null`，表示是谁触发的）。**只有来源是板块按钮（`tile`）时镜头才移动**；来源是标记或画布时只高亮。原因：标记和楼都跟着镜头走，镜头一动它们就从鼠标下移开，画面会反复抖。

### 4.5 外观（照这个做，不要自己发挥）

- 外框：宽度占满 `.shell`；宽高比桌面 `12 / 5`，视口宽度 ≤ 720px 时 `4 / 3`；1px 黑色边框、直角、无阴影；下边与板块按钮的上边共用一条线，不要出现双线。
- 标记：22×22px 红底（`var(--red)`）白字方块，字是编号，用 `var(--mono)` 11px 粗体，直角。`is-active` 时在右侧展开一个标签：白底、1px 黑边、12px 字，第一行楼名（粗体），第二行 `note`（灰色 `var(--ink-2)`）。
- 加载条：贴在外框底边的 2px 红线，宽度等于进度。
- 说明文字：外框下方一行 `.tiny` 小字，内容是 meta 的 `attribution`。右端是开关 `campus-toggle`，样式用现有的 `.btn-sm`。
- 高亮色 `#e2001a`。镜头移动 900 毫秒，先慢后快再慢（cubic in-out）。海报换成画布的淡入 400 毫秒。
- 不加任何新的颜色、圆角、阴影、渐变、图标库。

---

## 5. 全局规则（agent 每次开工前读一遍）

1. **一次只做一个步骤，按顺序做。** 当前步骤的验证没有全部通过，不许开始下一步。
2. **只许改这些地方**：`frontend/` 里第 4.1 节列出的文件、`frontend/src/views/HomeView.vue`、`frontend/src/styles/swiss.css`、`frontend/package.json`、`frontend/package-lock.json`、`.gitignore`、`README.md`（仅 S9）、`docs/3d/PROGRESS.md`、`docs/3d/shots/`。
   **不许碰**：仓库根目录下的 `backend/`、`data/`、`evaluation/`、`prompts/`、`scripts/`、`deployment/`、`start.bat`，以及 `frontend/public/campus3d/` 里的资产、其他页面和 `src/api/client.ts`。
3. **只许装这些依赖，版本照抄**：`three@0.187.0`、`@types/three@0.187.0`、`vitest@3.2.4`、`@playwright/test@1.65.1`、`pngjs@7.0.0`。安装时加 `--save-exact`。不许装 TresJS、postprocessing、Draco、其他 3D 或动画库，不许从 CDN 引脚本。
   （`vitest` 必须是 3.x：4 以上要求 Vite 6，本项目是 Vite 5，装了会报依赖冲突。）
4. **每个步骤结束都跑 `npm run verify`**（在 `frontend/` 目录下），全绿才算过。
5. **必须停下来问人的情况**：同一个验证连续修三次还不过；需要改规则 2 之外的文件；需要装规则 3 之外的依赖；资产包不符合第 3 节契约；测试在本机无法取得 WebGL2。停下时把现象写进 `PROGRESS.md`。
6. **不许为了通过而改测试**：不许删断言、放宽阈值、加 `.skip` / `.only` / `fixme`，不许改以前步骤的测试文件（修明显笔误除外，要写进 `PROGRESS.md`）。阈值全部以本文为准。
7. 不许用 `// @ts-ignore`、`// @ts-expect-error`、`as any` 绕过类型错误（`window.__campus3d` 的声明用 `declare global` 正常写）。
8. 界面上的楼名、说明、署名一律来自 `campus.meta.json`，代码里不许写死。
9. 每个步骤一次提交，分支 `feat/campus-3d`，提交信息 `3d(S3): 静态版沙盘` 这种格式。
10. 每个步骤做完，在 `docs/3d/PROGRESS.md` 末尾追加：

```md
## S3 静态版 — 2026-11-21
- 提交：abc1234
- verify：build 通过 / unit 12 passed / e2e 15 passed / bundle 通过
- 反向验证：把海报文件名改错 → static.spec 第 1 条变红 → 已还原
- 与计划不一致的地方：无
- 遗留问题：无
```

**给 agent 的开工提示词**（每个步骤开一个新会话，把 N 换成步骤号）：

```
你在仓库 shzu_service 里工作。先完整阅读 docs/3d/PLAN.md 的第 3、4、5 节和步骤 S<N>，再读 docs/3d/PROGRESS.md 了解已完成的部分。
本次只做步骤 S<N>。做完它的「验证」和「反向验证」，按规则 10 记录并提交，然后停下，不要开始下一步。
遇到规则 5 列出的情况，停下并说明。
```

---

## 6. 步骤

所有命令都在 `frontend/` 目录下运行（Windows PowerShell 和 macOS 终端通用）。

### S0 基线

**目标**：确认现状是好的，记下体积基线。

1. 从 `main` 新建分支 `feat/campus-3d`。
2. `npm ci`，然后 `npm run build`。（lock 文件里的地址是 npmmirror 镜像；如果 `npm ci` 报拒绝下载，先执行 `npm config set registry https://registry.npmmirror.com`。）
3. 在仓库根目录的 `.gitignore` 里追加三行：`frontend/tsconfig.tsbuildinfo`、`frontend/test-results/`、`frontend/playwright-report/`。
4. 新建 `docs/3d/PROGRESS.md`，写下构建输出里这两个块的 gzip 大小：`index-*.js`、`HomeView-*.js`。

**验证**
- `npm run build` 退出码为 0。
- 记下的基线应接近：`index-*.js` gzip 41.6 kB，`HomeView-*.js` gzip 2.7 kB。相差超过 10% 说明起点不是当前的 `main`，停下。
- `git status` 里没有 `tsconfig.tsbuildinfo`。

### S1 测试脚手架

**目标**：有单元测试、有浏览器测试，并且确认测试用的浏览器能跑 WebGL2。之后每一步的自动验证都建在这上面。

1. 安装：`npm i -D --save-exact vitest@3.2.4 @playwright/test@1.65.1 pngjs@7.0.0`，然后 `npx playwright install chromium`。
2. `vitest.config.ts`：在现有 `vite.config.ts` 的基础上合并（这样 `@` 别名可用），只收 `tests/unit/**/*.test.ts`，环境用 `node`。
3. `playwright.config.ts`：`testDir` 为 `tests/e2e`；`workers: 1`；`baseURL` 为 `http://127.0.0.1:4173`；视口 1440×900；`webServer` 用 `npx vite preview --port 4173 --strictPort --host 127.0.0.1` 启动；浏览器启动参数加 `--enable-unsafe-swiftshader`、`--use-angle=swiftshader`、`--ignore-gpu-blocklist`。
4. `package.json` 加脚本：`test:unit`（`vitest run`）、`test:e2e`（**先 `npm run build` 再 `playwright test`**，因为浏览器测的是 `dist/` 里的构建产物，不重新构建就是在测旧代码）、`verify`（依次执行 `build`、`test:unit`、`test:e2e`）。
5. `tests/e2e/fixtures/api.ts`：测试不启动后端，用 `page.route` 拦截。先注册一个兜底：`**/api/**` 一律回 503 和一段 JSON；再注册具体的：`**/api/v1/health/ready`、`**/api/v1/workflows`、`**/api/v1/services*`，返回的字段照 `src/api/client.ts` 里的类型填。（Playwright 里后注册的规则优先。）
6. `tests/unit/smoke.test.ts`：一条恒真的测试，只为确认 vitest 能跑。
7. `tests/e2e/baseline.spec.ts`（**回归护栏，以后的步骤不许改这个文件**），四条测试：
   - 首页 `h1.h-display` 含「校园办事」，`.board-tile` 恰好 5 个。
   - 点第 5 个板块按钮，地址变成 `/services?board=图书馆`（比较前先 `decodeURIComponent`）。
   - 在首页输入框输入「借书」并提交，地址的路径变成 `/chat`。（对话页会把 `q` 参数读走后清掉，所以只断言路径。）
   - WebGL2 探针：在页面里 `document.createElement('canvas').getContext('webgl2')` 不为空。

**验证**：`npm run verify` 全绿，unit 1 条通过，e2e 4 条通过。

**反向验证**：把第一条里的 5 临时改成 6，`npm run test:e2e` 必须变红；改回去再跑一次变绿。

**WebGL2 探针不过时**（个别 Windows 环境可能出现）：依次试 ① `playwright.config.ts` 的 `use` 里加 `channel: 'chrome'`（用本机 Chrome）；② 再加 `headless: false`。都不行就停下。用了这两个办法的话记进 `PROGRESS.md`：有独立显卡的机器上，S4 里直接打开 `/` 的那条测试会得到 `ok` 而不是 `software-gl`，到时停下来问人怎么写这一条。

**下载浏览器很慢时**：可以先设环境变量 `PLAYWRIGHT_DOWNLOAD_HOST=https://npmmirror.com/mirrors/playwright` 再执行安装；还不行就用上面的 ①，不下载，直接用本机 Chrome。

### S2 资产包验收

**前提**：`frontend/public/campus3d/` 里有第 3 节的四个文件。没有就停下等。

**目标**：把契约写成类型和检查，资产有问题时在这一步就发现，而不是到画面上才发现。

1. `src/campus3d/meta.ts`：按第 3.2 节写类型 `CampusMeta`，以及 `parseMeta(raw: unknown): CampusMeta`。不合契约时抛出 `Error`，信息里写明是哪个字段。
2. `tests/unit/meta.test.ts`，读真实的 `campus.meta.json`：
   - `parseMeta` 不抛错。
   - `hotspots` 恰好 5 个；`no` 依次是 `01`–`05`；`board` 依次是 学工、教务、后勤、保卫、图书馆。
   - 每个热点：`buildingId` 在 `buildings` 里有；`stop` 在 `stops` 里有；`anchor`、`pick` 各是 3 个有限数；`posterDesktop`、`posterMobile` 各是 2 个 0 到 1 之间的数；`label` 非空。
   - `stops` 里有 `overview`；每个停靠点的 `position`、`target` 各是 3 个有限数，且两者不相等。
   - 三个反例都必须抛错：删掉一个热点；把某个 `anchor` 改成字符串；把某个 `board` 改成「财务」。（反例在内存里改对象，不改文件。）
3. `tests/unit/glb.test.ts`，读 `campus.glb`（文件开头 12 字节是文件头，接着是一个 JSON 块；自己按 glTF 2.0 的 GLB 格式解析出 JSON）：
   - 开头 4 个字节是 `glTF`，版本号是 2。
   - 文件不超过 3 MB（3 145 728 字节）。
   - `extensionsRequired`（没有就当空数组）不含 `KHR_draco_mesh_compression`、`EXT_meshopt_compression`、`KHR_texture_basisu`。
   - 名字以 `B_` 开头的节点数等于 meta 里 `buildings` 的条数；每个这样的节点都直接带 `mesh`；每个热点的 `B_<buildingId>` 都能找到。
   - 两张海报存在，各不超过 300 KB。

**验证**：`npm run verify` 全绿。

**反向验证**：把 `campus.meta.json` 里一个热点的 `buildingId` 临时改错，`npm run test:unit` 必须变红；用 `git checkout -- frontend/public/campus3d` 还原。

**检查不过**：说明资产包有问题，不要改测试去迁就，停下并把失败信息发给协助方。

### S3 静态版

**目标**：不碰 three，先把静态版做成一个完整、可用、好看的功能。它也是以后所有回退情况下用户看到的样子。

1. 新建 `src/components/CampusHero.vue`，放进 `HomeView.vue`「01 — 服务板块」一节的标题和 `.boards` 之间。
2. 结构按第 4.4、4.5 节：外框 `figure`，里面是海报（用 `<picture>`，视口 ≤ 720px 用手机那张；`img` 写上 `width`、`height`、`alt`）、标记层、说明文字。外框用 CSS `aspect-ratio` 定高，图片没到时不许塌成 0 高。
3. 组件挂载后请求 `/campus3d/campus.meta.json`，用 `parseMeta` 校验，按 `posterDesktop` / `posterMobile` 的百分比位置摆 5 个标记（标记的**中心**对准这个点）。请求或校验失败：不显示标记，海报照常显示，不抛未捕获的异常。
4. 联动（纯 DOM，没有 3D 也成立）：状态按 4.4 节放在 `HomeView` 里。
   - 鼠标移入或键盘聚焦某个板块按钮 → `activeBoard` 等于它，`activeSource` 为 `tile` → 对应标记加 `is-active` 并展开标签。
   - 鼠标移入或聚焦某个标记 → `activeBoard` 等于它，`activeSource` 为 `marker` → 对应板块按钮加 `is-active`。
   - 移出或失焦 → 两者都为 `null`。
   - 点击标记 → 与点击对应板块按钮相同，跳到 `/services?board=…`。
5. 标记是 `button`，`aria-label` 形如「01 学工：大学生活动中心」。
6. 写入 `window.__campus3d`：`mode: 'static'`、`status: 'static'`、`reason: 'not-ready'`、`hotspotCount`、`activeBoard`，其余字段给 0、`null` 或空值。
7. 这一步不许安装或 import three。

**验证**：`tests/e2e/static.spec.ts`
1. 海报可见，`naturalWidth > 0`，`alt` 非空。
2. 1440×900 视口：外框宽高比在 2.35–2.45 之间。390×844 视口：在 1.28–1.38 之间，且 `img.currentSrc` 含 `poster-mobile`。
3. 标记恰好 5 个；每个标记的中心相对外框的归一化坐标，与 meta 的 `posterDesktop` 相差小于 0.01。
4. 鼠标移到「教务」按钮：`campus-marker-02` 有 `is-active`，`__campus3d.activeBoard === '教务'`；移开后没有。
5. 鼠标移到 `campus-marker-05`：第 5 个板块按钮有 `is-active`；点击它，地址变成 `/services?board=图书馆`。
6. 用键盘聚焦 `campus-marker-01`：第 1 个板块按钮有 `is-active`。
7. `campus-caption` 的文字含「OpenStreetMap」和「示意」。
8. 拦截并中断 meta 请求：海报仍可见，标记 0 个，`pageerror` 事件 0 次。
9. 整个过程没有任何地址含 `.glb` 的请求。
10. S1 的 `baseline.spec.ts` 仍然全绿。

把外框的截图存成 `docs/3d/shots/S3-desktop.png` 和 `S3-mobile.png`（用 Playwright 对 `campus-hero` 截图）。

**反向验证**：把海报文件名临时写错，第 1 条必须变红；改回。

**到这里做第一次人工验收（G1，见第 7 节），通过后再往下。**

### S4 能力判定

**目标**：决定这台设备给 3D 还是给静态版。逻辑是纯函数，可以穷举测试。

1. `src/campus3d/gate.ts`：

```ts
export type GateInput = {
  query3d: '1' | '0' | null;      // 地址栏 ?3d=
  webgl2: boolean;
  rendererName: string;           // WEBGL_debug_renderer_info 的 UNMASKED_RENDERER_WEBGL，取不到就用 gl.RENDERER
  storedPref: 'off' | null;       // localStorage 的 shzu.campus3d
  reducedMotion: boolean;         // prefers-reduced-motion: reduce
  saveData: boolean;              // navigator.connection?.saveData
  viewportWidth: number;
  deviceMemory: number | null;    // navigator.deviceMemory
};
export type GateResult = { mode: 'scene' | 'static'; reason: string; canEnable: boolean };
export function decideMode(input: GateInput): GateResult;
export function readGateInput(): GateInput;
```

2. 规则从上到下，命中第一条就返回：

| 序 | 条件 | mode | reason | canEnable |
|---|---|---|---|---|
| 1 | 没有 WebGL2 | static | `no-webgl2` | false |
| 2 | `query3d === '0'` | static | `query-off` | true |
| 3 | `query3d === '1'` | scene | `query-on` | false |
| 4 | `storedPref === 'off'` | static | `user-off` | true |
| 5 | `viewportWidth < 900` | static | `small-viewport` | false |
| 6 | `reducedMotion` | static | `reduced-motion` | true |
| 7 | `saveData` | static | `save-data` | true |
| 8 | `rendererName` 是软件渲染（正则见表后） | static | `software-gl` | true |
| 9 | `deviceMemory` 不为 null 且 ≤ 2 | static | `low-memory` | true |
| 10 | 其余 | scene | `ok` | false |

   规则 8 用的正则（照抄，竖线前面没有反斜杠）：

```js
/swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i
```

3. 开关 `campus-toggle`：
   - `mode` 是 `scene` 时显示「仅看静态图」：点击后把 `shzu.campus3d` 写成 `off`，本次访问立即切到静态版（即使地址栏带着 `?3d=1`）。
   - `mode` 是 `static` 且 `canEnable` 为 true 时显示「开启 3D 沙盘」：点击后删掉 `shzu.campus3d`，本次访问按 `query3d === '1'` 重新判定。
   - 其余情况不显示开关。
4. `CampusHero` 挂载时判定一次，写进 `__campus3d.mode` 和 `reason`。这一步 3D 还没做，`mode` 是 `scene` 时画面仍是静态版，只是钩子里的值不同。

**验证**
- `tests/unit/gate.test.ts`：表里 10 行各一条测试；再加优先级测试：`query3d='1'` 且 `storedPref='off'` → `scene`；没有 WebGL2 且 `query3d='1'` → `no-webgl2`；`query3d='0'` 且其余全好 → `query-off`；视口 390 且 `reducedMotion` → `small-viewport`。再加四条显卡名测试：
  - `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)` → `software-gl`
  - `Microsoft Basic Render Driver` → `software-gl`
  - `ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)` → `ok`
  - `ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)` → `ok`
- `tests/e2e/gate.spec.ts`：
  - `/?3d=0` → `mode` 为 `static`，`reason` 为 `query-off`。
  - `/?3d=1` → `scene`，`query-on`。
  - `/`（无头浏览器用的是软件渲染）→ `static`，`software-gl`，开关可见且文字含「开启」。
  - 视口 390 → `small-viewport`，没有开关。
  - `page.emulateMedia({ reducedMotion: 'reduce' })` → `reduced-motion`。
  - 用 `addInitScript` 预先写入 `shzu.campus3d=off` → `user-off`。
  - 在 `/` 点开关 → `mode` 变成 `scene`，`localStorage` 里没有这个键。

**反向验证**：把规则 5 的 900 临时改成 100，对应的单元测试和 e2e 必须变红；改回。

**注意**：自动测试的浏览器是软件渲染，按规则会进静态版。所以**后面所有测 3D 的用例都用 `/?3d=1` 打开**。

### S5 三维场景：加载到第一帧

**目标**：`mode` 为 `scene` 时，懒加载 three 和模型，画出与海报一模一样的第一帧，淡入替换。失败则留在静态版。

1. 安装：`npm i --save-exact three@0.187.0`，`npm i -D --save-exact @types/three@0.187.0`。
2. `src/campus3d/scene.ts` 按 4.2 的接口实现到「能画出第一帧」：
   - 加载器从 `three/addons/loaders/GLTFLoader.js` 引入。
   - 渲染器：`antialias: true`；`setPixelRatio(Math.min(devicePixelRatio, 2))`；`outputColorSpace = SRGBColorSpace`；`toneMapping = NoToneMapping`；背景色用 meta 的 `background`。**不要**开 `preserveDrawingBuffer`、`logarithmicDepthBuffer`、`shadowMap`。
   - 场景里不加任何灯。
   - 相机：`PerspectiveCamera`，`fov`、`near`、`far` 取 meta；位置和朝向取 `stops.overview`；宽高比取画布的 CSS 宽高。
   - 画布大小跟随外框：用 `ResizeObserver`，`renderer.setSize(w, h, false)`，并更新相机宽高比。
   - 遍历模型，把名字以 `B_` 开头的 Mesh 收进一张「楼号 → Mesh」的表。
   - `project(point)` 把一个场景坐标换成**视口**里的坐标（画布的 `getBoundingClientRect()` 加上投影位置）；`window.__campus3d.projectPoint` 指向它。
3. `CampusHero.vue`：`mode` 为 `scene` 时，`status` 置 `loading`，用 `await import('@/campus3d/scene')` 动态加载（**文件顶部不许静态 import 它**），模型地址用 `/campus3d/campus.glb?v=<meta.version>`。第一帧画完后 `status` 置 `ready`，画布透明度 400 毫秒从 0 到 1，盖在海报上面；海报留在 DOM 里。
4. 加载条按 4.5 节，`ready` 后隐藏。
5. 失败处理：加载出错、15 秒没完成、收到 `webglcontextlost`，都算失败。`status` 置 `error`，移除画布，显示 `campus-error`（文字「3D 加载失败，已显示静态图」）和 `campus-retry`。
6. 销毁：组件卸载或切回静态版时调用 `dispose()`，里面要做全：取消动画帧请求、断开所有监听和观察器、释放全部几何体、材质、贴图、`renderer.dispose()`、`renderer.forceContextLoss()`。
7. three 的对象（渲染器、场景、相机、Mesh）不许放进 Vue 的 `ref` 或 `reactive`，用普通变量存。
8. 把 4.3 节的字段补全。
9. `scripts/check-bundle.mjs`，加进 `verify`（放在 `build` 之后），任何一条不满足就以非 0 退出：
   - `dist/assets/index-*.js` 里没有字符串 `WebGLRenderer`。
   - `index-*.js` gzip 不超过 44 kB；`HomeView-*.js` gzip 不超过 9 kB。
   - 含 `WebGLRenderer` 的块 gzip 合计不超过 200 kB。
   - `src/` 里出现 `from "three` 或 `from 'three` 的文件只有 `src/campus3d/scene.ts`。
   - `tests/` 里没有 `.skip(`、`.only(`、`.fixme(`。

**验证**：`tests/e2e/scene.spec.ts`，全部用 `/?3d=1` 打开
1. 20 秒内 `status === 'ready'`；`buildingCount` 等于 meta 里 `buildings` 的条数；`hotspotCount === 5`。
2. **画布不是空白**：先用 `page.addStyleTag` 把 `[data-testid=campus-overlay]` 设为 `visibility:hidden`，对 `campus-canvas` 截图，用 pngjs 解码后统计：与背景色不同的像素（RGB 三个通道与背景色之差的绝对值加起来大于 24）占比大于 15%；亮度标准差大于 5。
3. **海报对位**：对 5 个热点调用 `__campus3d.projectPoint(热点的 anchor)`，换算成相对外框的归一化坐标，与 meta 的 `posterDesktop` 相差小于 0.02。
4. `ready` 后画布的计算样式 `opacity` 为 `1`（等过渡结束），`campus-poster` 仍在 DOM 里。
5. **失败回退**：拦截并中断 `**/campus.glb*`，结果 `status === 'error'`，海报可见，重试按钮可见，`pageerror` 0 次。解除拦截后点重试，变成 `ready`。
6. **懒加载**：用 `/?3d=0` 打开，等网络空闲。所有 `.js` 响应的正文都不含 `WebGLRenderer`，也没有 `.glb` 请求。
7. **反复进出**：`/?3d=1` 等 `ready` → 点导航去「服务目录」→ 浏览器后退 → 等 `ready`，重复 6 次。控制台没有 error，也没有含 `Too many active WebGL contexts` 的消息。
8. 把视口从 1440 宽改成 1100 宽，第 3 条仍然成立。

截图存 `docs/3d/shots/S5-desktop.png`。

**反向验证**：把相机的 `fov` 临时加 10，第 3 条必须变红；改回。

### S6 镜头：停靠点、过渡、按需渲染

**目标**：镜头在停靠点之间平滑移动；不动的时候一帧都不画。

1. `src/campus3d/camera.ts`（纯函数）：`easeInOutCubic(t)`；`lerpStop(a, b, t)` 对 `position` 和 `target` 逐分量线性插值。
2. `goTo(stop)`：900 毫秒，从**当前实际位置**出发（移动中途再次调用也不许跳变），进度先过 `easeInOutCubic` 再插值。`reducedMotion` 为真或 `immediate` 为真时直接到位。到位后 `moving` 为 `false`。
3. **按需渲染**：只在这些时候请求下一帧——镜头在移动、高亮刚变化、画布尺寸刚变化。其余时间不调用 `requestAnimationFrame`。
4. `CampusHero.vue`：`activeBoard` 变成某个板块**且 `activeSource` 是 `tile`** → `goTo(该热点的 stop)`；`activeBoard` 变成 `null` → 等 600 毫秒，仍是 `null` 才 `goTo('overview')`（鼠标在按钮之间移动时不许来回抽动）。来源是 `marker` 时镜头不动。
5. `status` 为 `ready` 时，标记的位置改为跟随场景：在 `onFrame` 回调里用 `project(热点的 anchor)` 更新 5 个标记的位置；`visible` 为 `false` 的隐藏。

**验证**
- `tests/unit/camera.test.ts`：`easeInOutCubic` 在 0、0.5、1 处分别是 0、0.5、1，在 0 到 1 上取 21 个点单调不减；`lerpStop` 在 `t=0` 等于起点、`t=1` 等于终点、`t=0.5` 是中点。
- `tests/e2e/camera.spec.ts`（`/?3d=1`）：
  1. 鼠标移到「图书馆」按钮，等 `moving === false`：`stop === 'lib'`，`camera.position` 与 `meta.stops.lib.position` 各分量相差小于 0.5。
  2. 这次移动期间 `frames` 增加了至少 10。到位后等 1 秒，再过 1 秒，`frames` 的增量为 0。
  3. 鼠标移到页面空白处，3 秒内 `stop === 'overview'` 且 `moving === false`。
  4. `emulateMedia({ reducedMotion: 'reduce' })` 后用 `/?3d=1` 打开，鼠标移到按钮上，200 毫秒内已到位。
  5. 停在 `lib` 时，`campus-marker-05` 的中心与 `projectPoint(该热点的 anchor)` 相差小于 3 像素（坐标从 meta 读，不要写死）。
  6. 每隔 100 毫秒依次移到 5 个按钮上，最后停在「图书馆」：最终 `stop === 'lib'`，控制台没有 error。
  7. 在 `overview` 把鼠标移到 `campus-marker-02` 上：`activeBoard === '教务'`，1 秒后 `stop` 仍是 `overview`，`moving === false`（标记来源不动镜头）。

**反向验证**：把「空闲时不请求下一帧」临时改成一直请求，第 2 条必须变红；改回。

### S7 联动：高亮、拾取、点击

**目标**：板块按钮和楼之间双向联动，这是这个功能的主体。

1. `setHighlight(board)`：给该板块的楼换上一个**克隆的**材质，颜色设为 `#e2001a`；换别的楼或传 `null` 时，把原来那栋换回共用材质，并释放克隆出来的材质。任何时候 `highlightMaterials` 不超过 1。
2. 画布上的 `pointermove`（每帧最多处理一次）：只对 5 栋热点楼做射线检测。射线的坐标用**画布自己的** `getBoundingClientRect()` 换算，不要用 `window.innerWidth`。命中时 `hoveredBoard` 为该板块，鼠标指针变成 `pointer`；没命中或 `pointerleave` 时为 `null`。
3. 点击：按下和抬起的位置相差小于 5 像素才算点击；命中热点楼时触发 `onPick`，`CampusHero` 里跳到 `/services?board=…`。
4. 画布上的悬停把 `activeBoard` 设为该板块、`activeSource` 设为 `canvas`。按 4.4 节的规则，这时**只高亮，镜头不动**。任何来源的 `activeBoard` 变化都要调用 `setHighlight`。
5. 无障碍：外框里放一个 `aria-live="polite"` 的隐藏区域，`activeBoard` 变化时写入「图书馆（总馆），对应板块：图书馆」这样的文字。

**验证**：`tests/e2e/interact.spec.ts`（`/?3d=1`，截图前都先隐藏 `campus-overlay`）
1. 没有高亮时对画布截图，「红色像素」（R > 170、G < 70、B < 70）的占比小于 0.0005。鼠标移到「教务」按钮并等镜头到位后，占比大于 0.003。
2. 取 `projectPoint(图书馆热点的 pick)`，把鼠标移到这个点：`hoveredBoard === '图书馆'`；第 5 个板块按钮有 `is-active`；`stop` 仍是 `overview` 且 `moving === false`；画布的 `cursor` 样式是 `pointer`。
3. 在这个点点击：地址变成 `/services?board=图书馆`。
4. 把鼠标移到画布左上角内侧 5 像素处：`hoveredBoard === null`，没有按钮带 `is-active`。
5. 在热点楼上按下，移动 30 像素再抬起：地址不变。
6. 对 5 个热点逐个做第 2 条里的移动，`hoveredBoard` 都等于各自的板块（这一条证明 5 个点都能点到）。
7. 在 5 个按钮之间来回移动 20 次后：`highlightMaterials` 不超过 1；`geometries`、`textures` 与移动前相同。

截图存 `docs/3d/shots/S7-jw.png`（高亮「教务」时的外框）。

**反向验证**：把高亮色临时改成 `#ffffff`，第 1 条必须变红；改回。

**到这里做第二次人工验收（G2）。**

### S8 预算与健壮性

**目标**：把性能和异常情况钉死，以后改动不会悄悄变差。

`tests/e2e/budget.spec.ts`（`/?3d=1`）：
1. `ready` 后 `drawCalls` 不超过 120，`triangles` 不超过 300 000。
2. 从开始导航到 `ready` 不超过 8 秒（无头软件渲染下的宽松值）。
3. **上下文丢失**：在页面里对 `campus-canvas` 取 `getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()`，2 秒内 `status === 'error'`，海报可见。
4. 点 `campus-toggle`（「仅看静态图」）：`status === 'static'`，页面里没有 `campus-canvas`，`localStorage` 的 `shzu.campus3d` 是 `off`；接着打开 `/`（不带参数），`reason === 'user-off'`。
5. 切到「服务目录」页后等 1 秒，`window.__campus3d.frames` 不再变化。
6. `npm run verify` 里的 `check-bundle` 通过。

这一步只许为了通过上面几条而改代码，不加新功能。

**反向验证**：把第 1 条的 120 临时改成 1，必须变红；改回。

### S9 收尾

1. `README.md` 加一节「首页校园沙盘」：功能说明、`?3d=1` / `?3d=0`、回退规则表、数据署名（照抄 meta 的 `attribution`）、怎么跑 `npm run verify`。
2. 用 Playwright 出一组截图到 `docs/3d/shots/`：`final-overview.png`、五个停靠点各一张（`final-xg.png` 等）、`final-static.png`（`/?3d=0`）、`final-mobile.png`（390×844）。
3. 接下来按 `docs/3d/INTEGRATION.md` 做集成：对着真实后端的系统测试、原有功能的回归、合并、演示前检查都在那一份里。本文的测试全绿只说明前端自己没问题，不代表演示用的那个地址上是好的。

**`INTEGRATION.md` 的 I0–I6 做完以后，做第三次人工验收（G3）。**

### S10 加分项（可选）

S9 和第三次人工验收都通过以后再做。两项互相独立，各自一次提交；哪一项的验证过不了，就单独回退那一项，不影响前面的成果。

**10a 用手转动沙盘**

1. 在画布上按住拖动：相机绕当前停靠点的 `target` 转动。水平方向每拖 1 像素转 0.12 度，向左向右最多各 28 度；竖直方向每像素 0.05 度，向上向下最多各 6 度。相机到 `target` 的距离不变。
2. 松手后 700 毫秒内平滑转回停靠点原位。`reducedMotion` 为真时直接回原位。
3. 拖动期间不做悬停拾取，也不触发点击（沿用 S7 第 3 条的 5 像素规则）。
4. 只在拖动和回弹期间渲染，回到原位后一帧都不画。
5. 调试钩子加字段 `orbit: { yaw: number, pitch: number }`，单位是度，在原位时都是 0。

验证：`tests/e2e/orbit.spec.ts`（`/?3d=1`）
1. 在画布中心按下，分 10 步向右拖 150 像素，不松手：`orbit.yaw` 的绝对值在 17 到 19 之间；相机到 `target` 的距离与拖动前相差小于 1%。
2. 继续拖到总共 600 像素：`orbit.yaw` 的绝对值不超过 28。
3. 松手后等 1.5 秒：`yaw`、`pitch` 都是 0，`camera.position` 与停靠点各分量相差小于 0.5；再等 1 秒，`frames` 没有变化。
4. 整个过程地址没有变（没有被当成点击）。
5. 拖到 150 像素不松手时，`campus-marker-05` 的中心与 `projectPoint(该热点的 anchor)` 相差小于 3 像素（标记跟着模型转）。
6. 之前所有测试仍然全绿。

反向验证：把水平上限 28 临时改成 90，第 2 条必须变红；改回。

**10b 高亮的楼微微抬起**

1. 一栋楼被高亮时，它的 Mesh 在 220 毫秒内沿 Y 轴升高 3 米；取消高亮时落回原位。效果像把模型上的一块拿起来看，楼原来的位置会露出一块暗色的底。
2. `reducedMotion` 为真时直接到位。
3. 调试钩子加字段 `lift`：当前被高亮的楼升高了多少米，没有高亮时是 0。

验证：`tests/e2e/lift.spec.ts`（`/?3d=1`）
1. 鼠标移到「教务」按钮，1.5 秒后 `lift` 在 2.99 到 3.01 之间。
2. 鼠标移开，2.5 秒后 `lift === 0`，再等 1 秒 `frames` 没有变化。
3. 之前所有测试仍然全绿（尤其是 S7 里逐个拾取 5 个热点的那一条）。

反向验证：把 3 米临时改成 0，第 1 条必须变红；改回。

---

## 7. 人工验收（自动测试管功能，这三次管好不好看）

每次把 `docs/3d/shots/` 里对应的截图（G2、G3 另加一段 20 秒的录屏）发给协助方，对照资产包附带的参考渲染图一起看。

**G1（S3 之后）静态版**
- 沙盘外框和下面五个板块按钮像一个整体，没有双线、没有错位。
- 五个编号和按钮上的 01–05 一一对应。
- 手机宽度下图不变形，标记没有压在一起。
- 没有引入瑞士风之外的东西（圆角、阴影、新颜色）。

**G2（S7 之后）交互**
- 海报换成 3D 的那一下，画面不跳、不闪白。
- 镜头移动平顺，鼠标在按钮之间扫过时不抽动。
- 高亮的红和页面上的红是同一个红。
- 鼠标指着楼的时候，画面是稳的。

**G3（`INTEGRATION.md` 的 I0–I6 做完之后）真机**
- Windows 上的 Chrome 和 Edge：默认进 3D，风扇不狂转，页面静止时任务管理器里 GPU 占用接近 0。
- 一台手机：是静态版，五个入口可点。
- 断网后刷新：停在静态图，有重试按钮。
- 换上资产包 v1 后重跑 `npm run verify`，不改代码就全绿。

---

## 8. 数字汇总

| 项目 | 上限 |
|---|---|
| `campus.glb` | 3 MB |
| 每张海报 | 300 KB |
| 主入口块 gzip | 44 kB（基线 41.6） |
| `HomeView` 块 gzip | 9 kB（基线 2.7） |
| 含 three 的块 gzip 合计 | 200 kB（three 加 GLTFLoader 实测约 158） |
| 绘制调用 | 120 |
| 三角面 | 300 000 |
| 设备像素比 | 2 |
| 空闲时每秒渲染帧数 | 0 |
| 镜头移动 | 900 毫秒 |
| 加载超时 | 15 秒 |

---

## 9. 待办池（本轮不做，做完 G3 再议）

- 首次进入时的一段入场镜头。
- 问答和服务目录里的「在沙盘上看位置」入口。
- 独立的 `/campus` 页面：全校范围、可旋转、可搜索楼名。
- 手机上的轻量 3D。

---

## 10. 常见的坑

1. **颜色发灰或过曝**：烘焙材质必须配 `outputColorSpace = SRGBColorSpace` 和 `toneMapping = NoToneMapping`，并且场景里不能有灯。
2. **一高亮全部楼都变红**：改了共用材质。必须克隆。
3. **鼠标指的位置和高亮的楼对不上**：射线坐标用了窗口尺寸。画布不是全屏，要用画布自己的矩形。
4. **来回切几次页面后 3D 不出来**：卸载时没有 `dispose()` 和 `forceContextLoss()`，浏览器的 WebGL 上下文用完了。
5. **页面明显变卡、控制台一串警告**：把 three 对象放进了 Vue 的响应式状态。
6. **首页变慢**：`scene.ts` 被静态 import 进了主包。`check-bundle` 会拦住。
7. **3D 和海报对不上**：外框宽高比不是 12:5，或者 `fov` 当成了水平视场角。
8. **鼠标指着楼时画面抖**：画布来源的悬停也移动了镜头，见 S7 第 4 条。
9. **风扇一直转**：每帧都在渲染。见 S6 第 3 条。
10. **`npm i -D vitest` 报依赖冲突**：没钉版本，装到了要求 Vite 6 的新版。用 `vitest@3.2.4`。
11. **自动测试里 3D 总是不出现**：无头浏览器是软件渲染，按规则进静态版。测 3D 的用例要用 `/?3d=1`。
