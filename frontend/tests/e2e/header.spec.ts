import { expect, test, type Page } from "@playwright/test";
import { mockApi } from "./fixtures/api";

// 全站共用顶栏 AppHeader：按钮在所有页面（含 3D 舞台）的位置一致。
// - 相同视口下，品牌、三个导航项、主题按钮的横向/纵向位置误差 ≤ 2px
//   （顶栏横向铺满布局视口、不做 maxw 居中，滚动条不造成偏移）
// - 选中态：首页 = ///classic//stage；校园对话 = /chat；服务目录 = /services 与 /workflows；
//   证据等来源不明页面不点亮任何项
// - 手机：品牌左、主题（紧凑）+ 菜单右；菜单顺序与桌面一致、点选即关闭
// - 主题切换只改颜色，不移动任何按钮

async function headerBoxes(page: Page) {
  const read = async (sel: string) => {
    const el = page.locator(sel).first();
    await expect(el).toBeVisible();
    const b = await el.boundingBox();
    expect(b, sel).toBeTruthy();
    return { x: b!.x, y: b!.y, w: b!.width, h: b!.height };
  };
  return {
    brand: await read('[data-testid="app-brand-seal"]'),
    home: await read('[data-testid="app-nav-home"]'),
    chat: await read('[data-testid="app-nav-chat"]'),
    services: await read('[data-testid="app-nav-services"]'),
    theme: await read('[data-testid="theme-switch"]'),
  };
}

