// PLAN S2（第 3.2 节）：campus.meta.json 的类型与解析。
// 纯函数：不合契约时抛 Error，信息里写明是哪个字段。
// 楼名、说明、署名一律来自 meta，代码里不许写死（PLAN 规则 8）。

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** 镜头停靠点。overview 为全景；v2 五个与热点一一对应；v3 另有 home 与各校区。 */
export type StopId =
  | "overview" | "home" | "by" | "bq" | "zq" | "nq" | "dq"
  | "xg" | "jw" | "hq" | "bw" | "lib";

export interface CameraConfig {
  /** 竖直视场角（three PerspectiveCamera 第一个参数） */
  fov: number;
  near: number;
  far: number;
}

export interface Stop {
  position: Vec3;
  target: Vec3;
}

export interface Hotspot {
  /** "01"–"05"，顺序与首页五个板块按钮一致 */
  no: string;
  /** 板块名：学工 / 教务 / 后勤 / 保卫 / 图书馆 */
  board: string;
  stop: StopId;
  buildingId: string;
  label: string;
  note?: string;
  /** 标记点：编号标记的中心放在这里（楼的正上方，图钉顶） */
  anchor: Vec3;
  /** 拾取点：楼顶上的一个点，鼠标指到一定指中这栋楼 */
  pick: Vec3;
  /** anchor 在桌面海报上的归一化位置，左上 (0,0) 右下 (1,1) */
  posterDesktop: Vec2;
  /** anchor 在手机海报上的归一化位置 */
  posterMobile: Vec2;
}

export interface BuildingInfo {
  /** 部分附属建筑在 meta 中为空串（允许）；热点楼不允许为空 */
  name: string;
  category?: string;
  anchor?: Vec3;
  /** v3：这栋楼属于哪个片区 */
  zone?: string;
}

export interface LookHud {
  title: string;
  subtitle: string;
  coord: string;
  scaleLabel: string;
  /** 每个停靠点一对地面点，两点相距 100 米（用于换算比例尺像素宽度） */
  scale100: Record<string, [Vec3, Vec3]>;
  /** 静态海报上这 100 米占画框宽度的比例 */
  scalePoster: { desktop: number; mobile: number };
  /** v3：scale100 里每对点的实际间距（米） */
  scaleMeters?: number;
}

export interface LookColors {
  panel: string;
  hud: string;
  hudDim: string;
  accent: string;
  markerBg: string;
  markerBorder: string;
}

/** 夜景外观参数（NIGHT.md 3.2）；数字和文字一律从 meta 读，代码里不许写死。 */
export interface CampusLook {
  theme: string;
  highlight: { nodePrefix: string; riseMs: number };
  fx: { node: string; speed: number; maxFps: number };
  intro: {
    clip: string;
    seconds: number;
    cameraMs: number;
    cameraFrom: Stop;
  };
  sway: { yawDeg: number; periodSec: number };
  hud: LookHud;
  colors: LookColors;
  // ---- v3（STAGE.md 5.3）：舞台用的可选字段，v2 元数据没有它们 ----
  zone?: { nodePrefix: string };
  pin?: { node: string };
  star?: { home: Vec3; lift: number };
  sign?: { lift: number };
  tour?: { degPerSec: number };
  orbit?: { minPolarDeg: number; maxPolarDeg: number; minDistance: number; maxDistance: number };
}

/** v3：这个沙盘自身的信息（aspect / posterAspect 可缺省） */
export interface PackInfo {
  id: string;
  name: string;
  aspect?: number;
  posterAspect?: number;
}

/** v3：沙盘里的片区（校区或附属单位） */
export interface ZoneInfo {
  id: string;
  name: string;
  kind: string;
  buildings?: number;
  node?: string;
  label?: Vec3;
  stop?: string;
}

/** v3：楼在这个沙盘里的学院 */
export interface CollegeInfo {
  no: number;
  name: string;
  zone: string;
  buildingIds: string[];
  confirmed?: boolean;
}

/** 一组镜头机位（v3 的 focus 表；与 Stop 同构） */
export type CameraPose = { position: Vec3; target: Vec3 };

export interface CampusMeta {
  version: string;
  attribution: string;
  background: string;
  camera: CameraConfig;
  stops: Record<StopId, Stop>;
  hotspots: Hotspot[];
  buildings: Record<string, BuildingInfo>;
  look: CampusLook;
  // ---- v3（STAGE.md 5.3）：都是可选的，v2 的元数据没有它们 ----
  pack?: PackInfo;
  zones?: ZoneInfo[];
  shells?: string[];
  focus?: Record<string, CameraPose>;
  colleges?: CollegeInfo[];
}

