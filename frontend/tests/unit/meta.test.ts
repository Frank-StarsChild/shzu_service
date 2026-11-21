import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { BOARDS, parseMeta, type CampusMeta } from "@/campus3d/meta";

// PLAN S2：读真实 campus.meta.json 校验契约；反例在内存里改对象，不改文件。

const META_URL = new URL("../../public/campus3d/campus.meta.json", import.meta.url);
const raw: unknown = JSON.parse(readFileSync(META_URL, "utf-8"));

function isFinite3(v: unknown): boolean {
  return (
    Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

describe("campus.meta.json 契约", () => {
  it("parseMeta 不抛错", () => {
    expect(() => parseMeta(raw)).not.toThrow();
  });

  const meta: CampusMeta = parseMeta(raw);

  it("hotspots 恰好 5 个；no 依次 01–05；board 依次为五大板块", () => {
    expect(meta.hotspots).toHaveLength(5);
    expect(meta.hotspots.map((h) => h.no)).toEqual(["01", "02", "03", "04", "05"]);
    expect(meta.hotspots.map((h) => h.board)).toEqual([...BOARDS]);
  });

  it.each(meta.hotspots)("热点 %#（%{board}）各字段合法", (h) => {
    expect(h.buildingId in meta.buildings).toBe(true);
    expect(h.stop in meta.stops).toBe(true);
    expect(isFinite3(h.anchor)).toBe(true);
    expect(isFinite3(h.pick)).toBe(true);
    for (const v of [h.posterDesktop, h.posterMobile]) {
      expect(v).toHaveLength(2);
      for (const n of v) {
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThanOrEqual(1);
      }
    }
    expect(h.label.length).toBeGreaterThan(0);
  });

  it("stops 有 overview；每个停靠点 position/target 合法且不相等", () => {
    expect("overview" in meta.stops).toBe(true);
    for (const [id, s] of Object.entries(meta.stops)) {
      expect(isFinite3(s.position), `${id}.position`).toBe(true);
      expect(isFinite3(s.target), `${id}.target`).toBe(true);
      expect(s.position, `${id} 的 position 与 target 不能相等`).not.toEqual(s.target);
    }
  });

  it("N1：version 为 v2，look 字段齐全且合法", () => {
    expect(meta.version).toBe("v2");
    const look = meta.look;
    expect(look.theme.length).toBeGreaterThan(0);
    expect(look.highlight.nodePrefix).toBe("H_");
    expect(look.highlight.riseMs).toBeGreaterThan(0);
    expect(look.fx.node.length).toBeGreaterThan(0);
    expect(look.fx.speed).toBeGreaterThan(0);
    expect(look.fx.maxFps).toBeGreaterThan(0);
    expect(look.intro.clip.length).toBeGreaterThan(0);
    expect(look.intro.seconds).toBeGreaterThan(0);
    expect(look.intro.cameraMs).toBeGreaterThan(0);
    expect(isFinite3(look.intro.cameraFrom.position)).toBe(true);
    expect(isFinite3(look.intro.cameraFrom.target)).toBe(true);
    for (const v of [look.hud.title, look.hud.subtitle, look.hud.coord, look.hud.scaleLabel]) {
      expect(v.length).toBeGreaterThan(0);
    }
    for (const id of Object.keys(meta.stops)) {
      const pair = look.hud.scale100[id];
      expect(pair, `scale100.${id}`).toBeTruthy();
      expect(isFinite3(pair[0])).toBe(true);
      expect(isFinite3(pair[1])).toBe(true);
    }
    for (const v of [look.hud.scalePoster.desktop, look.hud.scalePoster.mobile]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    for (const c of Object.values(look.colors)) {
      expect(c).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});

describe("campus.meta.json 反例（必须抛错）", () => {
  const clone = () => structuredClone(raw) as Record<string, unknown>;

  it("删掉一个热点 → 抛错", () => {
    const m = clone();
    (m["hotspots"] as unknown[]).splice(0, 1);
    expect(() => parseMeta(m)).toThrow(/hotspots/);
  });

  it("某个 anchor 改成字符串 → 抛错", () => {
    const m = clone();
    const hs = m["hotspots"] as Record<string, unknown>[];
    hs[2]["anchor"] = "oops";
    expect(() => parseMeta(m)).toThrow(/anchor/);
  });

  it("某个 board 改成「财务」→ 抛错", () => {
    const m = clone();
    const hs = m["hotspots"] as Record<string, unknown>[];
    hs[1]["board"] = "财务";
    expect(() => parseMeta(m)).toThrow(/board/);
  });

  it("删掉 look → 抛错", () => {
    const m = clone();
    delete m["look"];
    expect(() => parseMeta(m)).toThrow(/look/);
  });

  it("look.fx.speed 改成字符串 → 抛错", () => {
    const m = clone();
    const look = m["look"] as Record<string, unknown>;
    (look["fx"] as Record<string, unknown>)["speed"] = "fast";
    expect(() => parseMeta(m)).toThrow(/speed/);
  });

  it("删掉 look.hud.scale100.overview → 抛错", () => {
    const m = clone();
    const look = m["look"] as Record<string, unknown>;
    delete ((look["hud"] as Record<string, unknown>)["scale100"] as Record<string, unknown>)["overview"];
    expect(() => parseMeta(m)).toThrow(/scale100/);
  });
});
