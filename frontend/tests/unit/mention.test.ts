import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Places } from "@/stage/packs";
import type { Emblems } from "@/stage/emblems";
import { findMention } from "@/stage/emblems";
import { parseMeta } from "@/campus3d/meta";

const PUB = resolve(__dirname, "../../public/campus3d");
const places = JSON.parse(readFileSync(resolve(PUB, "places.json"), "utf-8")) as Places;
const emblems = JSON.parse(
  readFileSync(resolve(PUB, "emblems/emblems.json"), "utf-8")
) as Emblems;
const zqMeta = parseMeta(JSON.parse(readFileSync(resolve(PUB, "zq/campus.meta.json"), "utf-8")));

describe("stage/emblems · A8 打字预判", () => {
  it("1 法学院在哪：ZQ-B018、学院 16、命中的是「法学院」", () => {
    const m = findMention("法学院在哪", places, emblems, zqMeta);
    expect(m).not.toBeNull();
    expect(m!.buildingId).toBe("ZQ-B018");
    expect(m!.collegeNo).toBe(16);
    expect(m!.label).toBe("法学院");
  });

  it("2 物理学专业在哪个学院：不误中理学院（两字简称不参与）", () => {
    const m = findMention("物理学专业在哪个学院", places, emblems, zqMeta);
    if (m) expect(m.collegeNo).not.toBe(11);
  });

  it("3 图书馆和法学院：取位置靠前的图书馆", () => {
    const m = findMention("图书馆和法学院", places, emblems, zqMeta);
    expect(m).not.toBeNull();
    expect(m!.buildingId).toBe("ZQ-B034");
    expect(m!.label).toBe("图书馆");
  });

  it("4 信息学院：它的楼不在中区沙盘上 → null", () => {
    expect(findMention("信息科学与技术学院在哪", places, emblems, zqMeta)).toBeNull();
  });

  it("5 空输入 → null", () => {
    expect(findMention("", places, emblems, zqMeta)).toBeNull();
  });
});