/** 与首页五个板块按钮一一对应的板块名（顺序固定） */
export const BOARDS: readonly string[] = ["学工", "教务", "后勤", "保卫", "图书馆"];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(path: string, msg: string): never {
  throw new Error(`campus.meta.json：${path} ${msg}`);
}

function getVec3(obj: Record<string, unknown>, path: string): Vec3 {
  return getVec3Value(obj[path.split(".").pop() ?? path], path);
}

function getVec3Value(raw: unknown, path: string): Vec3 {
  if (!Array.isArray(raw) || raw.length !== 3) fail(path, "必须是 3 个数的数组");
  const out = raw as unknown[];
  for (let i = 0; i < 3; i++) {
    if (typeof out[i] !== "number" || !Number.isFinite(out[i])) {
      fail(`${path}[${i}]`, "必须是有限数字");
    }
  }
  return [out[0] as number, out[1] as number, out[2] as number];
}

function getVec2Unit(obj: Record<string, unknown>, path: string): Vec2 {
  const key = obj[path.split(".").pop() as string];
  if (!Array.isArray(key) || key.length !== 2) fail(path, "必须是 2 个数的数组");
  const out = key as unknown[];
  for (let i = 0; i < 2; i++) {
    const n = out[i];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) {
      fail(`${path}[${i}]`, `必须是 0 到 1 之间的数（收到 ${String(n)}）`);
    }
  }
  return [out[0] as number, out[1] as number];
}

function sameVec(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

function getStr(obj: Record<string, unknown>, path: string, allowEmpty = false): string {
  const key = path.includes(".") ? path.split(".").pop()! : path;
  const v = obj[key];
  if (typeof v !== "string") fail(path, `必须是字符串（收到 ${typeof v}）`);
  if (!allowEmpty && v === "") fail(path, "不能为空字符串");
  return v;
}

function getNum(obj: Record<string, unknown>, path: string): number {
  const key = path.includes(".") ? path.split(".").pop()! : path;
  const v = obj[key];
  if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "必须是有限数字");
  return v;
}

function getProp<T>(obj: T, key: keyof T & string): Record<string, unknown> {
  const v = obj[key];
  if (!isObj(v)) fail(key, "必须是对象");
  return v;
}

function getPosNum(obj: Record<string, unknown>, path: string): number {
  const n = getNum(obj, path);
  if (!(n > 0)) fail(path, `必须是大于 0 的有限数（收到 ${n}）`);
  return n;
}

