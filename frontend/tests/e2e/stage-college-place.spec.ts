// ALIVE A3 验证：落楼时按回答文字定学院（同楼多学院靠文字区分），
// 右侧「办理地点」左侧 48px 本色院徽，楼题签顶上一枚 44px 本色院徽；
// 学院列表每行的序号和名字之间一枚 24px 鎏金院徽。
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

const bqMetaRaw = JSON.parse(
  readFileSync(new URL("../../public/campus3d/bq/campus.meta.json", import.meta.url), "utf-8")
) as {
  buildings: Record<string, { anchor: [number, number, number] }>;
  look: { sign: { lift: number } };
};

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}
async function waitStill(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.moving === false, undefined, { timeout: 20_000 });
}
async function waitPack(page: Page, id: string) {
  await page.waitForFunction(
    (p) => window.__campus3d?.status === "ready" && window.__campus3d?.pack === p,
    id,
    { timeout: 40_000 }
  );
}
async function ask(page: Page, text: string) {
  await page.fill('[data-testid="stage-input"]', text);
  await page.press('[data-testid="stage-input"]', "Enter");
}

/** 信息学院那条假回答：正文里出现「信息科学与技术学院」，places.json 能对到 BQ-B013 */
async function mockCollegeAnswer(page: Page) {
  await page.route("**/api/v1/chat", async (route) => {
    const body = (route.request().postDataJSON() ?? {}) as { message?: string };
    if ((body.message ?? "").includes("信息学院")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          status: "answer",
          session_id: "sess-a3-test",
          request_id: "req-a3-test",
          trace_id: "trace-a3-test",
          knowledge_version: "kb-test-000",
          answer: {
            blocks: [
              {
                kind: "office",
                text: "信息科学与技术学院在北区绿2楼。",
                citation_ids: ["a3-info-c1"],
              },
            ],
            unknown_fields: [],
          },
          citations: [
            {
              id: "a3-info-c1",
              title: "信息科学与技术学院办公地点",
              issuer: "石河子大学信息科学与技术学院",
              url: "https://www.shzu.edu.cn/xx",
              published_at: "2025-09-01",
              locator: "第 1 条",
              excerpt: null,
              time_condition: null,
            },
          ],
          // 按需定位只认结构化动作（11-24 起）：补一张地点卡，楼号取自沙盘登记
          actions: [
            {
              kind: "place",
              title: "地点定位",
              ambiguous: false,
              matches: [{ building_id: "BQ-B013", label: "绿2", category: "教学", campus: "北区", note: "登记楼" }],
              fallback_text: null,
            },
          ],
          unknown_fields: [],
          timing_ms: 80,
        }),
      });
      return;
    }
    await route.fallback();
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await mockCollegeAnswer(page);
});

test("4 北区问信息学院：办理地点 48px 本色院徽、面板与楼题签都认这所学院", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  // 进北区自己的沙盘
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitStill(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "bq");
  await waitStill(page);
  await ask(page, "信息学院在哪栋楼？");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:BQ-B013" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 20_000 }
  );

  const place = page.locator('[data-testid="stage-panel-place"]');
  await expect(place.locator('[data-testid="stage-place-emblem"] [data-testid="stage-emblem-5"]'))
    .toHaveAttribute("data-tone", "color");
  await expect(place).toContainText("信息科学与技术学院");
  await expect(place).toContainText("绿2");
  await expect(page.locator('[data-testid="stage-sign-BQ-B013"] [data-testid="stage-sign-emblem"]'))
    .toBeVisible();
  expect(await page.evaluate(() => window.__campus3d?.college)).toBe(5);

  mkdirSync("../docs/3d/shots", { recursive: true });
  await page.screenshot({ path: "../docs/3d/shots/A3-college.png" });
});

test("5 楼题签上的院徽：中心对准 anchor 往上 lift 的投影（±3），且在文字框上方", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitStill(page);
  await page.click('[data-testid="stage-rail-enter"]');
  await waitPack(page, "bq");
  await waitStill(page);
  await ask(page, "信息学院在哪栋楼？");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:BQ-B013" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 20_000 }
  );
  await page.waitForTimeout(400);

  const a = bqMetaRaw.buildings["BQ-B013"].anchor;
  const target: [number, number, number] = [a[0], a[1] + bqMetaRaw.look.sign.lift, a[2]];
  const p = await page.evaluate((pt) => window.__campus3d.projectPoint(pt), target as unknown as number[]);
  const ebox = (await page.locator('[data-testid="stage-sign-emblem"]').boundingBox())!;
  const lbox = (await page.locator('[data-testid="stage-sign-BQ-B013"] .stage-sign-label').boundingBox())!;
  expect(Math.abs(ebox.x + ebox.width / 2 - p.x)).toBeLessThanOrEqual(3);
  expect(ebox.y + ebox.height).toBeLessThanOrEqual(lbox.y + 1);
});

test("6 落到的楼不是学院的楼（学生证→大学生活动中心）：没有院徽，仍是朱红小方块", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await ask(page, "学生证丢了去哪补办");
  await page.waitForFunction(
    () => window.__campus3d?.stop === "focus:ZQ-B023" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 20_000 }
  );
  await expect(page.locator('[data-testid="stage-panel-place"]')).toContainText("大学生活动中心");
  await expect(page.locator('[data-testid="stage-place-emblem"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-sign-emblem"]')).toHaveCount(0);
  await expect(page.locator('[data-testid="stage-panel-place"] .stage-place-square')).toBeVisible();
});

test("7 北区学院列表：每行序号和名字之间有一枚 24px 鎏金院徽", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  await waitStill(page);
  await page.waitForTimeout(400);
  const rows = page.locator('[data-testid^="stage-college-"]');
  const n = await rows.count();
  expect(n).toBe(4);
  for (let i = 0; i < n; i++) {
    const em = rows.nth(i).locator('[data-testid^="stage-emblem-"]');
    await expect(em).toHaveAttribute("data-tone", "gilt");
    const box = (await em.boundingBox())!;
    expect(Math.round(box.width)).toBe(24);
  }
});
