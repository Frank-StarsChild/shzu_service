# 把校园沙盘并入正式系统：集成计划

> 读者：项目作者本人，以及替他写代码的 agent。和 `PLAN.md` 一样，这里只给目标、步骤和检查办法，代码由作者和他的 agent 自己写。
> 什么时候做：`PLAN.md` 的 S0–S9 做完、第一次和第二次人工验收通过以后。`PLAN.md` 里 S9 的第 3、4、5 项以本文为准。
> 为什么单独写一份：`PLAN.md` 里的测试都是对着 `vite preview` 和假接口跑的，它们全绿只说明前端自己没问题。真正演示用的是后端伺服的页面，中间还隔着构建、拷贝、启动、合并几道手续，每一道都可能出错，而且出了错常常看不出来。本文把这几道手续逐个钉住。

---

## 1. 先弄清这个系统实际是怎么跑的

下面五条都是在这个仓库上实际跑出来的结果，不是推测。后面每一步检查都是冲着它们设的。

**事实 1：有两个地址，看到的不是同一份东西。**
- `http://127.0.0.1:5180` 是 Vite 开发服务器，直接读 `frontend/src` 的源码和 `frontend/public` 的资产，改了就生效。
- `http://127.0.0.1:8300` 是后端，它伺服的是 `frontend/dist`，也就是**上一次 `npm run build` 的产物**。改了代码不重新构建，这里还是旧页面。演示和部署用的是这个地址。

**事实 2：`frontend/dist` 不在 git 里。** 换一台机器、重新检出、做 Docker 镜像之前，都必须先构建。后端启动时如果 `frontend/dist` 不存在，就不会挂前端页面，之后再构建也要重启后端才生效。

**事实 3：找不到的文件，后端返回的是「200 加首页 HTML」，不是 404。** 实测：`dist` 里没有 `campus3d` 目录时，请求 `/campus3d/campus.glb`、`/campus3d/campus.meta.json`、`/campus3d/poster-desktop.jpg`，三个都返回状态码 200、类型 `text/html`、1089 字节的 `index.html`。
所以**「状态码是 200」不能当作文件存在的证据**。本文所有对地址的检查都要看内容：大小、开头几个字节、能不能解析。

**事实 4：后端返回 `campus.glb` 时，`Content-Type` 是 `text/plain`。** 这是正常的，three 的加载器不看这个头，实测能加载（45 栋楼，无报错）。**不要为了「修正」它去改后端**，也不要写检查它的断言。

**事实 5：后端不压缩。** 实测主入口脚本按 105 KB 原样传输。`PLAN.md` 里的 gzip 数字只用来防止体积悄悄变大，不代表实际传输量。实际首屏多出来的是：含 three 的脚本约 630 KB，模型 2.6 MB（只在进 3D 时才下载）。

**另外一个和沙盘无关、但会挡住部署的现有问题：** `backend/requirements.txt` 只列了 5 个包，而代码里用到了 `langchain_core`、`langchain`、`langchain_openai`、`langgraph`、`dotenv`。实测：新建一个干净的 Python 环境，只装 `requirements.txt`，`import backend.app.main` 报 `ModuleNotFoundError: No module named 'langchain_core'`。作者自己的机器能跑，是因为这些包以前手动装过。按 README 在新机器上装，或者用 `deployment/Dockerfile` 做镜像，都会启动失败。处理办法见 I7。

---

## 2. 规则

1. `PLAN.md` 第 5 节的规则继续有效，只做下面三处放宽：
   - 可以新增 `frontend/playwright.system.config.ts`、`frontend/playwright.off.config.ts`、`frontend/tests/system/`、`frontend/tests/e2e-off/`、`frontend/scripts/check-dist.mjs`、`frontend/scripts/write-build-info.mjs`、仓库根目录的 `.gitattributes`。
   - 可以改 `frontend/package.json` 里的 `build` 和 `verify` 脚本（只许按本文写的方式改）。
   - I7 里补 `backend/requirements.txt` 是唯一允许碰后端的地方，而且必须单独一次提交，不和沙盘的改动混在一起。
