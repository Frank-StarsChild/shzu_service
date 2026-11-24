import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseMeta } from "@/campus3d/meta";
import type { Emblems } from "@/stage/emblems";
import {
  AFFILIATED_ZONES,
  affiliatedZonesOf,
  collegeEntries,
  indexOfCollege,
  stripParens,
} from "@/stage/collegeIndex";

const PUB = resolve(__dirname, "../../public/campus3d");

function meta(id: string) {
  const raw = JSON.parse(readFileSync(resolve(PUB, id, "campus.meta.json"), "utf-8")) as unknown;
  return parseMeta(raw);
}

const emblems = JSON.parse(
  readFileSync(resolve(PUB, "emblems/emblems.json"), "utf-8")
) as Emblems;

describe("collegeIndex · 校区学院名单（按学院号识别）", () => {
  it("1 北区：4 行、序号 1..4、每行都有自己的学院号与楼", () => {
    const m = meta("bq");
    const rows = collegeEntries(m, emblems, "BQ");
    expect(rows.map((r) => r.index)).toEqual([1, 2, 3, 4]);
    expect(rows.map((r) => r.no)).toEqual([4, 5, 10, 19]);
    expect(rows.map((r) => r.name)).toEqual([
      "食品学院",
      "信息科学与技术学院",
      "生命科学学院",
      "继续教育学院",
    ]);
    for (const r of rows) {
      expect(r.group).toBe("zone");
      expect(r.canLocate, r.name).toBe(true);
      expect(m.buildings[r.buildingId], `${r.name} 的楼`).toBeTruthy();
      expect(r.anchor).not.toBeNull();
    }
    expect(rows.find((r) => r.no === 10)!.buildingId).toBe("BQ-B110");
  });

  it("2 北苑新区：机电/水建各一行、都是工科楼 BY-B029，标「共用」，行号 1 / 2", () => {
    const m = meta("by");
    const rows = collegeEntries(m, emblems, "BY");
    expect(rows.map((r) => r.no)).toEqual([2, 3, 6, 7]);
    expect(rows.length).toBe(4);

    const mech = rows.find((r) => r.no === 2)!;
    const water = rows.find((r) => r.no === 3)!;
    expect(mech.name).toBe("机械电气工程学院");
    expect(water.name).toBe("水利建筑工程学院");
    expect(mech.buildingId).toBe("BY-B029");
    expect(water.buildingId).toBe("BY-B029");
    expect(mech.sharedBuilding).toBe(true);
    expect(water.sharedBuilding).toBe(true);
    expect(mech.index).toBe(1);
    expect(water.index).toBe(2);
    expect(mech.college?.no).toBe(2);
    expect(water.college?.no).toBe(3);
    expect(indexOfCollege(rows, 2)).toBe(1);
    expect(indexOfCollege(rows, 3)).toBe(2);
    // 农学院、动物科技学院各用自己那栋楼
    expect(rows.find((r) => r.no === 6)!.buildingId).toBe("BY-B032");
    expect(rows.find((r) => r.no === 7)!.buildingId).toBe("BY-B027");
    expect(rows.find((r) => r.no === 6)!.sharedBuilding).toBe(false);
  });

  it("3 中区（zq 沙盘选中）：本区 6 行 + 跨区教学楼 1 行，生科落到 ZQ-B031", () => {
    const m = meta("zq");
    const rows = collegeEntries(m, emblems, "ZQ");
    const zone = rows.filter((r) => r.group === "zone");
    const cross = rows.filter((r) => r.group === "cross");
    expect(zone.map((r) => r.no)).toEqual([1, 11, 15, 16, 17, 18]);
    expect(zone.length).toBe(6);
    expect(cross.map((r) => r.no)).toEqual([10]);
    const life = cross[0];
    expect(life.name).toBe("生命科学学院");
    expect(life.buildingId).toBe("ZQ-B031");
    expect(life.buildingName).toBe("生命科学实验教学楼");
    expect(life.homeZoneName).toBe("北区");
    expect(life.canLocate).toBe(true);

    // 整包视图（中区沙盘首页）里同样是这 7 所，每所一行
    const all = collegeEntries(m, emblems, null);
    expect(all.map((r) => r.no).sort((a, b) => a - b)).toEqual([1, 10, 11, 15, 16, 17, 18]);
  });

  it("4 全校沙盘选中中区：生科也归「跨区教学楼」并落到 ZQ-B031；选中北区则落 BQ-B110", () => {
    const m = meta("all");
    const zq = collegeEntries(m, emblems, "ZQ");
    const lifeZq = zq.find((r) => r.no === 10)!;
    expect(lifeZq.group).toBe("cross");
    expect(lifeZq.buildingId).toBe("ZQ-B031");

    const bq = collegeEntries(m, emblems, "BQ");
    const lifeBq = bq.find((r) => r.no === 10)!;
    expect(lifeBq.group).toBe("zone");
    expect(lifeBq.buildingId).toBe("BQ-B110");
  });

  it("5 南区：本区 3 行（公卫待确认）+ 附属 2 行（临床落 FY-B041、护理（筹）无楼）", () => {
    const m = meta("nq");
    expect(affiliatedZonesOf(m, "NQ")).toEqual(["FY", "HX"]);
    expect(AFFILIATED_ZONES.NQ).toEqual(["FY", "HX"]);

    const rows = collegeEntries(m, emblems, "NQ");
    const zone = rows.filter((r) => r.group === "zone");
    const aff = rows.filter((r) => r.group === "affiliated");

    expect(zone.map((r) => r.no)).toEqual([8, 9, 22]);
    const publicHealth = zone.find((r) => r.no === 22)!;
    expect(publicHealth.confirmed).toBe(false);
    expect(publicHealth.canLocate).toBe(false);
    expect(publicHealth.buildingId).toBe("");
    expect(publicHealth.college?.no).toBe(22);

    expect(aff.map((r) => r.no)).toEqual([23, 24]);
    const clinical = aff.find((r) => r.no === 23)!;
    expect(clinical.name).toBe("临床医学院");
    expect(clinical.buildingId).toBe("FY-B041");
    expect(clinical.homeZoneName).toBe("第一附属医院");
    expect(clinical.canLocate).toBe(true);

    const nursing = aff.find((r) => r.no === 24)!;
    expect(nursing.name).toBe("护理学院（筹）");
    expect(nursing.buildingId).toBe("");
    expect(nursing.canLocate).toBe(false);
    expect(nursing.confirmed).toBe(false);
    expect(nursing.college?.no).toBe(24);
    expect(nursing.college?.color ?? null).toBeNull();
    expect(nursing.college?.mask).toBeTruthy();
  });

  it("6 同一个校区画面里学院号不重复（同楼也不再合并成一行）", () => {
    for (const [pack, zone] of [["all", "BY"], ["all", "ZQ"], ["all", "NQ"], ["zq", "ZQ"], ["by", "BY"], ["nq", "NQ"]] as const) {
      const rows = collegeEntries(meta(pack), emblems, zone);
      const nos = rows.map((r) => r.no);
      expect(new Set(nos).size, `${pack}/${zone}`).toBe(nos.length);
      expect(rows.map((r) => r.index)).toEqual(rows.map((_, i) => i + 1));
    }
  });

  it("7 东区 1 行、将军山 4 行（本区学院保持齐全）", () => {
    const dq = collegeEntries(meta("all"), emblems, "DQ");
    expect(dq.map((r) => r.name)).toEqual(["经济与管理学院"]);

    const jj = collegeEntries(meta("jjs"), emblems, "JJ");
    expect(jj.map((r) => r.no)).toEqual([13, 14, 20, 21]);
    expect(jj.every((r) => r.group === "zone" && r.canLocate)).toBe(true);
  });

  it("8 名字去括号；护理学院（筹）例外保留括号", () => {
    expect(stripParens("信息科学与技术学院（网络空间安全学院）")).toBe("信息科学与技术学院");
    const nursing = collegeEntries(meta("nq"), emblems, "NQ").find((r) => r.no === 24)!;
    expect(nursing.name).toContain("（筹）");
  });
});
