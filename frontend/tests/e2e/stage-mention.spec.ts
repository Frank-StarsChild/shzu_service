import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { mockApi } from "./fixtures/api";

// ALIVE A8：打字预判与跟着校区换示例问题。/stage?3d=1&intro=0，换到中区沙盘。

const zqMeta = JSON.parse(
  readFileSync(new URL("../../public/campus3d/zq/campus.meta.json", import.meta.url), "utf-8")
) as { buildings: Record<string, { anchor: [number, number, number] }> };

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

async function toZq(page: Page) {
  await page.click('[data-testid="stage-rail-ZQ"]');
  await page.click('[data-testid="stage-rail-enter"]');
  await page.waitForFunction(
    () => window.__campus3d?.pack === "zq" && window.__campus3d?.status === "ready",
    undefined,
    { timeout: 60_000 }
  );
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("6—8 打「法学院在哪」：灯牌放大、其余变暗、虚线圈；点提示落到 ZQ-B018", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await toZq(page);
  const before = await page.evaluate(() => ({
    stop: window.__campus3d?.stop,
    shell: window.__campus3d?.shell,
    pin: window.__campus3d?.pin,
  }));

  await page.locator('[data-testid="stage-input"]').type("法学院在哪");
  await page.waitForTimeout(400);

  const hook = await page.evaluate(() => ({
    mention: window.__campus3d?.mention,
    shell: window.__campus3d?.shell,
    pin: window.__campus3d?.pin,
    stop: window.__campus3d?.stop,
  }));
  expect(hook.mention).toBe("ZQ-B018");
  expect(hook.shell).toBeNull();
  expect(hook.pin).toBeNull();
  expect(hook.stop).toBe(before.stop);

  const mention = page.locator('[data-testid="stage-mention"]');
  await expect(mention).toContainText("法学院");
  await expect(mention).toContainText("会4");

  const emb = await page.locator('[data-testid="stage-lantern-16"] [data-testid="stage-emblem-16"]').boundingBox();
  expect(emb).not.toBeNull();
  expect(Math.abs(emb!.width - 50)).toBeLessThanOrEqual(1);
  const dim = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage-lantern-11"]') as HTMLElement;
    const cs = getComputedStyle(el);
    return { op: Number(cs.opacity), cls: el.className, tr: cs.transitionProperty, dur: cs.transitionDuration };
  });
  console.log("dim info", JSON.stringify(dim));
  expect(Math.abs(dim.op - 0.42)).toBeLessThanOrEqual(0.01);

  await expect(page.locator('[data-testid="stage-mention-ring"]')).toHaveCount(1);
  await page.screenshot({ path: "../docs/3d/shots/A8-mention.png" });

  // 7 虚线圈的 48 个点平均位置 ≈ projectPoint(anchor 的 y=1 处)
  const info = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage-mention-ring"]') as SVGPolygonElement;
    const pts = (el.getAttribute("points") ?? "").trim().split(/\s+/).map((s) => s.split(",").map(Number));
    return { n: pts.length, x: pts.reduce((a, p) => a + p[0], 0) / pts.length, y: pts.reduce((a, p) => a + p[1], 0) / pts.length };
  });
  expect(info.n).toBe(48);
  const anchor = zqMeta.buildings["ZQ-B018"].anchor;
  const target = await page.evaluate(
    (a) => window.__campus3d?.projectPoint?.([a[0], 1, a[2]]) ?? null,
    anchor
  );
  expect(target).not.toBeNull();
  expect(Math.hypot(info.x - target!.x, info.y - target!.y)).toBeLessThanOrEqual(4);

  // 8 点提示：落到 ZQ-B018，输入框里的字不动
  await mention.click();
  await page.waitForFunction(
    () => window.__campus3d?.mode === "answer" && window.__campus3d?.moving === false,
    undefined,
    { timeout: 30_000 }
  );
  expect(await page.evaluate(() => window.__campus3d?.shell)).toBe("ZQ-B018");
  await expect(page.locator('[data-testid="stage-input"]')).toHaveValue("法学院在哪");
});

test("9 清空输入：100ms 内提示消失、mention 归零", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await toZq(page);
  const input = page.locator('[data-testid="stage-input"]');
  await input.type("法学院在哪");
  await page.waitForTimeout(400);
  await expect(page.locator('[data-testid="stage-mention"]')).toHaveCount(1);

  await input.fill("");
  await page.waitForTimeout(100);
  await expect(page.locator('[data-testid="stage-mention"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__campus3d?.mention)).toBeNull();
});

test("10 输入法：拼音阶段不预判，上屏后 250ms 才预判", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await toZq(page);

  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage-input"]') as HTMLInputElement;
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.value = "fa";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__campus3d?.mention)).toBeNull();

  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage-input"]') as HTMLInputElement;
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    el.value = "法学院";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => window.__campus3d?.mention)).toBe("ZQ-B018");
});

test("11 选中北区：示例问题换成北区的学院问题", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await page.click('[data-testid="stage-rail-BQ"]');
  const examples = page.locator(".stage-example");
  await expect(examples.filter({ hasText: "食品学院在哪栋楼？" })).toHaveCount(1);
  await expect(examples.filter({ hasText: "这个校区有哪些学院？" })).toHaveCount(1);
});

test("12 输入法选词时按 Enter 只上屏，再按一次才发问", async ({ page }) => {
  let chatPosts = 0;
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/v1/chat")) chatPosts += 1;
  });
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);

  // 选词中（compositionstart 之后）提交表单：不应发请求
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage-input"]') as HTMLInputElement;
    el.focus();
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.value = "学生证";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    (el.closest("form") as HTMLFormElement).requestSubmit();
  });
  await page.waitForTimeout(300);
  expect(chatPosts).toBe(0);

  // 上屏后再提交：正常发问
  await page.evaluate(() => {
    const el = document.querySelector('[data-testid="stage-input"]') as HTMLInputElement;
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    el.value = "学生证丢了去哪补办";
    el.dispatchEvent(new Event("input", { bubbles: true }));
    (el.closest("form") as HTMLFormElement).requestSubmit();
  });
  await expect.poll(() => chatPosts, { timeout: 10_000 }).toBeGreaterThan(0);
});