2. **检查地址时，状态码不算数，必须看内容。**（事实 3）
3. **不许为了让检查通过去改后端的回退逻辑、文件类型、端口。**
4. 每一步的命令输出原样贴进 `docs/3d/PROGRESS.md` 的「集成」一节。比赛要交工作日志，这些输出就是日志的一部分；没有贴输出的检查视为没做。
5. 一步一次提交，提交信息形如 `3d(I3): 构建产物检查`。
6. 出现下面任何一种情况，停下来问人，不要自己想办法绕：检查连续修三次不过；需要改规则 1 之外的文件；评测题的通过数比基线少；合并时有冲突。

**开工提示词**（每一步开一个新会话）：

```
你在仓库 shzu_service 里工作。先完整阅读 docs/3d/INTEGRATION.md 的第 1、2 节和步骤 I<N>，再读 docs/3d/PROGRESS.md。
本次只做步骤 I<N>。做完它的「检查」和「反向验证」，把命令输出原样贴进 PROGRESS.md 的「集成」一节，提交，然后停下。
遇到第 2 节规则 6 列出的情况，停下并说明。
```

---

## 3. 步骤

除非特别说明，命令都在 `frontend/` 目录下运行。后端的启动命令在仓库根目录运行：
Windows 是 `.\.venv\Scripts\python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8300`，macOS 是 `.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8300`。

### I0 开工前的条件

逐条确认，有一条不满足就停下：

1. 当前在 `feat/campus-3d` 分支，`git status --porcelain` 没有输出。
2. `npm run verify` 全绿。
3. `docs/3d/PROGRESS.md` 里有 S0 到 S9 每一步的记录，每条都写了反向验证。
4. 第一次、第二次人工验收已经通过，`PROGRESS.md` 里记了是谁、哪一天确认的。
5. `frontend/public/campus3d/` 里正好是四个文件，`docs/3d/ASSET_SHA256.txt` 存在。

### I1 资产进库的方式

**目标**：保证模型和图片进 git 以后不被改动、不被替换成别的东西。

1. 仓库根目录新建 `.gitattributes`，写三行：`*.glb binary`、`*.jpg binary`、`*.png binary`。
2. 确认 `frontend/public/campus3d/` 的四个文件已经提交，`frontend/dist` 没有被提交。

**检查**（在仓库根目录运行）
- `git check-attr binary frontend/public/campus3d/campus.glb` 的输出以 `binary: set` 结尾。
- `git ls-files frontend/public/campus3d` 正好输出四行。
- `git cat-file -s HEAD:frontend/public/campus3d/campus.glb` 输出的数字，等于 `docs/3d/ASSET_SHA256.txt` 对应版本的模型字节数，也等于磁盘上这个文件的大小（v1 是 2615012）。数字只有一两百的话，说明提交进去的是一个指针文件而不是模型本身。
- `git ls-files frontend/dist` 没有输出。

### I2 总开关

**目标**：演示现场万一出问题，能在一分钟内把首页恢复成没有沙盘的样子，其他功能不受影响。

1. 约定一个构建时的环境变量 `VITE_CAMPUS3D`。值为 `off` 时，`HomeView` 完全不渲染 `CampusHero`（用 `v-if`），页面和加沙盘之前一样；不设或是别的值，照常。代码里读 `import.meta.env.VITE_CAMPUS3D`。
2. 关闭时不许请求 `/campus3d/` 下的任何文件，不许加载含 three 的脚本。
3. 新建 `playwright.off.config.ts`：`testDir` 为 `tests/e2e-off`；端口 4174；`webServer` 的命令是 `npx vite build --outDir dist-off && npx vite preview --outDir dist-off --port 4174 --strictPort --host 127.0.0.1`，并在 `webServer.env` 里设 `VITE_CAMPUS3D: 'off'`（用 Playwright 自己的 `env` 选项传，这样 Windows 和 macOS 写法一样）；`webServer.timeout` 设 120000。
4. `.gitignore` 加一行 `frontend/dist-off/`。
5. `package.json` 加脚本 `test:off`（`playwright test -c playwright.off.config.ts`），并把它接到 `verify` 的最后。
6. README 的「首页校园沙盘」一节里写明怎么关：先设环境变量再构建。Windows PowerShell 是 `$env:VITE_CAMPUS3D='off'; npm run build; Remove-Item Env:VITE_CAMPUS3D`，然后刷新 8300 的页面。

