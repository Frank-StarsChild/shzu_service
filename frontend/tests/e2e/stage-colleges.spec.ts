import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// W9：学院和五个板块。全部 /stage?3d=1&intro=0。
// 服务清单用本文件内的路由覆盖（后注册优先），不动 fixtures/api.ts。

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

/** 面板同款去重：zone 过滤后按第一栋楼去重（同楼只留先出现的） */
function collegesOfZone(meta: typeof allMetaRaw, zone: string) {
  const seen = new Set<string>();
  const rows: { name: string; buildingId: string }[] = [];
  for (const c of meta.colleges) {
    if (c.zone !== zone) continue;
    const bid = c.buildingIds[0];
    if (!bid || seen.has(bid)) continue;
    seen.add(bid);
    rows.push({ name: c.name, buildingId: bid });
  }
  return rows;
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

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await mockBoardServices(page);
});

test("1 点北区：面板含「北区」「109」；学院行数对；没有板块钮", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);

  const panel = page.locator('[data-testid="stage-campus-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("北区");
  await expect(panel).toContainText("109");
  const rows = await page.locator('[data-testid^="stage-college-"]').count();
  expect(rows).toBe(collegesOfZone(allMetaRaw, "BQ").length);
  await expect(page.locator('[data-testid="stage-board-学工"]')).toHaveCount(0);
});

test("2 每个序号标记的中心与 projectPoint(楼的 anchor) 差 ≤3px", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);

  const list = collegesOfZone(allMetaRaw, "BQ");
  for (let i = 1; i <= list.length; i++) {
    const mark = page.locator(`[data-testid="stage-mark-${i}"]`);
    const expectVisible = await mark.count();
    if (expectVisible === 0) continue;
    const box = (await mark.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const anchor = allMetaRaw.buildings[list[i - 1].buildingId].anchor!;
    const p = await page.evaluate(
      (pt) => {
        const r = window.__campus3d.projectPoint(pt);
        return { x: r.x, y: r.y, visible: r.visible };
      },
      anchor
    );
    expect(p.visible, `标记 ${i} 应在画面内`).toBe(true);
    expect(Math.hypot(cx - p.x, cy - p.y), `标记 ${i} 与投影距离`).toBeLessThan(3);
  }
});

test("3 点第一行学院：answer 态、楼变红（外壳或图钉）、楼的题签可见", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);

  const first = collegesOfZone(allMetaRaw, "BQ")[0];
  await page.click('[data-testid="stage-college-1"]');
  await waitCamStill(page);

  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("answer");
  const h = await page.evaluate(() => ({
    shell: window.__campus3d.shell,
    pin: window.__campus3d.pin,
  }));
  if (allMetaRaw.shells.includes(first.buildingId)) {
    expect(h.shell).toBe(first.buildingId);
  } else {
    expect(h.pin).toBe(first.buildingId);
  }
  await expect(page.locator(`[data-testid="stage-sign-${first.buildingId}"]`)).toBeVisible();
});

test("4 从 answer 点回北区：回 campus，外壳图钉都收，学院列表还在", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);
  await page.click('[data-testid="stage-college-1"]');
  await waitCamStill(page);

  await page.click('[data-testid="stage-rail-BQ"]');
  await waitCamStill(page);
  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("campus");
  expect(await page.evaluate(() => window.__campus3d.shell)).toBeNull();
  expect(await page.evaluate(() => window.__campus3d.pin)).toBeNull();
  await expect(page.locator('[data-testid="stage-campus-panel"]')).toBeVisible();
  const rows = await page.locator('[data-testid^="stage-college-"]').count();
  expect(rows).toBe(collegesOfZone(allMetaRaw, "BQ").length);
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

  const rows = await page.locator('[data-testid^="stage-college-"]').count();
  expect(rows).toBe(1);
  await expect(page.locator('[data-testid="stage-college-1"]')).toContainText("经济与管理学院");
});

test("8 将军山：再点一次进 campus；学院行数等于 jjs 元数据；没有板块钮", async ({ page }) => {
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

  const rows = await page.locator('[data-testid^="stage-college-"]').count();
  const jjsColleges = jjsMetaRaw.colleges.filter((c) => c.zone === "JJ");
  expect(rows).toBe(jjsColleges.length);
  await expect(page.locator('[data-testid="stage-board-图书馆"]')).toHaveCount(0);
});

test("9 中区自己的沙盘：点地标题签落到热点楼；板块与学院在中区沙盘上同样成立", async ({ page }) => {
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

  // 再点中区：回 campus，五个板块钮都在（板块楼就在这块沙盘的 ZQ 片区）
  await page.click('[data-testid="stage-rail-ZQ"]');
  await waitCamStill(page);
  expect(await page.evaluate(() => window.__campus3d.mode)).toBe("campus");
  for (const b of ["学工", "教务", "后勤", "保卫", "图书馆"]) {
    await expect(page.locator(`[data-testid="stage-board-${b}"]`)).toBeVisible();
  }
  // 学院行数等于 zq 元数据里 zone === 'ZQ' 的学院数（同楼去重后面板同款）
  const rows = await page.locator('[data-testid^="stage-college-"]').count();
  const zqColleges = collegesOfZone(zqMetaRaw as unknown as typeof allMetaRaw, "ZQ");
  expect(rows).toBe(zqColleges.length);
});
