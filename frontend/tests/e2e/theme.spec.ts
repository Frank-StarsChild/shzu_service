import { expect, test } from "@playwright/test";

// 主题体系（theme.css + stores/theme.ts + components/ThemeSwitch.vue）：
// - data-theme 挂在 <html> 上，color-scheme 同步；首次默认跟随系统
// - 手动选择持久化到 localStorage（shzu.theme）；刷新与跨页保持
// - 系统外观变化只在「跟随系统」时自动应用
// - 普通顶栏 / 舞台顶栏共用同一个切换组件（三段、aria-pressed）
// - 打印统一白底深字（夜间打印同样生效）

test("1 默认（无存储）：跟随系统，data-theme=light、日间暖纸白底", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("shzu.theme"));
  await page.goto("/classic");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("light");
  expect(await page.evaluate(() => document.documentElement.style.colorScheme)).toBe("light");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(246, 243, 234)");
});

test("2 点「夜间」：html[data-theme=dark]、墨蓝底、写入 localStorage", async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem("shzu.theme"));
  await page.goto("/classic");
  await page.click('[data-testid="theme-dark"]');
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("shzu.theme"))).toBe("dark");
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe("rgb(12, 20, 32)");
});

test("3 夜间直接打开 /chat：刷新与跨页保持；顶栏有同一个切换组件", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shzu.theme", "dark"));
  await page.goto("/chat");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  await page.reload();
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  await expect(page.locator('[data-testid="theme-switch"]')).toBeVisible();
  await page.goto("/services");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
});

test("4 跟随系统：系统外观变化自动应用；手动模式不被动覆盖", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shzu.theme", "system"));
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/classic");
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("light");
  // 手动选夜间后系统再变浅，保持手动选择
  await page.click('[data-testid="theme-dark"]');
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => document.documentElement.getAttribute("data-theme"))).toBe("dark");
});

test("5 顶栏与舞台共用同一个主题切换组件（三段、aria-pressed 标记当前）", async ({ page }) => {
  await page.goto("/classic");
  await expect(page.locator('[data-testid="theme-light"]')).toBeVisible();
  await expect(page.locator('[data-testid="theme-dark"]')).toBeVisible();
  await expect(page.locator('[data-testid="theme-system"]')).toBeVisible();
  expect(await page.locator('[data-testid="theme-system"]').getAttribute("aria-pressed")).toBe("true");
  // 舞台顶栏（静态模式 ?3d=0 也渲染顶栏）里的同一个组件
  await page.goto("/stage?3d=0");
  await expect(page.locator('.stage-top [data-testid="theme-switch"]')).toBeVisible();
  expect(await page.locator('.stage-top [data-testid="theme-system"]').getAttribute("aria-pressed")).toBe("true");
});

test("6 夜间打印预览：统一白底深字", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("shzu.theme", "dark"));
  await page.emulateMedia({ media: "print", colorScheme: "dark" });
  await page.goto("/classic");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(await page.evaluate(() => getComputedStyle(document.body).color)).toBe("rgb(17, 17, 17)");
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe("rgb(255, 255, 255)");
});
