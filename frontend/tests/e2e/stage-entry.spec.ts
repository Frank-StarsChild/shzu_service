import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// W6：把首页换成舞台。/?3d=1 → EntryView 判定进舞台；/?3d=0、窄窗口、点过「普通版」
// 走普通版（HomeView）。无头浏览器是 swiftshader 软件渲染（无 ?3d=1 时 decideMode 是
// software-gl 静态版，正好覆盖「低配设备首页走普通版」这条线）。

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

/** 第 4/5/7 条的舞台要 3D 就绪：等 pack 都加载好（scene.ts 创建场景时写入） */
async function waitPack(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.pack === "all", undefined, { timeout: 40_000 });
}

/** 断言当前页面是普通版白色首页（第 2/3/4 条共用） */
async function expectClassicHome(page: Page) {
  await expect(page.locator("h1.h-display")).toContainText("校园办事");
  await expect(page.locator(".board-tile")).toHaveCount(5);
  await expect(page.locator('[data-testid="stage"]')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 1440 打开 /?3d=1：进舞台，无 .topbar，加载的是全校沙盘", async ({ page }) => {
  await page.goto("/?3d=1");
  await expect(page.locator('[data-testid="stage"]')).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCount(0);
  await waitPack(page);
  expect(await page.evaluate(() => window.__campus3d.pack)).toBe("all");
});

test("2 /?3d=0：普通版首页（校园办事 · 5 个板块 · 无舞台）", async ({ page }) => {
  await page.goto("/?3d=0");
  await expectClassicHome(page);
});

test("3 1000 宽打开 /?3d=1：窄窗口走普通版", async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  await page.goto("/?3d=1");
  await expectClassicHome(page);
});

test("4 普通版的往返：点「普通版」去 /classic 并记住选择；点「校园」回舞台", async ({ page }) => {
  await page.goto("/?3d=1");
  await expect(page.locator('[data-testid="stage-nav-classic"]')).toBeVisible();
  await page.click('[data-testid="stage-nav-classic"]');

  await expect(page).toHaveURL(/\/classic/);
  await expect(page.locator(".topbar")).toHaveCount(1);
  await expect(page.locator(".board-tile")).toHaveCount(5);

  // 再打开 /?3d=1：仍是普通版（localStorage 记住了选择）
  await page.goto("/?3d=1");
  await expect(page.locator(".topbar")).toHaveCount(1);
  await expectClassicHome(page);

  // 点普通版顶栏的「校园」：清掉选择，回舞台（exact：顶栏里还有「校园对话」）
  await page.getByRole("link", { name: "校园", exact: true }).click();
  await expect(page.locator('[data-testid="stage"]')).toBeVisible();
  await expect(page.locator(".topbar")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("shzu.stage"))).toBeNull();
});

test("5 舞台点「服务」去普通版页面；后退回舞台，场景重新就绪", async ({ page }) => {
  await page.goto("/?3d=1");
  await expect(page.locator('[data-testid="stage-nav-services"]')).toBeVisible();
  await page.click('[data-testid="stage-nav-services"]');

  await expect(page).toHaveURL(/\/services/);
  await expect(page.locator(".topbar")).toHaveCount(1);
  // 普通版页面：暖白纸面（swiss.css 的 body 底色），没有被舞台样式带黑
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(251, 250, 248)");

  // 后退回舞台：不缓存（无 keep-alive），画布重新创建并就绪（W6 常见错误 2）
  await page.goBack();
  await expect(page).toHaveURL(/\/\?/);
  await expect(page.locator('[data-testid="stage"]')).toBeVisible();
  await waitReady(page);
});

test("6 /?3d=0 的普通版首页不加载舞台的代码：无 campus.glb，无 StageView 分包", async ({ page }) => {
  const glbUrls: string[] = [];
  const stageScripts: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(".glb")) glbUrls.push(r.url());
    if (r.url().endsWith(".js") && r.url().includes("StageView")) stageScripts.push(r.url());
  });

  await page.goto("/?3d=0");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  expect(glbUrls, `不应请求 .glb：${glbUrls.join(" | ")}`).toHaveLength(0);
  expect(stageScripts, `不应加载 StageView 分包：${stageScripts.join(" | ")}`).toHaveLength(0);
});

test("7 问一个问题后去 /chat，后退回舞台：面板保留那轮回答，镜头在首页机位不重飞", async ({ page }) => {
  // 本条要验证「后退回来 restore 出的旧回答不重新触发镜头」（W5 守卫）。
  // fixtures 的 sessions/*/messages 恒返回空，这里后注册一条带记忆的覆盖（LIFO 优先）。
  const saved: {
    request_id: string;
    seq: number;
    role: "user" | "assistant";
    status: string;
    text: string;
    response: Record<string, unknown> | null;
  }[] = [];

  await page.route("**/api/v1/sessions/*/messages", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: saved }),
    });
  });

  await page.route("**/api/v1/chat", async (route) => {
    const req = route.request();
    if (req.method() !== "POST") {
      await route.fallback();
      return;
    }
    const body = (req.postDataJSON() ?? {}) as { message?: string; request_id?: string; session_id?: string };
    const rid = body.request_id ?? "req-entry-test";
    const sid = body.session_id ?? "sess-stage-test";
    const answer = {
      session_id: sid,
      request_id: rid,
      trace_id: "trace-entry-test",
      knowledge_version: "kb-test-000",
      unknown_fields: [],
      status: "answer",
      answer: {
        blocks: [
          {
            kind: "office",
            text: "补办学生证：本人携带身份证和一张近照，到大学生活动中心南楼301-302室学生处窗口办理，当场领取。",
            citation_ids: ["xsz-1"],
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
          excerpt: "学生证遗失补办在大学生活动中心南楼 301-302 室学生处窗口受理。",
          time_condition: null,
        },
      ],
      timing_ms: 900,
    };
    saved.push({ request_id: rid, seq: 1, role: "user", status: "done", text: body.message ?? "", response: null });
    saved.push({ request_id: rid, seq: 2, role: "assistant", status: "done", text: "", response: answer });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(answer) });
  });

  await page.goto("/?3d=1");
  await waitReady(page);

  async function ask(text: string) {
    await page.fill('[data-testid="stage-input"]', text);
    await page.press('[data-testid="stage-input"]', "Enter");
  }

  // 有地点的回答：镜头会飞到大学生活动中心（stop ≠ home）
  await ask("学生证丢了去哪补办");
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("大学生活动中心南楼");
  await page.waitForFunction(
    () => window.__campus3d.stop !== "home" && window.__campus3d.moving === false,
    undefined,
    { timeout: 15_000 }
  );

  // 点「全部对话」离开
  await page.getByRole("link", { name: "全部对话" }).click();
  await expect(page).toHaveURL(/\/chat/);

  // 后退：页面重载，会话恢复，面板还是那一轮；镜头不重飞（W5 守卫），在首页机位
  await page.goBack();
  await expect(page).toHaveURL(/\/\?/);
  await waitReady(page);
  const h = await page.evaluate(() => ({
    stop: window.__campus3d.stop,
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    mode: window.__campus3d.mode,
  }));
  await expect(page.locator('[data-testid="stage-panel"]')).toContainText("大学生活动中心南楼");
  expect(h.stop).toBe("home");
  expect(h.shell).toBeNull();
  expect(h.pin).toBeNull();
  expect(h.mode).toBe("home");
});
