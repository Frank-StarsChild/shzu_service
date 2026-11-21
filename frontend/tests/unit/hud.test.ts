// W2 验证：hud.ts 纯函数（时辰、方位角、中文序号、读数坐标行）。
import { describe, expect, it } from "vitest";
import { azimuthDeg, cnNumber, coordText, shichen } from "@/stage/hud";

describe("shichen", () => {
  it("0→子时；1→丑时；12→午时；19/20→戌时；23→子时", () => {
    expect(shichen(0)).toBe("子时");
    expect(shichen(1)).toBe("丑时");
    expect(shichen(12)).toBe("午时");
    expect(shichen(19)).toBe("戌时");
    expect(shichen(20)).toBe("戌时");
    expect(shichen(23)).toBe("子时");
  });
});

describe("azimuthDeg", () => {
  it("正北 0；正东 90；正南 180；正西 270", () => {
    expect(azimuthDeg([0, 10, 100], [0, 0, 0])).toBeCloseTo(0, 6);
    expect(azimuthDeg([-100, 10, 0], [0, 0, 0])).toBeCloseTo(90, 6);
    expect(azimuthDeg([0, 10, -100], [0, 0, 0])).toBeCloseTo(180, 6);
    expect(azimuthDeg([100, 10, 0], [0, 0, 0])).toBeCloseTo(270, 6);
  });
});

describe("cnNumber", () => {
  it("1→一；10→十；11→十一；20→二十", () => {
    expect(cnNumber(1)).toBe("一");
    expect(cnNumber(10)).toBe("十");
    expect(cnNumber(11)).toBe("十一");
    expect(cnNumber(20)).toBe("二十");
  });
});

describe("coordText", () => {
  it("字母在前（meta 实际格式）：N 44.305° E 86.060° → 北纬 44.305° 东经 86.060°", () => {
    expect(coordText("N 44.305° E 86.060°")).toBe("北纬 44.305° 东经 86.060°");
  });
  it("数字在前：44.305° N 86.060° E → 同样输出", () => {
    expect(coordText("44.305° N 86.060° E")).toBe("北纬 44.305° 东经 86.060°");
  });
  it("解析不出来就原样返回", () => {
    expect(coordText("坐标待定")).toBe("坐标待定");
  });
});
