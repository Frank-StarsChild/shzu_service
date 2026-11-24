import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// W9：学院和五个板块。全部 /stage?3d=1&intro=0。
// 服务清单用本文件内的路由覆盖（后注册优先），不动 fixtures/api.ts。
// 学院名单按「学院号」逐条断言（同楼两所学院各占一行），不用旧的按楼去重推算。

const allMetaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/all/campus.meta.json", import.meta.url), "utf-8")
) as {
  shells: string[];
  colleges: { name: string; zone: string; buildingIds: string[]; confirmed: boolean }[];
  buildings: Record<string, { anchor?: [number, number, number]; name?: string }>;
};

const jjsMetaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/jjs/campus.meta.json", import.meta.url), "utf-8")
) as {
  colleges: { name: string; zone: string; buildingIds: string[] }[];
};

const zqMetaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/zq/campus.meta.json", import.meta.url), "utf-8")
) as {
  colleges: { name: string; zone: string; buildingIds: string[] }[];
  hotspots: { no: string; buildingId: string }[];
  buildings: Record<string, { name?: string }>;
};

/** 每个校区面板应当出现的真实名单（按学院号排序；空楼号 = 位置待确认） */
const ROWS: Record<string, { name: string; buildingId: string }[]> = {
  BQ: [
    { name: "食品学院", buildingId: "BQ-B025" },
    { name: "信息科学与技术学院", buildingId: "BQ-B013" },
    { name: "生命科学学院", buildingId: "BQ-B110" },
    { name: "继续教育学院", buildingId: "BQ-B032" },
  ],
  BY: [
    { name: "机械电气工程学院", buildingId: "BY-B029" },
    { name: "水利建筑工程学院", buildingId: "BY-B029" },
    { name: "农学院", buildingId: "BY-B032" },
    { name: "动物科技学院", buildingId: "BY-B027" },
  ],
  ZQ: [
    { name: "化学化工学院", buildingId: "ZQ-B032" },
    { name: "理学院", buildingId: "ZQ-B020" },
    { name: "马克思主义学院", buildingId: "ZQ-B014" },
    { name: "法学院", buildingId: "ZQ-B018" },
    { name: "外国语学院", buildingId: "ZQ-B013" },
    { name: "体育学院", buildingId: "ZQ-B039" },
    // 跨区教学楼（学院归属北区）
    { name: "生命科学学院", buildingId: "ZQ-B031" },
  ],
  NQ: [
    { name: "医学院", buildingId: "NQ-B012" },
    { name: "药学院", buildingId: "NQ-B016" },
    { name: "公共卫生学院", buildingId: "" },
    { name: "临床医学院", buildingId: "FY-B041" },
    { name: "护理学院（筹）", buildingId: "" },
  ],
  DQ: [{ name: "经济与管理学院", buildingId: "DQ-B009" }],
  JJ: [
    { name: "师范学院", buildingId: "JJ-B018" },
    { name: "文学艺术学院", buildingId: "JJ-B019" },
    { name: "能源与材料学院", buildingId: "JJ-B006" },
    { name: "城市与环境学院", buildingId: "JJ-B013" },
  ],
};

