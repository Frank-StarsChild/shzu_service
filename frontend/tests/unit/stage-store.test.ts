// W3/W5 验证：stores/stage.ts（用真实 packs.json / places.json / all 元数据，fetch 用 stub）。
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

describe("stores/stage（真实 packs.json）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("初始：packId 是 all、mode 是 home、zoneId 是 null", () => {
    const s = useStageStore();
    expect(s.packId).toBe("all");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
  });

  it("pickCampus('BQ') 同包：campus 态、zoneId=BQ、包不变", async () => {
    const s = useStageStore();
    await s.pickCampus("BQ");
    expect(s.mode).toBe("campus");
    expect(s.zoneId).toBe("BQ");
    expect(s.packId).toBe("all");
  });

  it("pickCampus('JJ') 异包：换成 jjs、先回首页", async () => {
    const s = useStageStore();
    await s.pickCampus("JJ");
    expect(s.packId).toBe("jjs");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
  });

  it("将军山里再 pickCampus('ZQ')：换回 all、仍是首页", async () => {
    const s = useStageStore();
    await s.pickCampus("JJ");
    await s.pickCampus("ZQ");
    expect(s.packId).toBe("all");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
  });

  it("goHome()：三个字段回到初始值", async () => {
    const s = useStageStore();
    await s.pickCampus("BQ");
    s.goHome();
    expect(s.packId).toBe("all");
    expect(s.mode).toBe("home");
    expect(s.zoneId).toBeNull();
  });
});

describe("stores/stage.showAnswer（W5）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("showAnswer('ZQ-B023')（当前包 all）：answer 态 + place", async () => {
    const s = useStageStore();
    s.setPackMeta(parseMeta(allMetaRaw));
    await s.showAnswer("ZQ-B023");
    expect(s.mode).toBe("answer");
    expect(s.place?.buildingId).toBe("ZQ-B023");
    expect(s.otherPack).toBeNull();
  });

  it("showAnswer('JJ-B019')（当前包 all）：otherPack=jjs，place 为空", async () => {
    const s = useStageStore();
    await s.showAnswer("JJ-B019");
    expect(s.otherPack?.packId).toBe("jjs");
    expect(s.otherPack?.buildingId).toBe("JJ-B019");
    expect(s.place).toBeNull();
    expect(s.mode).toBe("home");
  });

  it("showAnswer(null)：从 answer 回 home", async () => {
    const s = useStageStore();
    await s.showAnswer("ZQ-B023");
    expect(s.mode).toBe("answer");
    await s.showAnswer(null);
    expect(s.mode).toBe("home");
    expect(s.place).toBeNull();
  });

  it("pickCampus('BQ') 后 place 清空", async () => {
    const s = useStageStore();
    await s.showAnswer("ZQ-B023");
    await s.pickCampus("BQ");
    expect(s.place).toBeNull();
    expect(s.otherPack).toBeNull();
  });
});

describe("stores/stage.showBuilding 与 board（W9）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("pickCampus('ZQ') 后 showBuilding('ZQ-B034')：answer 态 + place", async () => {
    const s = useStageStore();
    s.setPackMeta(parseMeta(allMetaRaw));
    await s.pickCampus("ZQ");
    await s.showBuilding("ZQ-B034");
    expect(s.mode).toBe("answer");
    expect(s.place?.buildingId).toBe("ZQ-B034");
  });

  it("只调 showBuilding 时 board 不变；pickCampus 把 board 清成 null", async () => {
    const s = useStageStore();
    s.setPackMeta(parseMeta(allMetaRaw));
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
