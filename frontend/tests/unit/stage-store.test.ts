// W3 验证：stores/stage.ts（用真实 packs.json / places.json / all 元数据，fetch 用 stub）。
// packs.json v3：七包（all/by/bq/zq/nq/dq/jjs），规则只看 default、zones、campuses[].pack。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPinia, setActivePinia } from "pinia";
import { useStageStore } from "@/stores/stage";
import { parseMeta } from "@/campus3d/meta";

const packsJson = readFileSync(resolve(__dirname, "../../public/campus3d/packs.json"), "utf-8");
const placesJson = readFileSync(resolve(__dirname, "../../public/campus3d/places.json"), "utf-8");
const allMetaRaw = JSON.parse(
  readFileSync(resolve(__dirname, "../../public/campus3d/all/campus.meta.json"), "utf-8")
);
const zqMetaRaw = JSON.parse(
  readFileSync(resolve(__dirname, "../../public/campus3d/zq/campus.meta.json"), "utf-8")
);
const jjsMetaRaw = JSON.parse(
  readFileSync(resolve(__dirname, "../../public/campus3d/jjs/campus.meta.json"), "utf-8")
);

vi.stubGlobal(
  "fetch",
  vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.endsWith("/campus3d/packs.json")) {
      return new Response(packsJson, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith("/campus3d/places.json")) {
      return new Response(placesJson, {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(`not found: ${url}`, {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  })
);

describe("stores/stage（W3 pickCampus / enterCampus / switchPack，真实 packs.json）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("初始：packId 是 all、mode 是 home、zoneId 是 null", () => {
    const s = useStageStore();
    expect(s.packId).toBe("all");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
  });

  it("pickCampus('BQ') 后：campus 态、zoneId=BQ、包不变", async () => {
    const s = useStageStore();
    await s.pickCampus("BQ");
    expect(s.mode).toBe("campus");
    expect(s.zoneId).toBe("BQ");
    expect(s.packId).toBe("all");
  });

  it("再 pickCampus('BQ')：取消选中，回 home", async () => {
    const s = useStageStore();
    await s.pickCampus("BQ");
    await s.pickCampus("BQ");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
    expect(s.packId).toBe("all");
  });

  it("pickCampus('BQ') 再 enterCampus()：换成 bq、回首页、meta 清空", async () => {
    const s = useStageStore();
    await s.pickCampus("BQ");
    await s.enterCampus();
    expect(s.packId).toBe("bq");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
    expect(s.meta).toBeNull();
  });

  it("在 bq 里 pickCampus('BQ')：campus 态；enterCampus 后包不变、回首页", async () => {
    const s = useStageStore();
    await s.pickCampus("BQ");
    await s.enterCampus();
    await s.pickCampus("BQ");
    expect(s.mode).toBe("campus");
    expect(s.zoneId).toBe("BQ");
    expect(s.packId).toBe("bq");
    await s.enterCampus();
    expect(s.packId).toBe("bq");
    expect(s.mode).toBe("home");
  });

  it("在 bq 里 pickCampus('ZQ')：直接换到 zq 自己的沙盘", async () => {
    const s = useStageStore();
    await s.pickCampus("BQ");
    await s.enterCampus();
    await s.pickCampus("ZQ");
    expect(s.packId).toBe("zq");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
  });

  it("在 all 里 pickCampus('JJ')：换成 jjs、停在首页", async () => {
    const s = useStageStore();
    await s.pickCampus("JJ");
    expect(s.packId).toBe("jjs");
    expect(s.mode).toBe("home");
  });

  it("mode 是 home 时调 enterCampus()：什么都不变", async () => {
    const s = useStageStore();
    await s.loadCampuses();
    await s.enterCampus();
    expect(s.packId).toBe("all");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
  });

  it("switchPack('all') 后：packId=all、mode=home、zoneId=null", async () => {
    const s = useStageStore();
    await s.pickCampus("JJ");
    expect(s.packId).toBe("jjs");
    s.switchPack("all");
    expect(s.packId).toBe("all");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
  });

  it("对 campuses 的每一项：它的包的 zones 里有它的 id", async () => {
    const s = useStageStore();
    await s.loadCampuses();
    expect(s.campuses.length).toBe(6);
    for (const c of s.campuses) {
      const pack = s.packs.find((p) => p.id === c.pack);
      expect(pack, `${c.id} 的包 ${c.pack} 存在`).toBeTruthy();
      expect(pack!.zones, `${c.id} 在包 ${c.pack} 的 zones 里`).toContain(c.id);
    }
  });
});

describe("stores/stage.nearPack（W10：按 zones 找，不按楼号、不查 campuses）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("all 沙盘上落楼后：五个片区的楼各指到自己的近看沙盘", async () => {
    const s = useStageStore();
    await s.loadCampuses();
    s.setMeta(parseMeta(allMetaRaw));
    await s.showAnswer("ZQ-B023");
    expect(s.nearPack).toBe("zq");
    await s.showAnswer("BQ-B019");
    expect(s.nearPack).toBe("bq");
    await s.showAnswer("FY-B004"); // 附属医院的门诊楼在南区那块沙盘上
    expect(s.nearPack).toBe("nq");
    await s.showAnswer("BY-B029");
    expect(s.nearPack).toBe("by");
    await s.showAnswer("DQ-B009");
    expect(s.nearPack).toBe("dq");
  });

  it("showAnswer(null) 后 nearPack 是 null", async () => {
    const s = useStageStore();
    await s.loadCampuses();
    s.setMeta(parseMeta(allMetaRaw));
    await s.showAnswer("ZQ-B023");
    expect(s.nearPack).toBe("zq");
    await s.showAnswer(null);
    expect(s.nearPack).toBeNull();
  });

  it("zq 沙盘上：nearPack 为 null（已经在近看的沙盘里）", async () => {
    const s = useStageStore();
    await s.loadCampuses();
    s.switchPack("zq");
    s.setMeta(parseMeta(zqMetaRaw));
    await s.showAnswer("ZQ-B023");
    expect(s.mode).toBe("answer");
    expect(s.nearPack).toBeNull();
  });

  it("jjs 沙盘上：nearPack 为 null", async () => {
    const s = useStageStore();
    await s.loadCampuses();
    s.switchPack("jjs");
    s.setMeta(parseMeta(jjsMetaRaw));
    await s.showAnswer("JJ-B019");
    expect(s.mode).toBe("answer");
    expect(s.nearPack).toBeNull();
  });
});