**检查**：`tests/e2e-off/off.spec.ts`（接口用 `tests/e2e/fixtures/api.ts` 里的假数据）
1. 首页没有 `[data-testid=campus-hero]`；`h1.h-display` 含「校园办事」；`.board-tile` 恰好 5 个。
2. 等网络空闲后：没有任何请求的地址含 `/campus3d/`；所有 `.js` 响应的正文都不含 `WebGLRenderer`。
3. 鼠标依次移过 5 个板块按钮，再点第 5 个：地址变成 `/services?board=图书馆`，全程 `pageerror` 0 次。

`npm run verify` 全绿（原来的测试一条不少，加上这 3 条）。

**反向验证**：把 `playwright.off.config.ts` 里的 `'off'` 临时改成 `'on'`，`npm run test:off` 的第 1 条必须变红；改回。

### I3 构建产物检查

**目标**：构建完以后，用脚本确认 `dist` 是完整的、是从当前这次提交构建出来的。对付事实 1、2、3。

1. `scripts/write-build-info.mjs`：把 `{ "commit": 当前提交的完整哈希, "dirty": 工作区有没有未提交的改动, "builtAt": 时间 }` 写到 `dist/build-info.json`。`commit` 取 `git rev-parse HEAD`，`dirty` 看 `git status --porcelain` 有没有输出。
2. `package.json` 的 `build` 脚本改成在原来的命令后面接上 `&& node scripts/write-build-info.mjs`。
3. `scripts/check-dist.mjs`，任何一条不满足就打印是哪一条并以非 0 退出：
   - `dist/index.html` 存在，它引用的 `assets/index-*.js` 文件存在。
   - `dist/campus3d/` 里正好是四个文件，每个都和 `public/campus3d/` 里的同名文件逐字节相同（比 SHA-256）。
   - `campus.glb`、`poster-desktop.jpg`、`poster-mobile.jpg` 的 SHA-256 与 `docs/3d/ASSET_SHA256.txt` 里的一致；`campus.meta.json` 的 `version` 与该文件里 `version` 那一行一致。
   - `campus.glb` 开头 4 个字节是 `glTF`；两张海报开头 3 个字节是 `FF D8 FF`；`campus.meta.json` 能被 `JSON.parse`。
   - `dist/assets/` 里至少有一个脚本含 `WebGLRenderer`，而 `index-*.js` 不含。
   - `dist/build-info.json` 存在且能解析。
   - 带参数 `--release` 时再加两条：`build-info.json` 的 `dirty` 是 `false`；`commit` 等于此刻的 `git rev-parse HEAD`。
4. `package.json` 加脚本 `check:dist`（`node scripts/check-dist.mjs`）和 `check:release`（`node scripts/check-dist.mjs --release`）。把 `check:dist` 接进 `verify`，放在 `build` 之后。

**检查**
- `npm run verify` 全绿。
- 提交之后运行 `npm run build`，再运行 `npm run check:release`，通过。

**反向验证**（三条都要做，每条做完还原）
1. 把 `dist/campus3d/campus.glb` 删掉 → `npm run check:dist` 必须失败，并指出是这个文件。重新 `npm run build` 还原。
2. 往 `dist/campus3d/campus.meta.json` 末尾加一个空格 → 必须失败。重新构建还原。
3. 随便改一个源文件里的注释（不提交），重新 `npm run build` → `npm run check:release` 必须失败，原因是 `dirty`。用 `git checkout -- .` 还原后重新构建，`check:release` 恢复通过。