function getColor(obj: Record<string, unknown>, path: string): string {
  const v = getStr(obj, path);
  if (!/^#[0-9a-fA-F]{6}$/.test(v)) fail(path, `必须是 #rrggbb 颜色（收到 ${v}）`);
  return v;
}

/** 解析并校验 campus.meta.json。任何不合契约的字段都会抛出带字段名的 Error。 */
export function parseMeta(raw: unknown): CampusMeta {
  if (!isObj(raw)) fail("（根）", "必须是 JSON 对象");

  const version = getStr(raw, "version");
  const attribution = getStr(raw, "attribution");
  const background = getStr(raw, "background");
  if (!/^#[0-9a-fA-F]{6}$/.test(background)) {
    fail("background", `必须是 #rrggbb 颜色（收到 ${background}）`);
  }

  const camera = getProp(raw, "camera");
  const fov = getNum(camera, "camera.fov");
  const near = getNum(camera, "camera.near");
  const far = getNum(camera, "camera.far");
  if (fov <= 0 || fov >= 180) fail("camera.fov", `视场角不合理（收到 ${fov}）`);
  if (near <= 0) fail("camera.near", "必须是正数");
  if (far <= near) fail("camera.far", "必须大于 near");

  const stopsRaw = getProp(raw, "stops");
  if (!("overview" in stopsRaw)) fail("stops.overview", "缺少 overview 停靠点");
  const stops: Record<string, Stop> = {};
  for (const [id, sRaw] of Object.entries(stopsRaw)) {
    if (!isObj(sRaw)) fail(`stops.${id}`, "必须是对象");
    const s = sRaw as Record<string, unknown>;
    const position = getVec3(s, "position");
    const target = getVec3(s, "target");
    if (sameVec(position, target)) fail(`stops.${id}`, "position 与 target 不能相等");
    stops[id] = { position, target };
  }

  const buildingsRaw = getProp(raw, "buildings");
  const buildings: Record<string, BuildingInfo> = {};
  for (const [id, bRaw] of Object.entries(buildingsRaw)) {
    if (!isObj(bRaw)) fail(`buildings.${id}`, "必须是对象");
    const b = bRaw as Record<string, unknown>;
    // 部分附属建筑 name 为空串，允许（PLAN 只要求热点 label 非空）
    const name = typeof b["name"] === "string" ? b["name"] : fail(`buildings.${id}.name`, "必须是字符串");
    const category = typeof b["category"] === "string" ? b["category"] : undefined;
    const anchor = "anchor" in b ? getVec3(b, "anchor") : undefined;
    const zone = typeof b["zone"] === "string" ? b["zone"] : undefined;
    buildings[id] = {
      name,
      ...(category !== undefined ? { category } : {}),
      ...(anchor ? { anchor } : {}),
      ...(zone !== undefined ? { zone } : {}),
    };
  }

  const hotspotsRaw = raw["hotspots"];
  // v3（有 pack 字段）允许 5 或 6 个热点，board 不再固定为五大板块；v2 仍恰为 5 个
  const isV3 = isObj(raw["pack"]);
  const hsCount = isV3 ? [5, 6] : [5];
  if (!Array.isArray(hotspotsRaw) || !hsCount.includes(hotspotsRaw.length)) {
    fail("hotspots", `必须${isV3 ? "是 5 或 6" : "恰好 5"}个热点（收到 ${Array.isArray(hotspotsRaw) ? hotspotsRaw.length : "非数组"} 个）`);
  }
  const hotspots: Hotspot[] = hotspotsRaw.map((hRaw, i) => {
    if (!isObj(hRaw)) fail(`hotspots[${i}]`, "必须是对象");
    const h = hRaw as Record<string, unknown>;
    const no = getStr(h, "no");
    const wantNo = String(i + 1).padStart(2, "0");
    if (no !== wantNo) fail(`hotspots[${i}].no`, `应为 "${wantNo}"（收到 "${no}"）`);
    const board = getStr(h, "board");
    if (!isV3 && board !== BOARDS[i]) fail(`hotspots[${i}].board`, `应为「${BOARDS[i]}」（收到「${board}」）`);
    const buildingId = getStr(h, "buildingId");
    if (!(buildingId in buildings)) {
      fail(`hotspots[${i}].buildingId`, `"${buildingId}" 不在 buildings 里`);
    }
    const stop = getStr(h, "stop") as StopId;
    if (!(stop in stops)) fail(`hotspots[${i}].stop`, `"${stop}" 不在 stops 里`);
    const building = buildings[buildingId];
    if (building.name === "") {
      fail(`hotspots[${i}].buildingId`, `热点楼 ${buildingId} 的 name 不能为空`);
    }
    const label = getStr(h, "label");
    const note = typeof h["note"] === "string" ? h["note"] : undefined;
    const anchor = getVec3(h, "anchor");
    const pick = getVec3(h, "pick");
    const posterDesktop = getVec2Unit(h, "posterDesktop");
    const posterMobile = getVec2Unit(h, "posterMobile");
    return {
      no, board, stop, buildingId, label,
      ...(note !== undefined ? { note } : {}),
      anchor, pick, posterDesktop, posterMobile,
    };
  });

  const look = parseLook(raw);

  // ---- v3 附加字段（只有 meta.pack 存在时才校验；v2 行为不变）----
  let pack: PackInfo | undefined;
  let zones: ZoneInfo[] | undefined;
  let shells: string[] | undefined;
  let focus: Record<string, CameraPose> | undefined;
  let colleges: CollegeInfo[] | undefined;
  if (isV3) {
    const packRaw = raw["pack"] as Record<string, unknown>;
    pack = {
      id: getStr(packRaw, "pack.id"),
      name: getStr(packRaw, "pack.name"),
      ...(typeof packRaw["aspect"] === "number" ? { aspect: packRaw["aspect"] as number } : {}),
      ...(typeof packRaw["posterAspect"] === "number" ? { posterAspect: packRaw["posterAspect"] as number } : {}),
    };

    const zonesRaw = raw["zones"];
    if (!Array.isArray(zonesRaw) || zonesRaw.length === 0) {
      fail("zones", "必须是非空数组");
    }
    zones = zonesRaw.map((zRaw, i) => {
      if (!isObj(zRaw)) fail(`zones[${i}]`, "必须是对象");
      const z = zRaw as Record<string, unknown>;
      const id = getStr(z, "id");
      const node = typeof z["node"] === "string" ? z["node"] : undefined;
      if (node !== undefined) {
        // 带 node 的片区必须有 label（3 个有限数）
        const labelRaw = z["label"];
        getVec3Value(labelRaw, `zones[${i}].label`);
      }
      return {
        id,
        name: getStr(z, "name"),
        kind: getStr(z, "kind"),
        ...(typeof z["buildings"] === "number" ? { buildings: z["buildings"] as number } : {}),
        ...(node !== undefined ? { node } : {}),
        ...(isObj(z["label"]) || Array.isArray(z["label"]) ? { label: getVec3Value(z["label"], `zones[${i}].label`) } : {}),
        ...(typeof z["stop"] === "string" ? { stop: z["stop"] as string } : {}),
      };
    });

    const shellsRaw = raw["shells"];
    if (!Array.isArray(shellsRaw)) fail("shells", "必须是数组");
    shells = shellsRaw.map((s, i) => {
      if (typeof s !== "string") fail(`shells[${i}]`, "必须是字符串");
      if (!(s in buildings)) fail(`shells[${i}]`, `"${s}" 不在 buildings 里`);
      return s as string;
    });

    const focusRaw = raw["focus"];
    if (!isObj(focusRaw)) fail("focus", "必须是对象");
    focus = {};
    for (const id of Object.keys(buildings)) {
      const pose = (focusRaw as Record<string, unknown>)[id];
      if (!isObj(pose)) fail(`focus.${id}`, `缺少这栋楼的近景机位`);
      const p = pose as Record<string, unknown>;
      focus[id] = {
        position: getVec3(p, "position"),
        target: getVec3(p, "target"),
      };
    }

    const collegesRaw = raw["colleges"];
    if (Array.isArray(collegesRaw)) {
      colleges = collegesRaw.map((cRaw, i) => {
        if (!isObj(cRaw)) fail(`colleges[${i}]`, "必须是对象");
        const c = cRaw as Record<string, unknown>;
        const bids = c["buildingIds"];
        if (!Array.isArray(bids) || bids.some((b) => typeof b !== "string")) {
          fail(`colleges[${i}].buildingIds`, "必须是字符串数组");
        }
        return {
          no: getNum(c, "no"),
          name: getStr(c, "name"),
          zone: getStr(c, "zone"),
          buildingIds: bids as string[],
          ...(c["confirmed"] === true ? { confirmed: true } : {}),
        };
      });
    }

    if (!("home" in stopsRaw)) fail("stops.home", "缺少 home 停靠点");

    const lookZone = look.zone;
    if (lookZone && typeof lookZone.nodePrefix !== "string") fail("look.zone.nodePrefix", "必须是非空字符串");
    const lookPin = look.pin;
    if (lookPin && typeof lookPin.node !== "string") fail("look.pin.node", "必须是非空字符串");
    if (lookPin && lookPin.node === "") fail("look.pin.node", "不能为空字符串");
  }

  return {
    version, attribution, background, camera: { fov, near, far }, stops, hotspots, buildings, look,
    ...(pack ? { pack } : {}),
    ...(zones ? { zones } : {}),
    ...(shells ? { shells } : {}),
    ...(focus ? { focus } : {}),
    ...(colleges ? { colleges } : {}),
  };
}

/** NIGHT.md 3.2：look 字段。校验不合格时抛带字段名的 Error。 */
function parseLook(raw: Record<string, unknown>): CampusLook {
  const lookRaw = getProp(raw, "look");
  const theme = getStr(lookRaw, "theme");

  const highlightRaw = getProp(lookRaw, "highlight");
  const nodePrefix = getStr(highlightRaw, "nodePrefix");
  const riseMs = getPosNum(highlightRaw, "riseMs");

  const fxRaw = getProp(lookRaw, "fx");
  const fxNode = getStr(fxRaw, "node");
  const speed = getPosNum(fxRaw, "speed");
  const maxFps = getPosNum(fxRaw, "maxFps");

  const introRaw = getProp(lookRaw, "intro");
  const clip = getStr(introRaw, "clip");
  const seconds = getPosNum(introRaw, "seconds");
  const cameraMs = getPosNum(introRaw, "cameraMs");
  const cameraFromRaw = getProp(introRaw, "cameraFrom");
  const cameraFrom: Stop = {
    position: getVec3(cameraFromRaw, "position"),
    target: getVec3(cameraFromRaw, "target"),
  };

  // sway 只有可选的 N6 用；仍按契约校验，缺了不影响 N1–N5
  let sway = { yawDeg: 0, periodSec: 0 };
  if (isObj(lookRaw["sway"])) {
    const swayRaw = lookRaw["sway"] as Record<string, unknown>;
    sway = {
      yawDeg: getPosNum(swayRaw, "yawDeg"),
      periodSec: getPosNum(swayRaw, "periodSec"),
    };
  }

  const hudRaw = getProp(lookRaw, "hud");
  const hud: LookHud = {
    title: getStr(hudRaw, "title"),
    subtitle: getStr(hudRaw, "subtitle"),
    coord: getStr(hudRaw, "coord"),
    scaleLabel: getStr(hudRaw, "scaleLabel"),
    scale100: {},
    scalePoster: { desktop: 0, mobile: 0 },
  };
  const scale100Raw = getProp(hudRaw, "scale100");
  for (const id of Object.keys(raw["stops"] as Record<string, unknown>)) {
    const pair = scale100Raw[id];
    if (!Array.isArray(pair) || pair.length !== 2) {
      fail(`look.hud.scale100.${id}`, "必须是一对点（2 个坐标）");
    }
    const p0 = getVec3Value(pair[0], "point");
    const p1 = getVec3Value(pair[1], "point");
    hud.scale100[id] = [p0, p1];
  }
  const posterRaw = getProp(hudRaw, "scalePoster");
  hud.scalePoster = {
    desktop: getVec2Component(posterRaw, "desktop"),
    mobile: getVec2Component(posterRaw, "mobile"),
  };

  const colorsRaw = getProp(lookRaw, "colors");
  const colors: LookColors = {
    panel: getColor(colorsRaw, "panel"),
    hud: getColor(colorsRaw, "hud"),
    hudDim: getColor(colorsRaw, "hudDim"),
    accent: getColor(colorsRaw, "accent"),
    markerBg: getColor(colorsRaw, "markerBg"),
    markerBorder: getColor(colorsRaw, "markerBorder"),
  };

  // ---- v3（STAGE.md 5.3）的可选字段：缺失时保持 undefined（v2 元数据不受影响）----
  if (typeof hudRaw["scaleMeters"] === "number") {
    hud.scaleMeters = hudRaw["scaleMeters"] as number;
  }
  const zoneRaw = lookRaw["zone"];
  const zone = isObj(zoneRaw)
    ? { nodePrefix: getStr(zoneRaw as Record<string, unknown>, "look.zone.nodePrefix") }
    : undefined;
  const pinRaw = lookRaw["pin"];
  const pin = isObj(pinRaw)
    ? { node: getStr(pinRaw as Record<string, unknown>, "look.pin.node") }
    : undefined;
  const starRaw = lookRaw["star"];
  const star = isObj(starRaw)
    ? {
        home: getVec3(starRaw as Record<string, unknown>, "look.star.home"),
        lift: getPosNum(starRaw as Record<string, unknown>, "look.star.lift"),
      }
    : undefined;
  const signRaw = lookRaw["sign"];
  const sign = isObj(signRaw)
    ? { lift: getPosNum(signRaw as Record<string, unknown>, "look.sign.lift") }
    : undefined;
  const tourRaw = lookRaw["tour"];
  const tour = isObj(tourRaw)
    ? { degPerSec: getPosNum(tourRaw as Record<string, unknown>, "look.tour.degPerSec") }
    : undefined;
  const orbitRaw = lookRaw["orbit"];
  const orbit = isObj(orbitRaw)
    ? {
        minPolarDeg: getPosNum(orbitRaw as Record<string, unknown>, "look.orbit.minPolarDeg"),
        maxPolarDeg: getPosNum(orbitRaw as Record<string, unknown>, "look.orbit.maxPolarDeg"),
        minDistance: getPosNum(orbitRaw as Record<string, unknown>, "look.orbit.minDistance"),
        maxDistance: getPosNum(orbitRaw as Record<string, unknown>, "look.orbit.maxDistance"),
      }
    : undefined;

  return {
    theme,
    highlight: { nodePrefix, riseMs },
    fx: { node: fxNode, speed, maxFps },
    intro: { clip, seconds, cameraMs, cameraFrom },
    sway,
    hud,
    colors,
    ...(zone ? { zone } : {}),
    ...(pin ? { pin } : {}),
    ...(star ? { star } : {}),
    ...(sign ? { sign } : {}),
    ...(tour ? { tour } : {}),
    ...(orbit ? { orbit } : {}),
  };
}

/** 读取 0 到 1 之间的单个数（scalePoster.desktop / mobile）。 */
function getVec2Component(obj: Record<string, unknown>, key: string): number {
  const n = obj[key];
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1) {
    fail(`look.hud.scalePoster.${key}`, `必须是 0 到 1 之间的数（收到 ${String(n)}）`);
  }
  return n;
}
