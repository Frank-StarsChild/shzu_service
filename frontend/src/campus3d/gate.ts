// PLAN S4：能力判定。decideMode 是纯函数（可穷举测试）；readGateInput 只负责读浏览器。
// 规则表见 PLAN 6.S4：从上到下，命中第一条就返回。

export type GateInput = {
  /** 地址栏 ?3d= 的值 */
  query3d: "1" | "0" | null;
  webgl2: boolean;
  /** WEBGL_debug_renderer_info 的 UNMASKED_RENDERER_WEBGL，取不到就用 gl.RENDERER */
  rendererName: string;
  /** localStorage 的 shzu.campus3d（'off' 表示用户关掉了 3D） */
  storedPref: "off" | null;
  /** prefers-reduced-motion: reduce */
  reducedMotion: boolean;
  /** navigator.connection?.saveData */
  saveData: boolean;
  viewportWidth: number;
  /** navigator.deviceMemory */
  deviceMemory: number | null;
};

export type GateResult = { mode: "scene" | "static"; reason: string; canEnable: boolean };

/** 软件渲染显卡名（正则照抄 PLAN：竖线前面没有反斜杠） */
const SOFTWARE_RENDERER = /swiftshader|llvmpipe|softpipe|lavapipe|software|basic render/i;

export function decideMode(input: GateInput): GateResult {
  if (!input.webgl2) {
    return { mode: "static", reason: "no-webgl2", canEnable: false };
  }
  if (input.query3d === "0") {
    return { mode: "static", reason: "query-off", canEnable: true };
  }
  if (input.query3d === "1") {
    return { mode: "scene", reason: "query-on", canEnable: false };
  }
  if (input.storedPref === "off") {
    return { mode: "static", reason: "user-off", canEnable: true };
  }
  if (input.viewportWidth < 900) {
    return { mode: "static", reason: "small-viewport", canEnable: false };
  }
  if (input.reducedMotion) {
    return { mode: "static", reason: "reduced-motion", canEnable: true };
  }
  if (input.saveData) {
    return { mode: "static", reason: "save-data", canEnable: true };
  }
  if (SOFTWARE_RENDERER.test(input.rendererName)) {
    return { mode: "static", reason: "software-gl", canEnable: true };
  }
  if (input.deviceMemory !== null && input.deviceMemory <= 2) {
    return { mode: "static", reason: "low-memory", canEnable: true };
  }
  return { mode: "scene", reason: "ok", canEnable: false };
}

export type IntroInput = {
  /** 地址栏 ?intro= 的值 */
  queryIntro: "1" | "0" | null;
  /** sessionStorage 的 shzu.campus3d.intro 是否为 '1' */
  played: boolean;
  reducedMotion: boolean;
  /** 模型里有没有这个片段 */
  hasClip: boolean;
};

export type IntroResult = { play: boolean; reason: string };

/** N4：要不要播开场动画。从上到下命中第一条。 */
export function decideIntro(input: IntroInput): IntroResult {
  if (!input.hasClip) return { play: false, reason: "no-clip" };
  if (input.reducedMotion) return { play: false, reason: "reduced-motion" };
  if (input.queryIntro === "0") return { play: false, reason: "query-off" };
  if (input.queryIntro === "1") return { play: true, reason: "query-on" };
  if (input.played) return { play: false, reason: "played" };
  return { play: true, reason: "first-visit" };
}

/** 读 ?intro= 与 sessionStorage（纯判定交给 decideIntro）。 */
export function readIntroQuery(): "1" | "0" | null {
  const q = new URLSearchParams(window.location.search).get("intro");
  return q === "1" ? "1" : q === "0" ? "0" : null;
}

/** 读浏览器信息构造 GateInput（判定仍由 decideMode 纯函数完成）。 */
export function readGateInput(): GateInput {
  const params = new URLSearchParams(window.location.search);
  const q = params.get("3d");
  const query3d: "1" | "0" | null = q === "1" ? "1" : q === "0" ? "0" : null;

  let webgl2 = false;
  let rendererName = "";
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (gl) {
    webgl2 = true;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    rendererName = dbg
      ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL))
      : String(gl.getParameter(gl.RENDERER));
  }

  const nav = navigator as Navigator & {
    connection?: { saveData?: boolean };
    deviceMemory?: number;
  };

  return {
    query3d,
    webgl2,
    rendererName,
    storedPref: localStorage.getItem("shzu.campus3d") === "off" ? "off" : null,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    saveData: nav.connection?.saveData === true,
    viewportWidth: window.innerWidth,
    deviceMemory: typeof nav.deviceMemory === "number" ? nav.deviceMemory : null,
  };
}