### I4 对着真实后端的系统测试

**目标**：在演示用的那个地址上，不用假接口，证明沙盘和原有功能一起工作。

1. 新建 `playwright.system.config.ts`：`testDir` 为 `tests/system`；**不配 `webServer`**（后端由人或上一条命令先启动）；`baseURL` 取环境变量 `SYSTEM_URL`，没有就用 `http://127.0.0.1:8300`；`workers: 1`；视口 1440×900；浏览器启动参数与 `playwright.config.ts` 相同。
2. `package.json` 加脚本 `test:system`（`playwright test -c playwright.system.config.ts`）。**不要**把它接进 `verify`，它需要后端在跑。
3. `tests/system/` 里**不许拦截任何 `/api` 请求**。

**检查**：`tests/system/system.spec.ts`，按下面的顺序写，前面的不过后面的没有意义：

1. **后端在线**：请求 `/api/v1/health/ready`，返回的 JSON 里 `status` 是 `ok`，`knowledge_version` 以 `kb-` 开头。连不上时，报错信息要写明「先在仓库根目录启动后端」。
2. **后端伺服的就是本机这次构建**：请求 `/` 得到的正文，与本机 `dist/index.html` 的内容完全相同；请求 `/build-info.json` 得到的 `commit`，与本机 `dist/build-info.json` 的相同。不相同时报错信息写明「8300 上不是这次的构建：先 npm run build，或者检查后端是不是从别的文件夹启动的」。
3. **四个资产地址返回的是真文件**（用 `page.request.get`，对每个地址都要查这几项）：
   - 响应头的类型不含 `text/html`；
   - 正文字节数等于本机 `dist/campus3d/` 里同名文件的大小；
   - `campus.glb` 开头是 `glTF`；两张海报开头是 `FF D8 FF`；`campus.meta.json` 能解析，且有 5 个热点。
   - **不要**断言 `campus.glb` 的类型是什么（事实 4）。
4. **静态版**：打开 `/?3d=0`，`campus-poster` 的 `naturalWidth` 是 1920；5 个标记都在；页面没有 `pageerror`。
5. **3D 版**：打开 `/?3d=1`，20 秒内 `__campus3d.status === 'ready'`；`buildingCount` 等于元数据里 `buildings` 的条数；5 个热点的 `projectPoint(anchor)` 换算成外框里的归一化坐标后，与 `posterDesktop` 相差小于 0.02。
6. **没有失败的请求**：第 5 条的整个过程里，`requestfailed` 事件 0 次；没有状态码 400 以上的响应；控制台没有 error。
7. **真实数据的联动**：在第 5 条的页面上，把鼠标移到图书馆热点的 `projectPoint(pick)` 并点击，地址变成 `/services?board=图书馆`；页面上 `.svc-row` 至少 2 行（其中 1 行是表头）；没有 `.err-text`。
8. **顶栏是真实数据**：`.topbar-meta` 的文字含 `kb-`。
9. **提问入口没坏**：回到首页，在输入框输入「借书」并提交，路径变成 `/chat`，页面上出现一个 `.turn.user`，文字含「借书」。只查到这里，不等模型回答。
10. **五个板块都通**：对 学工、教务、后勤、保卫、图书馆 逐个请求 `/api/v1/services?board=…`，每个返回的 `services` 都不是空数组。

运行顺序（**这五条命令就是以后每次演示前、每次部署前的固定流程**，中间任何一步之后又改了东西，就从第一条重来）：

```
git status --porcelain        # 必须没有输出
npm run build
npm run check:release
（在仓库根目录启动后端，等它就绪）
npm run test:system
```

**反向验证**（两条都要做）
1. 后端开着，把 `frontend/dist/campus3d` 文件夹临时改个名字 → `npm run test:system` 的第 3 条必须变红。**注意此时这三个地址的状态码仍然是 200**，把这一点连同输出一起记进 `PROGRESS.md`。改回名字。
2. 后端开着，改一个源文件再 `npm run build`（不提交）→ `npm run check:release` 必须失败。还原，重新构建。

