import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMeta } from "@/campus3d/meta";
import type { Emblems } from "@/stage/emblems";
import { collegeEntries, indexOfCollege, stripParens } from "@/stage/collegeIndex";

const PUB = resolve(__dirname, "../../public/campus3d");

function meta(id: string) {
  const raw = JSON.parse(readFileSync(resolve(PUB, id, "campus.meta.json"), "utf-8")) as unknown;
  return parseMeta(raw);
}

const emblems = JSON.parse(
  readFileSync(resolve(PUB, "emblems/emblems.json"), "utf-8")
) as Emblems;

describe("collegeIndex · 面板与地图共用一份学院行", () => {
  it("1 北区：4 行，序号 1..4，楼都在本沙盘上", () => {
    const m = meta("bq");
    const rows = collegeEntries(m, emblems, "BQ");
    expect(rows.map((r) => r.index)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.name)).toEqual([
      "食品学院",
      "信息科学与技术学院",
      "生命科学学院",
      "继续教育学院",
    ]);
    for (const r of rows) {
      expect(m.buildings[r.buildingId], `${r.name} 的楼`).toBeTruthy();
      expect(r.anchor).not.toBeNull();
    }
  });

  it("2 北苑新区：机械/水利同楼归一行，行号一致，第二所学院也能找到行号", () => {
    const m = meta("by");
    const rows = collegeEntries(m, emblems, "BY");
    const both = rows.find((r) => r.buildingId === "BY-B029")!;
    expect(both).toBeTruthy();
    expect(both.colleges.map((c) => c.no)).toEqual([2, 3]);
    expect(both.emblem?.no).toBe(2);
    expect(indexOfCollege(rows, 2)).toBe(both.index);
    expect(indexOfCollege(rows, 3)).toBe(both.index);
  });

  it("3 中区沙盘：整包视图里生命科学学院用本沙盘上真有的那栋楼（不是别的片区的 B110）", () => {
    const m = meta("zq");
    const all = collegeEntries(m, emblems, null);
    const life = all.find((r) => r.name === "生命科学学院")!;
    expect(life.buildingId).toBe("ZQ-B031");
    expect(m.buildings[life.buildingId]).toBeTruthy();
    expect(life.anchor).not.toBeNull();
    // 校区态只看 ZQ 片区（生科的主楼归在北区），面板与地图仍同一份数据
    const campus = collegeEntries(m, emblems, "ZQ");
    expect(campus.some((r) => r.name === "生命科学学院")).toBe(false);
  });

  it("4 行号与地图角标同源：每个有院徽的行都能用学院号反查行号", () => {
    const m = meta("bq");
    const rows = collegeEntries(m, emblems, "BQ");
    for (const r of rows) {
      for (const c of r.colleges) {
        expect(indexOfCollege(rows, c.no)).toBe(r.index);
      }
    }
  });

  it("5 名字去括号", () => {
    expect(stripParens("信息科学与技术学院（网络空间安全学院）")).toBe("信息科学与技术学院");
  });
});
