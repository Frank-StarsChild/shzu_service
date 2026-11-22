// ALIVE A1 验证：emblems.json 契约（7.2/7.4 节）与 emblems.ts 纯函数。
// 用 Node 的 fs 读真实资产（读文件头，不能只看状态码：后端对找不到的文件返回 200 加首页 HTML）。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Emblems } from "@/stage/emblems";
import { collegesOfBuilding, collegeForPlace } from "@/stage/emblems";

const PUB = resolve(__dirname, "../../public/campus3d");

const emblems: Emblems = JSON.parse(
  readFileSync(resolve(PUB, "emblems/emblems.json"), "utf-8")
);

function packIds(): string[] {
  const packs = JSON.parse(readFileSync(resolve(PUB, "packs.json"), "utf-8"));
  return (packs.packs as { id: string }[]).map((p) => p.id);
}

function metaOf(pack: string): { colleges: { no: number; name: string; buildingIds: string[] }[]; buildings: Record<string, unknown> } {
  return JSON.parse(readFileSync(resolve(PUB, `${pack}/campus.meta.json`), "utf-8"));
}

describe("A1 · emblems.json 资产契约（ALIVE 7.4）", () => {
  it("1 colleges 正好 24 条、no 是 1 到 24、dial.slot 两两不同且与山/度一致", () => {
    expect(emblems.colleges).toHaveLength(24);
    const nos = emblems.colleges.map((c) => c.no).sort((a, b) => a - b);
    expect(nos).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
    const slots = emblems.colleges.map((c) => c.dial.slot).sort((a, b) => a - b);
    expect(new Set(slots).size).toBe(24);
    for (const c of emblems.colleges) {
      expect(c.dial.deg).toBe(c.dial.slot * emblems.dial.stepDeg);
      expect(c.dial.mountain).toBe(emblems.dial.mountains[c.dial.slot]);
    }
  });

  it("2 mask 都是 PNG（头 89 50 4E 47）；color 非 null 的都是 WebP（RIFF…WEBP）", () => {
    for (const c of emblems.colleges) {
      const mask = readFileSync(resolve(PUB, c.mask));
      expect([...mask.slice(0, 4)], `mask of no.${c.no}`).toEqual([0x89, 0x50, 0x4e, 0x47]);
      if (c.color !== null) {
        const color = readFileSync(resolve(PUB, c.color));
        expect([...color.slice(0, 4)], `color head of no.${c.no}`).toEqual([0x52, 0x49, 0x46, 0x46]); // RIFF
        expect([...color.slice(8, 12)], `color type of no.${c.no}`).toEqual([0x57, 0x45, 0x42, 0x50]); // WEBP
      }
    }
    // 没有原色的是 19（继续教育）与 24（护理）；emblem+seal 是 18（体育）
    expect(emblems.colleges.filter((c) => c.color === null).map((c) => c.no)).toEqual([19, 24]);
    expect(emblems.colleges.filter((c) => c.kind === "emblem+seal").map((c) => c.no)).toEqual([18]);
  });

  it("3 七个包的 meta.colleges 与 emblems.json 对得上（no 齐全；buildingIds = 按该包过滤后）", () => {
    for (const pack of packIds()) {
      const meta = metaOf(pack);
      for (const mc of meta.colleges) {
        const ec = emblems.colleges.find((c) => c.no === mc.no);
        expect(ec, `${pack} 的学院 no.${mc.no} 在 emblems.json 里`).toBeTruthy();
        const expected = ec!.buildingIds.filter((b) => b in meta.buildings);
        expect(mc.buildingIds, `${pack} 的学院 no.${mc.no} 楼号`).toEqual(expected);
      }
    }
  });
});

describe("A1 · emblems.ts 纯函数", () => {
  it("4 collegesOfBuilding：BY-B029 是 [2,3]（机电、水建）；陌生楼号空数组", () => {
    expect(collegesOfBuilding(emblems, "BY-B029").map((c) => c.no)).toEqual([2, 3]);
    expect(collegesOfBuilding(emblems, "ZQ-B999")).toEqual([]);
  });

  it("5 collegeForPlace：文字里出现位置靠前的学院胜出；没出现取 no 最小；无学院为 null", () => {
    expect(
      collegeForPlace(emblems, "BY-B029", ["水利建筑工程学院在工科楼。"])?.no
    ).toBe(3);
    expect(collegeForPlace(emblems, "BY-B029", ["工科楼。"])?.no).toBe(2);
    expect(
      collegeForPlace(emblems, "NQ-B013", ["杏三是医药综合实验楼，药学院", "医学院"])?.no
    ).toBe(9);
    expect(collegeForPlace(emblems, "ZQ-B023", ["……"])).toBeNull();
  });
});