/** 面板行数 + 每行的名字 + data-college-no 顺序 */
async function expectRows(page: Page, zone: keyof typeof ROWS) {
  const rows = ROWS[zone];
  await expect(page.locator('[data-testid^="stage-college-"]')).toHaveCount(rows.length);
  for (let i = 0; i < rows.length; i++) {
    const row = page.locator(`[data-testid="stage-college-${i + 1}"]`);
    await expect(row, `第 ${i + 1} 行`).toContainText(rows[i].name);
  }
  const nos = await page
    .locator('[data-testid^="stage-college-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-college-no")));
  expect(nos.length).toBe(rows.length);
  expect(new Set(nos).size).toBe(rows.length);
}

/** 服务清单的本地假数据：只有图书馆板块有 2 条（别的板块空 → 板块区别的场景用不到） */
async function mockBoardServices(page: Page) {
  await page.route("**/api/v1/services*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        services: [
          {
            service_id: "svc-lib-1",
            name: "图书借阅与续借",
            board: "图书馆",
            summary: "在借期限内可续借一次，须校园网内操作",
            evidence_ids: ["lib-loan-c4"],
            flow_id: null,
            data_status: "reviewed",
            sample_questions: ["一次能借几本书？", "到期了怎么续借？"],
          },
          {
            service_id: "svc-lib-2",
            name: "校外访问电子资源",
            board: "图书馆",
            summary: "通过学校 VPN 账号在校外访问图书馆电子资源",
            evidence_ids: ["lib-vpn-c1"],
            flow_id: null,
            data_status: "reviewed",
            sample_questions: ["校外怎么访问知网？"],
          },
        ],
        knowledge_version: "kb-test-000",
      }),
    });
  });
}

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function waitCamStill(page: Page, stopHint?: string, timeout = 30_000) {
  await page.waitForFunction(
    (s) =>
      window.__campus3d?.moving === false
      && (s === undefined || window.__campus3d?.stop === s)
      && window.__campus3d?.status === "ready",
    stopHint,
    { timeout, polling: 100 }
  );
}

async function waitAnswer(page: Page) {
  await page.waitForFunction(
    () => window.__campus3d?.mode === "answer" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 30_000, polling: 100 }
  );
}

/** 这一栋楼是外壳还是图钉 */
function shellOrPin(h: { shell: string | null; pin: string | null }, bid: string) {
  return h.shell === bid || h.pin === bid;
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await mockBoardServices(page);
});

test("1 点北区：面板含「北区」「109」；4 行学院；没有板块钮", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);

  const panel = page.locator('[data-testid="stage-campus-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("北区");
  await expect(panel).toContainText("109");
  await expectRows(page, "BQ");
  await expect(panel).toContainText("4 个学院");
  await expect(page.locator('[data-testid="stage-board-学工"]')).toHaveCount(0);
});

test("2 北区四行的学院号与楼名逐条对得上（不靠旧去重推算）", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);

  const nos = await page
    .locator('[data-testid^="stage-college-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-college-no")));
  expect(nos).toEqual(["4", "5", "10", "19"]);
  for (let i = 0; i < ROWS.BQ.length; i++) {
    const b = allMetaRaw.buildings[ROWS.BQ[i].buildingId];
    await expect(page.locator(`[data-testid="stage-college-${i + 1}"]`)).toContainText(b.name ?? "");
  }
});

test("3 点第一行学院：answer 态、楼变红（外壳或图钉）、楼的题签可见", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);

  const first = ROWS.BQ[0];
  await page.click('[data-testid="stage-college-1"]');
  await waitAnswer(page);

  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("answer");
  const h = await page.evaluate(() => ({
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    college: window.__campus3d.college,
  }));
  expect(shellOrPin(h, first.buildingId)).toBe(true);
  expect(h.college).toBe(4);
  await expect(page.locator(`[data-testid="stage-sign-${first.buildingId}"]`)).toBeVisible();
});

test("4 从 answer 点回北区：回 campus，外壳图钉都收，学院列表还在", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);
  await page.click('[data-testid="stage-college-1"]');
  await waitAnswer(page);

  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);
  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("campus");
  expect(await page.evaluate(() => window.__campus3d.shell)).toBeNull();
  expect(await page.evaluate(() => window.__campus3d.pin)).toBeNull();
  await expect(page.locator('[data-testid="stage-campus-panel"]')).toBeVisible();
  await expectRows(page, "BQ");
});

test("5 中区：五个板块页签；点图书馆：外壳 ZQ-B034、板块面板与服务清单；截图", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitCamStill(page);

  await expect(page.locator('[data-testid="stage-board-学工"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-board-教务"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-board-后勤"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-board-保卫"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-board-图书馆"]')).toBeVisible();

  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/W9-zq.png" });

  await page.click('[data-testid="stage-board-图书馆"]');
  await waitCamStill(page);
  expect(await page.evaluate(() => window.__campus3d.shell)).toBe("ZQ-B034");

  const boardPanel = page.locator('[data-testid="stage-board-panel"]');
  await expect(boardPanel).toBeVisible();
  await expect(boardPanel).toContainText("图书馆");
  await expect(boardPanel).toContainText("这个板块能办的事");
  await expect(boardPanel).toContainText("办理地点");
  const svcRows = await boardPanel.locator(".stage-svc").count();
  expect(svcRows, "服务行数等于假数据里图书馆板块的服务数").toBe(2);

  await page.screenshot({ path: "../docs/3d/shots/W9-lib.png" });
});