describe("stores/stage.showAnswer（W5：在不在当前沙盘只看 meta.buildings）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("showAnswer('ZQ-B023')（当前包 all）：answer 态 + place", async () => {
    const s = useStageStore();
    s.setMeta(parseMeta(allMetaRaw));
    await s.showAnswer("ZQ-B023");
    expect(s.mode).toBe("answer");
    expect(s.place?.buildingId).toBe("ZQ-B023");
    expect(s.otherPack).toBeNull();
  });

  it("showAnswer('JJ-B019')（当前包 all）：otherPack=jjs，place 为空", async () => {
    const s = useStageStore();
    s.setMeta(parseMeta(allMetaRaw));
    await s.showAnswer("JJ-B019");
    expect(s.otherPack?.packId).toBe("jjs");
    expect(s.otherPack?.buildingId).toBe("JJ-B019");
    expect(s.place).toBeNull();
    expect(s.mode).toBe("home");
  });

  it("showAnswer(null)：从 answer 回 home", async () => {
    const s = useStageStore();
    s.setMeta(parseMeta(allMetaRaw));
    await s.showAnswer("ZQ-B023");
    expect(s.mode).toBe("answer");
    await s.showAnswer(null);
    expect(s.mode).toBe("home");
    expect(s.place).toBeNull();
  });

  it("pickCampus('BQ') 后 place 清空", async () => {
    const s = useStageStore();
    s.setMeta(parseMeta(allMetaRaw));
    await s.showAnswer("ZQ-B023");
    await s.pickCampus("BQ");
    expect(s.place).toBeNull();
    expect(s.otherPack).toBeNull();
  });

  it("在 zq 沙盘里 showAnswer('ZQ-B023')：楼就在眼前，answer 态、无 otherPack", async () => {
    const s = useStageStore();
    await s.pickCampus("ZQ");
    await s.enterCampus();
    expect(s.packId).toBe("zq");
    s.setMeta(parseMeta(zqMetaRaw));
    await s.showAnswer("ZQ-B023");
    // 中区的楼 packOf 写的是 all，但就在中区沙盘上——不许给「换过去」纽
    expect(s.mode).toBe("answer");
    expect(s.place?.buildingId).toBe("ZQ-B023");
    expect(s.otherPack).toBeNull();
  });

  it("在 zq 沙盘里 showAnswer('BQ-B019')：place 为空、otherPack 指向 all", async () => {
    const s = useStageStore();
    await s.pickCampus("ZQ");
    await s.enterCampus();
    s.setMeta(parseMeta(zqMetaRaw));
    await s.showAnswer("BQ-B019");
    expect(s.place).toBeNull();
    expect(s.otherPack?.packId).toBe("all");
    expect(s.otherPack?.buildingId).toBe("BQ-B019");
  });

  it("setMeta(null)（换包瞬间）之后 showAnswer：复位，不落楼", async () => {
    const s = useStageStore();
    s.setMeta(parseMeta(allMetaRaw));
    await s.showAnswer("ZQ-B023");
    expect(s.mode).toBe("answer");
    s.setMeta(null);
    await s.showAnswer("ZQ-B023");
    expect(s.place).toBeNull();
    expect(s.otherPack).toBeNull();
    expect(s.mode).toBe("home");
  });
});

describe("stores/stage.showBuilding 与 board（W9）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("pickCampus('ZQ') 后 showBuilding('ZQ-B034')：answer 态 + place", async () => {
    const s = useStageStore();
    s.setMeta(parseMeta(allMetaRaw));
    await s.pickCampus("ZQ");
    await s.showBuilding("ZQ-B034");
    expect(s.mode).toBe("answer");
    expect(s.place?.buildingId).toBe("ZQ-B034");
  });

  it("只调 showBuilding 时 board 不变；pickCampus 把 board 清成 null", async () => {
    const s = useStageStore();
    s.setMeta(parseMeta(allMetaRaw));
    s.board = "图书馆";
    await s.showBuilding("ZQ-B034");
    expect(s.board).toBe("图书馆"); // showBuilding 不动 board（板块面板入口依赖这一点）
    await s.pickCampus("ZQ");
    expect(s.board).toBeNull();
    expect(s.place).toBeNull();
  });

  it("goHome 与 showAnswer 都清 board", async () => {
    const s = useStageStore();
    s.board = "学工";
    s.goHome();
    expect(s.board).toBeNull();
    s.board = "学工";
    await s.showAnswer("ZQ-B023");
    expect(s.board).toBeNull();
    await s.showAnswer(null);
    expect(s.board).toBeNull();
  });
});
