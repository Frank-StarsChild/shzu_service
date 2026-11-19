import { describe, expect, it } from "vitest";
import { decideMode, type GateInput } from "@/campus3d/gate";

// PLAN S4：规则表 10 行逐条 + 优先级 + 显卡名。

const GPU_GOOD = "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)";

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    query3d: null,
    webgl2: true,
    rendererName: GPU_GOOD,
    storedPref: null,
    reducedMotion: false,
    saveData: false,
    viewportWidth: 1440,
    deviceMemory: 8,
    ...over,
  };
}

describe("decideMode 规则表（PLAN S4，从上到下命中第一条）", () => {
  it("1 没有 WebGL2 → static / no-webgl2 / 不可开启", () => {
    expect(decideMode(input({ webgl2: false }))).toEqual({
      mode: "static",
      reason: "no-webgl2",
      canEnable: false,
    });
  });

  it("2 ?3d=0 → static / query-off / 可开启", () => {
    expect(decideMode(input({ query3d: "0" }))).toEqual({
      mode: "static",
      reason: "query-off",
      canEnable: true,
    });
  });

  it("3 ?3d=1 → scene / query-on / 可关", () => {
    expect(decideMode(input({ query3d: "1" }))).toEqual({
      mode: "scene",
      reason: "query-on",
      canEnable: false,
    });
  });

  it("4 存储偏好 off → static / user-off / 可开启", () => {
    expect(decideMode(input({ storedPref: "off" }))).toEqual({
      mode: "static",
      reason: "user-off",
      canEnable: true,
    });
  });

  it("5 视口 < 900 → static / small-viewport / 不可开启", () => {
    expect(decideMode(input({ viewportWidth: 899 }))).toEqual({
      mode: "static",
      reason: "small-viewport",
      canEnable: false,
    });
  });

  it("6 减少动态 → static / reduced-motion / 可开启", () => {
    expect(decideMode(input({ reducedMotion: true }))).toEqual({
      mode: "static",
      reason: "reduced-motion",
      canEnable: true,
    });
  });

  it("7 省流模式 → static / save-data / 可开启", () => {
    expect(decideMode(input({ saveData: true }))).toEqual({
      mode: "static",
      reason: "save-data",
      canEnable: true,
    });
  });

  it("8 软件渲染 → static / software-gl / 可开启", () => {
    expect(decideMode(input({ rendererName: "Some Software Adapter" }))).toEqual({
      mode: "static",
      reason: "software-gl",
      canEnable: true,
    });
  });

  it("9 deviceMemory ≤ 2 → static / low-memory / 可开启", () => {
    expect(decideMode(input({ deviceMemory: 2 }))).toEqual({
      mode: "static",
      reason: "low-memory",
      canEnable: true,
    });
  });

  it("10 其余 → scene / ok / 可关", () => {
    expect(decideMode(input())).toEqual({ mode: "scene", reason: "ok", canEnable: false });
  });
});

describe("decideMode 优先级", () => {
  it("?3d=1 优先于存储偏好（3 在 4 前）", () => {
    const r = decideMode(input({ query3d: "1", storedPref: "off" }));
    expect(r).toEqual({ mode: "scene", reason: "query-on", canEnable: false });
  });

  it("没有 WebGL2 优先于 ?3d=1（1 最先）", () => {
    const r = decideMode(input({ webgl2: false, query3d: "1" }));
    expect(r).toEqual({ mode: "static", reason: "no-webgl2", canEnable: false });
  });

  it("?3d=0 且其余全好 → query-off", () => {
    const r = decideMode(input({ query3d: "0" }));
    expect(r.reason).toBe("query-off");
  });

  it("视口 390 优先于减少动态（5 在 6 前）", () => {
    const r = decideMode(input({ viewportWidth: 390, reducedMotion: true }));
    expect(r).toEqual({ mode: "static", reason: "small-viewport", canEnable: false });
  });
});

describe("decideMode 显卡名（规则 8 的正则）", () => {
  it("SwiftShader → software-gl", () => {
    const r = decideMode(
      input({ rendererName: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)" })
    );
    expect(r).toEqual({ mode: "static", reason: "software-gl", canEnable: true });
  });

  it("Microsoft Basic Render Driver → software-gl", () => {
    const r = decideMode(input({ rendererName: "Microsoft Basic Render Driver" }));
    expect(r).toEqual({ mode: "static", reason: "software-gl", canEnable: true });
  });

  it("RTX 3060 → ok", () => {
    const r = decideMode(input({ rendererName: GPU_GOOD }));
    expect(r).toEqual({ mode: "scene", reason: "ok", canEnable: false });
  });

  it("Apple M2（ANGLE Metal）→ ok", () => {
    const r = decideMode(
      input({ rendererName: "ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)" })
    );
    expect(r).toEqual({ mode: "scene", reason: "ok", canEnable: false });
  });
});