### I5 原有功能没有被影响

**目标**：证明加了沙盘以后，问答、评测、响应时间都和原来一样。

1. 范围检查（在仓库根目录）：`git diff --stat main...HEAD -- backend data evaluation prompts scripts deployment start.bat` 没有输出。
2. 后端冒烟（在仓库根目录，Windows）：`.\.venv\Scripts\python.exe -X utf8 scripts\smoke_v1.py`，输出的最后一行是 `SMOKE v1 OK`。
3. 评测对比。模型的回答有随机性，所以要同一天在两个分支上各跑一次来比，不要拿 README 里的旧数字比：
   - 切到 `main`，构建、启动后端，运行 `evaluation\run_eval.py`，记下「核心题：x/50 通过」「边界题：y/25 通过」和「时延」那一行。
   - 切回 `feat/campus-3d`，构建、重启后端，再跑一次，记下同样三行。
   - 两次的核心题、边界题通过数必须相同；最大时延都在 5000 毫秒以内。
   - 没有配置模型密钥、跑不了评测时，在 `PROGRESS.md` 里写明「评测未运行，原因：……」，由作者决定，不要跳过不记。

**通过数比 `main` 少**：先在 `main` 上再跑一次确认是不是模型波动。确认不是波动就停下，不要合并。

### I6 合并

**目标**：并进 `main`，并证明仓库里提交的东西是齐的，换个文件夹检出来也能跑。

1. `git fetch`。如果 `main` 在这期间有新提交，把 `main` 合并进 `feat/campus-3d`（用合并，不用变基，保留完整的提交记录），然后重跑 `npm run verify` 和 I4 的五条命令。有冲突就停下问人。
2. 切到 `main`，`git merge --no-ff feat/campus-3d`，提交信息写 `合并首页校园沙盘`。
3. 打标签 `campus-3d-v1`。
4. **干净检出检查**：在仓库之外找个临时位置，`git clone <本仓库的本地路径> shzu_fresh`，进到 `shzu_fresh/frontend`，依次运行 `npm ci`、`npm run verify`。全绿以后删掉这个临时文件夹。
   这一步专门抓「本机能跑，是因为有文件没提交」：漏提交资产、测试、配置文件，这里都会失败。

**检查**
- 干净检出里的 `npm run verify` 全绿，通过的测试条数和原仓库里一样多。
- 在 `main` 上重跑 I4 的五条命令，全绿。
- `git log --oneline -1` 是合并提交；`git tag` 里有 `campus-3d-v1`。

**怎么撤回**：`git revert -m 1 <合并提交的哈希>`，然后重新构建。不要用 `reset`，不要强推。只想临时关掉沙盘的话用 I2 的总开关，不用撤回。

### I7 换一台机器或做镜像（用得到才做）

**目标**：在作者自己的机器之外也能启动。

1. 先解决第 1 节末尾说的依赖问题。这是后端的现有问题，在 `main` 上单独一次提交，提交信息 `fix(backend): 补全依赖清单`：
   - 在作者现在能跑的那个 `.venv` 里运行 `pip freeze`，找出 `langchain`、`langchain-core`、`langchain-openai`、`langgraph`、`python-dotenv` 这几行，连同版本号原样加进 `backend/requirements.txt`。只加这几个，不要把 `pip freeze` 的全部输出贴进去，也不要自己猜版本号。
2. **干净环境检查**：新建一个临时的 Python 虚拟环境（Python 版本与 `deployment/Dockerfile` 一致，3.12），只运行 `pip install -r backend/requirements.txt`，然后在仓库根目录用这个环境运行 `python -c "import backend.app.main"`。没有报错才算过。补依赖之前这一步会报 `No module named 'langchain_core'`，把补之前和补之后的输出都记下来。
3. 用 Docker 的话：先 `npm run build` 和 `npm run check:release`，再在仓库根目录 `docker compose -f deployment/docker-compose.yml up --build -d`，然后回到 `frontend/` 运行 `npm run test:system`。
   容器里没有 `.env`，模型密钥是空的，所以问答在容器里不可用。这和沙盘无关，记下来交给作者处理。`test:system` 的 10 条都不依赖模型回答，应当全绿。

