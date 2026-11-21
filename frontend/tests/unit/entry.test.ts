import { describe, expect, it } from "vitest";
import { decideEntry } from "@/stage/entry";

// W6：decideEntry 的六条规则每条一例，再加两例（W6.md「验证」）。

describe("decideEntry（W6 首页进舞台还是普通版）", () => {
  it("规则 1：?stage=0 → 普通版 / query-off（其余条件即使能跑 3D 也强制不了普通版之外的）", () => {
    expect(
      decideEntry({ mode: "scene", viewportWidth: 1440, queryStage: "0", prefer: null })
    ).toEqual({ stage: false, reason: "query-off" });
  });

  it("规则 2：mode=static → 普通版 / static", () => {
    expect(
      decideEntry({ mode: "static", viewportWidth: 1440, queryStage: null, prefer: null })
    ).toEqual({ stage: false, reason: "static" });
  });

  it("规则 3：视口 < 1100 → 普通版 / narrow", () => {
    expect(
      decideEntry({ mode: "scene", viewportWidth: 1099, queryStage: null, prefer: null })
    ).toEqual({ stage: false, reason: "narrow" });
  });

  it("规则 4：?stage=1 → 舞台 / query-on", () => {
    expect(
      decideEntry({ mode: "scene", viewportWidth: 1440, queryStage: "1", prefer: null })
    ).toEqual({ stage: true, reason: "query-on" });
  });

  it("规则 5：点过「普通版」（shzu.stage=classic）→ 普通版 / prefer-classic", () => {
    expect(
      decideEntry({ mode: "scene", viewportWidth: 1440, queryStage: null, prefer: "classic" })
    ).toEqual({ stage: false, reason: "prefer-classic" });
  });

  it("规则 6：其余 → 舞台 / default", () => {
    expect(
      decideEntry({ mode: "scene", viewportWidth: 1440, queryStage: null, prefer: null })
    ).toEqual({ stage: true, reason: "default" });
  });

  it("特殊 1：没有 3D 能力时 ?stage=1 也强制不了舞台（mode=static 先于规则 4）", () => {
    expect(
      decideEntry({ mode: "static", viewportWidth: 1440, queryStage: "1", prefer: null })
    ).toEqual({ stage: false, reason: "static" });
  });

  it("特殊 2：视口 1099 的 scene 设备 → narrow（先于规则 4/5/6）", () => {
    expect(
      decideEntry({ mode: "scene", viewportWidth: 1099, queryStage: "1", prefer: "classic" })
    ).toEqual({ stage: false, reason: "narrow" });
  });
});