test("6 点示例问题：发出 chat 请求；面板换回回答面板", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitCamStill(page);
  await page.click('[data-testid="stage-board-图书馆"]');
  await waitCamStill(page);

  let chatPosts = 0;
  page.on("request", (r) => {
    if (r.url().includes("/api/v1/chat") && r.method() === "POST") chatPosts += 1;
  });
  await page.locator('[data-testid="stage-board-panel"] .stage-svc-q').first().click();

  await expect(page.locator('[data-testid="stage-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-board-panel"]')).toHaveCount(0);
  expect(chatPosts).toBe(1);
});

test("7 东区：学院列表只有一行，含经济与管理学院", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-DQ"]');
  await waitCamStill(page);

  await expectRows(page, "DQ");
});

test("8 将军山：再点一次进 campus；四所本区学院齐全；没有板块钮", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-JJ"]');
  await page.waitForFunction(
    () => window.__campus3d?.pack === "jjs" && window.__campus3d?.status === "ready",
    undefined,
    { timeout: 40_000, polling: 200 }
  );

  await page.click('[data-testid="stage-rail-JJ"]');
  await waitCamStill(page);
  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("campus");

  await expectRows(page, "JJ");
  expect(jjsMetaRaw.colleges.filter((c) => c.zone === "JJ").length).toBe(4);
  await expect(page.locator('[data-testid="stage-board-图书馆"]')).toHaveCount(0);
});

test("9 中区自己的沙盘：点地标题签落到热点楼；本区 6 + 跨区 1 行", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  // 换到中区自己的沙盘
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitCamStill(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await page.waitForFunction(
    () => window.__campus3d?.pack === "zq" && window.__campus3d?.status === "ready",
    undefined,
    { timeout: 40_000, polling: 200 }
  );

  // 点地标题签 05（图书馆）：answer 态、shell 等于 zq 元数据里 05 号热点的楼
  const hotspot05 = zqMetaRaw.hotspots.find((h) => h.no === "05")!;
  await page.locator('[data-testid="stage-landmark-05"]').click();
  await waitCamStill(page);
  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("answer");
  expect(await page.evaluate(() => window.__campus3d.shell)).toBe(hotspot05.buildingId);

  // 再点中区：回 campus，五个板块钮都在
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitCamStill(page);
  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("campus");
  for (const b of ["学工", "教务", "后勤", "保卫", "图书馆"]) {
    await expect(page.locator(`[data-testid="stage-board-${b}"]`)).toBeVisible();
  }
  await expectRows(page, "ZQ");
  await expect(page.locator('[data-testid="stage-campus-panel"]')).toContainText("6 个学院");
});

