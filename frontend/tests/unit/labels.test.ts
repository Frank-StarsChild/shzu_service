import { describe, expect, it } from "vitest";
import { layoutLabels, shiftOf, type LabelSpec } from "@/stage/labels";

const VP = { w: 1440, h: 900 };

function spec(over: Partial<LabelSpec> = {}): LabelSpec {
  return {
    id: "a",
    priority: 50,
    ax: 500,
    ay: 400,
    w: 100,
    h: 50,
    gap: 40,
    compactW: 30,
    compactH: 30,
    compactGap: 12,
    visible: true,
    movable: false,
    ...over,
  };
}

function overlaps(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe("labels · 统一避让", () => {
  it("1 空场：默认在锚点正上方，底边距锚点 = gap", () => {
    const [l] = layoutLabels([spec()], VP, []);
    expect(l.form).toBe("full");
    expect(l.x).toBe(450);
    expect(l.y).toBe(400 - 40 - 50);
    expect(l.x + l.w / 2).toBe(500);
    expect(l.y + l.h).toBe(360);
    expect(l.shifted).toBe(false);
  });

  it("2 右侧面板挡住默认位：可左右挪的标签让开，且不与遮挡矩形相交", () => {
    const reserved = [{ x: 540, y: 300, w: 200, h: 120 }];
    const [l] = layoutLabels([spec({ movable: true, axis: "x" })], VP, reserved);
    expect(l.form).toBe("full");
    expect(overlaps(l, reserved[0])).toBe(false);
    expect(Math.abs(l.x + l.w / 2 - 500)).toBeGreaterThan(20);
    const d = shiftOf(l);
    expect(Math.abs(d.dx)).toBeGreaterThan(0);
    expect(d.dy).toBe(0);
  });

  it("3 完整的放不下：缩成紧凑形态（小院徽/小序号）", () => {
    // 视口只剩一块 120×120 的空位：完整 100×50 加上下引线放不进，紧凑 30×30 可以
    const reserved = [
      { x: 0, y: 0, w: 1440, h: 250 },
      { x: 0, y: 430, w: 1440, h: 470 },
      { x: 0, y: 250, w: 460, h: 180 },
      { x: 560, y: 250, w: 880, h: 180 },
    ];
    const [l] = layoutLabels([spec({ ax: 500, ay: 430, movable: true, axis: "x" })], VP, reserved);
    expect(l.form).toBe("compact");
    expect(l.w).toBe(30);
    expect(l.gap).toBe(12);
  });

  it("4 实在放不下：hidden（面板仍保留入口）", () => {
    const reserved = [{ x: 0, y: 0, w: 1440, h: 900 }];
    const [l] = layoutLabels([spec()], VP, reserved);
    expect(l.form).toBe("hidden");
    expect(shiftOf(l)).toEqual({ dx: 0, dy: 0 });
  });

  it("5 优先级：高的占默认位，低的让开；同级按 id 稳定", () => {
    const a = spec({ id: "b", priority: 10 });
    const b = spec({ id: "a", priority: 90 });
    const out = layoutLabels([a, b], VP, []);
    const high = out.find((l) => l.id === "a")!;
    const low = out.find((l) => l.id === "b")!;
    expect(high.x).toBe(450);
    expect(low.form).toBe("hidden"); // 固定标签被高优先级占了默认位
  });

  it("6 固定标签（校区/地标）挪不了：被挡就收起，不会横向乱跑", () => {
    const reserved = [{ x: 350, y: 250, w: 300, h: 200 }];
    const [l] = layoutLabels([spec({ movable: false })], VP, reserved);
    expect(l.form).toBe("hidden");
  });

  it("7 只许向上：横向位置不变，引线仍是竖直的", () => {
    const reserved = [{ x: 350, y: 300, w: 300, h: 120 }];
    const [l] = layoutLabels([spec({ movable: true, axis: "y" })], VP, reserved);
    expect(l.form).toBe("full");
    expect(l.x + l.w / 2).toBe(500);
    const d = shiftOf(l);
    expect(d.dx).toBe(0);
    expect(d.dy).toBeGreaterThan(0);
  });

  it("8 上一帧位置可沿用：结果稳定，不来回跳", () => {
    const s = spec({ movable: true, axis: "x" });
    const first = layoutLabels([s], VP, []);
    const second = layoutLabels([s], VP, [], { [s.id]: first[0] });
    expect(second[0].x).toBe(first[0].x);
    expect(second[0].y).toBe(first[0].y);
  });

  it("9 投影不可见：直接 hidden", () => {
    const [l] = layoutLabels([spec({ visible: false })], VP, []);
    expect(l.form).toBe("hidden");
  });
});
