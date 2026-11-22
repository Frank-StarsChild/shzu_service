// ALIVE A1 验证：自查排版（?emblems=1）两行院徽的鎏金/本色、mask 生效、404 降级。
// 像素统计用 node:zlib 手写的最小 PNG 解码（不引新依赖）；固定夜间主题（参考图口径）。
import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { mockApi } from "./fixtures/api";

async function waitReady(page: Page) {
  await page.waitForFunction(() => window.__campus3d?.status === "ready", undefined, { timeout: 40_000 });
}

/** 最小 PNG 解码：只支持 8bit、RGB(2)/RGBA(6)，返回逐像素 RGB。 */
function decodePng(buf: Buffer): { w: number; h: number; rgb: Float64Array } {
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  let pos = 8;
  let w = 0, h = 0, colorType = 0;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("ascii");
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") break;
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (bpp === 0) throw new Error(`unsupported png colorType ${colorType}`);
  const stride = w * bpp;
  const out = Buffer.alloc(h * stride);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const row = raw.subarray(p, p + stride);
    p += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : out.subarray(0, 0);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  const rgb = new Float64Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = out[i * bpp];
    rgb[i * 3 + 1] = out[i * bpp + 1];
    rgb[i * 3 + 2] = out[i * bpp + 2];
  }
  return { w, h, rgb };
}

function rows(page: Page) {
  return page.locator('[data-testid="stage-emblem-sheet"] .stage-emblem-row');
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  // 固定夜间：像素统计以夜景璃底为背景（日间的浅色面板会混入白像素）
  await page.addInitScript(() => localStorage.setItem("shzu.theme", "dark"));
});

test("1 自查排版：里面有 48 枚，第一行全鎏金且 mask 指向蒙版图", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0&emblems=1");
  const sheet = page.locator('[data-testid="stage-emblem-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  await expect(sheet.locator('[data-testid^="stage-emblem-"]')).toHaveCount(48);
  const firstRow = rows(page).first();
  await expect(firstRow.locator('[data-testid^="stage-emblem-"]')).toHaveCount(24);
  for (let no = 1; no <= 24; no++) {
    await expect(firstRow.locator(`[data-testid="stage-emblem-${no}"]`)).toHaveAttribute("data-tone", "gilt");
  }
  // mask 生效：computed style 里的 mask-image 指向 -mask.png
  const masked = await firstRow.locator('[data-testid="stage-emblem-1"]').evaluate((node) => {
    const cs = getComputedStyle(node);
    return `${cs.maskImage} ${cs.webkitMaskImage}`;
  });
  expect(masked).toContain("-mask.png");
});

test("2 第二行：19、24 无原色回退鎏金，其余 22 枚本色且背景是 .webp", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0&emblems=1");
  const sheet = page.locator('[data-testid="stage-emblem-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  const secondRow = rows(page).nth(1);
  for (let no = 1; no <= 24; no++) {
    const one = secondRow.locator(`[data-testid="stage-emblem-${no}"]`);
    await expect(one).toHaveAttribute("data-tone", no === 19 || no === 24 ? "gilt" : "color");
    if (no !== 19 && no !== 24) {
      const bg = await one.evaluate((node) => getComputedStyle(node).backgroundImage);
      expect(bg, `no.${no} 的本色背景`).toContain(".webp");
    }
  }
});

test("3 像素统计：no.5 鎏金那枚金色像素 > 25%，纯白像素 < 2%", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0&emblems=1");
  const sheet = page.locator('[data-testid="stage-emblem-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  const gilt = rows(page).first().locator('[data-testid="stage-emblem-5"]');
  await expect(gilt).toBeVisible();
  const png = await gilt.screenshot();
  const { w, h, rgb } = decodePng(png);
  expect(w).toBeGreaterThan(0);
  let gold = 0, white = 0;
  const total = w * h;
  for (let i = 0; i < total; i++) {
    const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2];
    const bright = (r + g + b) / 3;
    if (bright > 120 && r > b + 30) gold++;
    if (r > 245 && g > 245 && b > 245) white++;
  }
  const goldShare = gold / total;
  const whiteShare = white / total;
  expect(goldShare, `金色像素占比 ${(goldShare * 100).toFixed(1)}%`).toBeGreaterThan(0.25);
  expect(whiteShare, `纯白像素占比 ${(whiteShare * 100).toFixed(1)}%`).toBeLessThan(0.02);
});

test("4 存档：整张自查排版截图 A1-sheet.png", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0&emblems=1");
  const sheet = page.locator('[data-testid="stage-emblem-sheet"]');
  await expect(sheet).toBeVisible({ timeout: 20_000 });
  mkdirSync("../docs/3d/shots", { recursive: true });
  await sheet.screenshot({ path: "../docs/3d/shots/A1-sheet.png" });
});

test("5 不带 emblems=1 不渲染自查排版；emblems.json 404 时舞台照常工作", async ({ page }) => {
  await page.goto("/stage?3d=1&intro=0");
  await waitReady(page);
  await expect(page.locator('[data-testid="stage-emblem-sheet"]')).toHaveCount(0);

  // 404 降级：院徽取不到也照样 ready、可问话
  await page.route("**/campus3d/emblems/emblems.json", async (route) => {
    await route.fulfill({ status: 404, contentType: "text/plain", body: "not found" });
  });
  await page.goto("/stage?3d=1&intro=0&emblems=1");
  await waitReady(page);
  await expect(page.locator('[data-testid="stage-dock"]')).toBeVisible();
  await expect(page.locator('[data-testid="stage-emblem-sheet"]')).toHaveCount(0);
});
