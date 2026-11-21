// W1 验证：packs.json / places.json / 七包元数据的解析与反例（直接读真实资产）。
// packs.json v3：七个沙盘（all/by/bq/zq/nq/dq/jjs），campuses 不再有 stop 字段。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parsePackIndex, type PackIndex } from "@/stage/packs";
import { parseMeta, type CampusMeta } from "@/campus3d/meta";

const PUB = resolve(__dirname, "../../public/campus3d");

function readJson(name: string): any {
  return JSON.parse(readFileSync(resolve(PUB, name), "utf-8"));
}

const index: PackIndex = parsePackIndex(readJson("packs.json"));

/** 七个包的 meta 一并解析（read once；用真实 campus.meta.json 走完整 parseMeta） */
const metas: Record<string, CampusMeta> = {};
for (const p of index.packs) {
  metas[p.id] = parseMeta(readJson(`${p.id}/campus.meta.json`));
}

describe("parsePackIndex（真实 packs.json）", () => {
  it("校验通过，恰好 7 个包，id 依次是 all/by/bq/zq/nq/dq/jjs", () => {
    expect(index.packs.map((p) => p.id)).toEqual(["all", "by", "bq", "zq", "nq", "dq", "jjs"]);
  });

  it("默认包是 all", () => {
    expect(index.default).toBe("all");
  });

  it("campuses 恰好 6 个，名字与自己的包依次正确", () => {
    expect(index.campuses.map((c) => c.name)).toEqual([
      "北苑新区", "北区", "中区", "南区", "东区", "将军山校区",
    ]);
    expect(index.campuses.map((c) => c.pack)).toEqual(["by", "bq", "zq", "nq", "dq", "jjs"]);
  });

  it("反例：version 不是 v3 时抛错", () => {
    const bad = { ...readJson("packs.json"), version: "v2" };
    expect(() => parsePackIndex(bad)).toThrow(/version/);
  });

  it("反例：校区 pack 指向不存在的包时抛错", () => {
    const raw = readJson("packs.json");
    raw.campuses[1].pack = "x";
    expect(() => parsePackIndex(raw)).toThrow(/campuses\[1\]\.pack/);
  });

  it("反例：某个包的 zones 是空数组时抛错", () => {
    const raw = readJson("packs.json");
    raw.packs[2].zones = [];
    expect(() => parsePackIndex(raw)).toThrow(/packs\[2\]\.zones/);
  });
});

describe("七个包的元数据交给 parseMeta", () => {
  for (const p of index.packs) {
    it(`${p.id}：buildings 项数=${p.buildings}、pack.id、zones 与 packs.json 一致`, () => {
      const m = metas[p.id];
      expect(Object.keys(m.buildings).length).toBe(p.buildings);
      expect(m.pack?.id).toBe(p.id);
      expect((m.zones ?? []).map((z) => z.id).sort()).toEqual([...p.zones].sort());
    });
  }

  it("all：303 栋楼、29 个外壳、7 个片区", () => {
    expect(Object.keys(metas.all.buildings).length).toBe(303);
    expect(metas.all.shells?.length).toBe(29);
    expect(metas.all.zones?.length).toBe(7);
  });

  it("jjs：19 栋楼", () => {
    expect(Object.keys(metas.jjs.buildings).length).toBe(19);
  });

  it("反例：删掉 all 的 focus 里任意一项抛错", () => {
    const raw = readJson("all/campus.meta.json");
    const key = Object.keys(raw.focus)[0];
    delete raw.focus[key];
    expect(() => parseMeta(raw)).toThrow(new RegExp(`focus\\.${key}`));
  });

  it("反例：删掉 all 的 stops.home 抛错", () => {
    const raw = readJson("all/campus.meta.json");
    delete raw.stops.home;
    expect(() => parseMeta(raw)).toThrow(/stops\.home/);
  });

  it("反例：all 的 look.pin.node 改成空字符串抛错", () => {
    const raw = readJson("all/campus.meta.json");
    raw.look.pin.node = "";
    expect(() => parseMeta(raw)).toThrow(/look\.pin\.node/);
  });
});

describe("根目录 v2 元数据仍然可解析（兼容旧首页沙盘）", () => {
  it("v2 campus.meta.json 交给 parseMeta 不抛错", () => {
    const m = parseMeta(readJson("campus.meta.json"));
    expect(m.hotspots.length).toBe(5);
    expect(m.pack).toBeUndefined();
    expect(m.zones).toBeUndefined();
  });
});

describe("places.json（W5 用到，W1 先校验形状）", () => {
  it("version 是 v3，五个板块都映射到中区楼", () => {
    const places = readJson("places.json");
    expect(places.version).toBe("v3");
    expect(places.boards["图书馆"]).toBe("ZQ-B034");
    expect(Object.keys(places.packOf).length).toBeGreaterThan(100);
  });
});