test("10 北苑新区：4 行；02/03 各一行、都落 BY-B029；共用标注；两枚灯牌错开", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BY"]');
  await waitCamStill(page);

  await expectRows(page, "BY");
  await expect(page.locator('[data-testid="stage-campus-panel"]')).toContainText("4 个学院");

  const row2 = page.locator('[data-college-no="2"]');
  const row3 = page.locator('[data-college-no="3"]');
  await expect(row2).toContainText("机械电气工程学院");
  await expect(row3).toContainText("水利建筑工程学院");
  await expect(row2).toContainText("工科楼");
  await expect(row3).toContainText("工科楼");
  await expect(row2).toContainText("共用");
  await expect(row3).toContainText("共用");

  // 灯牌：两枚，同楼横向错开
  const l2 = page.locator('[data-testid="stage-lantern-2"]');
  const l3 = page.locator('[data-testid="stage-lantern-3"]');
  await expect(l2).toBeVisible();
  await expect(l3).toBeVisible();
  const b2 = (await l2.boundingBox())!;
  const b3 = (await l3.boundingBox())!;
  expect(Math.abs(b2.x + b2.width / 2 - (b3.x + b3.width / 2))).toBeGreaterThan(24);
  // 角标与面板行号一致：一 / 二
  await expect(l2.locator(".stage-lantern-no")).toHaveText("一");
  await expect(l3.locator(".stage-lantern-no")).toHaveText("二");

  // 点 02：BY-B029、学院 2
  await row2.click();
  await waitAnswer(page);
  let h = await page.evaluate(() => ({
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    college: window.__campus3d.college,
    mode: window.__campus3d.mode,
  }));
  expect(shellOrPin(h, "BY-B029")).toBe(true);
  expect(h.college).toBe(2);

  // 回北苑新区点 03：还是 BY-B029，学院 3
  await page.click('[data-testid="stage-rail-BY"]');
  await waitCamStill(page);
  await page.locator('[data-college-no="3"]').click();
  await waitAnswer(page);
  h = await page.evaluate(() => ({
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    college: window.__campus3d.college,
    mode: window.__campus3d.mode,
  }));
  expect(shellOrPin(h, "BY-B029")).toBe(true);
  expect(h.college).toBe(3);
});

test("11 中区「跨区教学楼」落 ZQ-B031；回北区同一所学院落 BQ-B110", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitCamStill(page);

  const cross = page.locator('[data-college-no="10"]');
  await expect(cross).toContainText("生命科学学院");
  await expect(cross).toContainText("生命科学实验教学楼");
  await expect(cross).toContainText("学院归属北区");

  await cross.click();
  await waitAnswer(page);
  let h = await page.evaluate(() => ({
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    college: window.__campus3d.college,
  }));
  expect(shellOrPin(h, "ZQ-B031")).toBe(true);
  expect(h.college).toBe(10);

  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);
  await page.locator('[data-college-no="10"]').click();
  await waitAnswer(page);
  h = await page.evaluate(() => ({
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    college: window.__campus3d.college,
  }));
  expect(shellOrPin(h, "BQ-B110")).toBe(true);
  expect(h.college).toBe(10);
});

test("12 南区：本区 3 + 附属 2；临床落 FY-B041；护理/公卫不导航", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-NQ"]');
  await waitCamStill(page);

  await expectRows(page, "NQ");
  const panel = page.locator('[data-testid="stage-campus-panel"]');
  await expect(panel).toContainText("3 个学院");
  await expect(panel).toContainText("附属片区");
  await expect(page.locator('[data-college-no="23"]')).toContainText("第一附属医院");
  await expect(page.locator('[data-college-no="24"]')).toContainText("护理学院（筹）");
  await expect(page.locator('[data-college-no="24"]')).toContainText("位置待确认");
  await expect(page.locator('[data-college-no="22"]')).toContainText("位置待确认");

  const before = await page.evaluate(() => window.__campus3d.stop);
  // 护理学院（筹）：点击与 Enter 都不移动镜头（行是 aria-disabled，用 force 派发点击）
  await page.locator('[data-college-no="24"]').click({ force: true });
  await page.waitForTimeout(400);
  let h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    stop: window.__campus3d.stop,
    moving: window.__campus3d.moving,
  }));
  expect(h.mode).toBe("campus");
  expect(h.stop).toBe(before);
  expect(h.moving).toBe(false);
  await page.locator('[data-college-no="22"]').focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  h = await page.evaluate(() => ({
    mode: window.__campus3d.mode,
    stop: window.__campus3d.stop,
    moving: window.__campus3d.moving,
  }));
  expect(h.mode).toBe("campus");
  expect(h.stop).toBe(before);
  expect(h.moving).toBe(false);

  // 临床医学院：落到 FY-B041
  await page.locator('[data-college-no="23"]').click();
  await waitAnswer(page);
  h = await page.evaluate(() => ({
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
    college: window.__campus3d.college,
  }));
  expect(shellOrPin(h, "FY-B041")).toBe(true);
  expect(h.college).toBe(23);
});
