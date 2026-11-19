import { describe, expect, it } from "vitest";
import { easeInOutCubic, lerpStop } from "@/campus3d/camera";
import type { Stop } from "@/campus3d/meta";

// PLAN S6：缓动与插值纯函数。

const A: Stop = { position: [-341.72, 464.44, 885.18], target: [-27.33, 0, 179.05] };
const B: Stop = { position: [-255.19, 218.68, 480.26], target: [-43.97, 12.65, 114.42] };

describe("easeInOutCubic", () => {
  it("t=0 → 0；t=0.5 → 0.5；t=1 → 1", () => {
    expect(easeInOutCubic(0)).toBeCloseTo(0, 10);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
    expect(easeInOutCubic(1)).toBeCloseTo(1, 10);
  });

  it("在 [0,1] 上取 21 个点单调不减", () => {
    const points = Array.from({ length: 21 }, (_, i) => easeInOutCubic(i / 20));
    for (let i = 1; i < points.length; i++) {
      expect(points[i]).toBeGreaterThanOrEqual(points[i - 1]);
    }
  });
});

describe("lerpStop", () => {
  it("t=0 等于起点", () => {
    expect(lerpStop(A, B, 0)).toEqual(A);
  });

  it("t=1 等于终点", () => {
    expect(lerpStop(A, B, 1)).toEqual(B);
  });

  it("t=0.5 是中点（逐分量）", () => {
    const mid = lerpStop(A, B, 0.5);
    const expectMid = (a: number, b: number) => (a + b) / 2;
    for (const i of [0, 1, 2] as const) {
      expect(mid.position[i]).toBeCloseTo(expectMid(A.position[i], B.position[i]), 10);
      expect(mid.target[i]).toBeCloseTo(expectMid(A.target[i], B.target[i]), 10);
    }
  });
});