不部署到别的机器、不用 Docker，就在 `PROGRESS.md` 里写「I7 不适用」，但第 1、2 项建议仍然做，否则 README 里的安装步骤是走不通的。

### I8 演示前（人来做，每次演示前都做一遍）

1. 跑 I4 的五条命令，全绿。
2. 在演示用的那台电脑、那个浏览器里打开 `http://127.0.0.1:8300/`（不带任何参数），按 F12 在控制台输入 `__campus3d.reason`：
   - `ok`：正常，会进 3D。
   - `software-gl`：浏览器没有用显卡。到浏览器设置里打开「使用硬件加速」后重启浏览器。远程桌面和虚拟机里通常就是这个值，那种环境下显示静态图是预期行为。
   - `small-viewport`：窗口太窄或者系统缩放太大。把浏览器窗口最大化，或者把页面缩放调到 100%。
   - `user-off`：以前点过「仅看静态图」。点「开启 3D 沙盘」，或者清掉这个站点的本地存储。
3. 接上投影后再看一遍第 2 条，投影的分辨率常常和电脑屏幕不一样。
4. 断开网络刷新页面，首页和沙盘照常显示（页面没有任何外部依赖）。
5. 演练一次总开关：按 I2 的写法关掉、刷新确认沙盘没了、再重新构建打开，记下来回各用了多久。
6. 确认 `start.bat` 开头的 `ROOT` 指向的就是现在这个仓库文件夹。指向别处的话，它启动的是另一份代码（I4 的第 2 条会报出来）。

---

## 4. 出了问题先看哪里

| 现象 | 最可能的原因 | 怎么确认 |
|---|---|---|
| 5180 上有沙盘，8300 上没有，或者是旧样子 | `dist` 是旧的（事实 1） | `npm run check:release` |
| 8300 上沙盘的位置是一张破图，没有编号标记 | `dist/campus3d` 不在或不全，后端返回了首页 HTML（事实 3） | `npm run check:dist`；I4 第 3 条 |
| 8300 上一直显示「3D 加载失败」，5180 正常 | `dist` 里的脚本和页面不是同一次构建的，或者浏览器缓存了旧页面 | 重新构建，浏览器强制刷新（Ctrl+F5） |
| 两个地址都一直是静态图 | 判定规则把这台设备分到了静态版 | 控制台看 `__campus3d.reason`，对照 I8 第 2 条 |
| 改了代码，`npm run test:e2e` 结果没变 | 测的是旧的构建产物 | 确认 `test:e2e` 脚本是先构建再测（`PLAN.md` S1） |
| `test:system` 第 2 条不过 | 后端是从另一个文件夹启动的，或者构建后没刷新 | 看 `start.bat` 的 `ROOT`；重启后端 |
| 新机器上后端起不来，报缺模块 | 依赖清单不全 | I7 第 1、2 项 |
| 合并以后别人检出来跑不了 | 有文件没提交 | I6 第 4 项的干净检出检查 |
| 来回切几次页面后 3D 不出来 | 卸载时没有释放 WebGL 上下文 | `PLAN.md` S5 第 7 条测试 |

---

## 5. 做完以后 `PROGRESS.md` 里应该有的东西

「集成」一节下，I0 到 I8 每步一小段，每段包含：提交哈希、实际运行的命令、命令输出的原文（长的截取首尾并注明）、反向验证的经过。另外单独列出：

- I5 里两次评测的三行结果（`main` 和 `feat/campus-3d` 各一组）。
- I6 干净检出时通过的测试条数。
- I7 补依赖前后两次干净环境检查的输出，或者「不适用」。
- I8 每次演示前的检查日期和 `__campus3d.reason` 的值。