function expectSame(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }, label: string) {
  expect(Math.abs(a.x - b.x), `${label} x`).toBeLessThanOrEqual(2);
  expect(Math.abs(a.y - b.y), `${label} y`).toBeLessThanOrEqual(2);
  expect(Math.abs(a.w - b.w), `${label} w`).toBeLessThanOrEqual(2);
  expect(Math.abs(a.h - b.h), `${label} h`).toBeLessThanOrEqual(2);
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("1 桌面 1440：舞台与普通各页的品牌/导航/主题按钮位置一致（误差 ≤2px）", async ({ page }) => {
  const pages = [
    "/?3d=1",
    "/classic",
    "/chat",
    "/services",
    "/workflows/national_inspirational_2025",
    "/sources/xg-lz-c1",
    "/unavailable",
  ];
  let first: Awaited<ReturnType<typeof headerBoxes>> | null = null;
  for (const p of pages) {
    await page.goto(p);
    await page.waitForTimeout(600);
    const boxes = await headerBoxes(page);
    if (!first) first = boxes;
    else {
      expectSame(boxes.brand, first.brand, `${p} 印章`);
      expectSame(boxes.home, first.home, `${p} 首页`);
      expectSame(boxes.chat, first.chat, `${p} 校园对话`);
      expectSame(boxes.services, first.services, `${p} 服务目录`);
      expectSame(boxes.theme, first.theme, `${p} 主题`);
    }
  }
  // 顶栏统一 64px 高、左右各留 28px（以首个页面为基准）
  expect(first!.brand.y).toBeGreaterThanOrEqual(13);
  expect(first!.brand.y).toBeLessThanOrEqual(15);
});

test("2 选中态：舞台/首页选中「首页」；向导保持「服务目录」；证据页不点亮任何项", async ({ page }) => {
  const activeOf = (sel: string) => page.locator(sel).getAttribute("aria-current");

  await page.goto("/?3d=1");
  await expect(await activeOf('[data-testid="app-nav-home"]')).toBe("page");
  expect(await activeOf('[data-testid="app-nav-chat"]')).toBeNull();
  expect(await activeOf('[data-testid="app-nav-services"]')).toBeNull();

  await page.goto("/classic");
  await expect(await activeOf('[data-testid="app-nav-home"]')).toBe("page");

  await page.goto("/chat");
  await expect(await activeOf('[data-testid="app-nav-chat"]')).toBe("page");
  expect(await activeOf('[data-testid="app-nav-home"]')).toBeNull();

  await page.goto("/services");
  await expect(await activeOf('[data-testid="app-nav-services"]')).toBe("page");

  // 进入向导保持「服务目录」选中
  await page.goto("/workflows/national_inspirational_2025");
  await expect(await activeOf('[data-testid="app-nav-services"]')).toBe("page");

  // 证据页从多处进入、来源不唯一：不点亮任何项
  await page.goto("/sources/xg-lz-c1");
  expect(await activeOf('[data-testid="app-nav-home"]')).toBeNull();
  expect(await activeOf('[data-testid="app-nav-chat"]')).toBeNull();
  expect(await activeOf('[data-testid="app-nav-services"]')).toBeNull();
});

test("3 切换选中项不挤动相邻按钮（下划线常驻、字重不变）", async ({ page }) => {
  await page.goto("/classic");
  const before = await headerBoxes(page);
  await page.click('[data-testid="app-nav-chat"]');
  await page.waitForTimeout(400);
  const after = await headerBoxes(page);
  expectSame(after.home, before.home, "首页");
  expectSame(after.services, before.services, "服务目录");
  expectSame(after.theme, before.theme, "主题");
});

test("4 主题切换不改变按钮位置", async ({ page }) => {
  await page.goto("/chat");
  const before = await headerBoxes(page);
  await page.click('[data-testid="theme-dark"]');
  await page.waitForTimeout(300);
  const dark = await headerBoxes(page);
  expectSame(dark.home, before.home, "夜间-首页");
  expectSame(dark.services, before.services, "夜间-服务目录");
  expectSame(dark.theme, before.theme, "夜间-主题");
  await page.click('[data-testid="theme-light"]');
});

test("5 手机 390：品牌左、主题（紧凑）+菜单右；菜单顺序与桌面一致且点选即关闭；无横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/classic");
  await page.waitForTimeout(600);

  // 布局：品牌在左，紧凑主题 + 菜单在右；桌面导航隐藏
  const brand = await page.locator('[data-testid="app-brand-seal"]').boundingBox();
  const theme = await page.locator('[data-testid="theme-switch"]').boundingBox();
  const menuBtn = await page.locator(".app-menu-toggle").boundingBox();
  expect(brand!.x).toBeLessThanOrEqual(16 + 2);
  expect(theme!.x).toBeGreaterThan(brand!.x);
  expect(menuBtn!.x).toBeGreaterThan(theme!.x);
  await expect(page.locator(".app-nav")).toBeHidden();

  // 主题入口只出现一处：抽屉里不再有第二个主题控件
  await page.locator(".app-menu-toggle").click();
  await expect(page.locator(".app-menu")).toBeVisible();
  await expect(page.locator(".app-menu [data-testid=\"theme-switch\"]")).toHaveCount(0);

  // 菜单顺序与桌面一致：首页、校园对话、服务目录
  const labels = await page.locator(".app-menu-link").allInnerTexts();
  expect(labels).toEqual(["首页", "校园对话", "服务目录"]);

  // 点「服务目录」：跳转且菜单关闭（点当前路由项也会关闭）
  await page.locator(".app-menu-link", { hasText: "服务目录" }).click();
  await expect(page).toHaveURL(/\/services/);
  await expect(page.locator(".app-menu")).toHaveCount(0);

  // 无横向溢出
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("6 手机紧凑主题：弹出三选仍可选日间/夜间/跟随系统", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/classic");
  await page.waitForTimeout(600);

  await page.locator('[data-testid="theme-compact"]').click();
  await expect(page.locator(".theme-pop")).toBeVisible();
  await page.locator('[data-testid="theme-dark"]').click();
  await expect(page.locator(".theme-pop")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("shzu.theme"))).toBe("dark");

  await page.locator('[data-testid="theme-compact"]').click();
  await page.locator('[data-testid="theme-light"]').click();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("light");
});

test("7 舞台顶栏与全站同一份按钮：观景/普通版在沙盘控制区（问话栏上方）", async ({ page }) => {
  await page.goto("/?3d=1");
  await page.waitForTimeout(800);
  await expect(page.locator('[data-testid="stage-top"]')).toContainText("石大智多星");
  await expect(page.locator('[data-testid="app-nav-chat"]')).toBeVisible();
  await expect(page.locator('[data-testid="app-nav-services"]')).toBeVisible();
  await expect(page.locator('[data-testid="theme-switch"]')).toBeVisible();
  // 舞台专用操作在问话栏控制区（不再占用顶栏）
  await expect(page.locator('[data-testid="stage-tool-classic"]')).toBeVisible();
  const tool = await page.locator('[data-testid="stage-tool-classic"]').boundingBox();
  const dock = await page.locator('[data-testid="stage-dock"]').boundingBox();
  expect(tool!.y).toBeGreaterThanOrEqual(dock!.y);
});
