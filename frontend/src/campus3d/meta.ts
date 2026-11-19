// PLAN S2（第 3.2 节）：campus.meta.json 的类型与解析。
// 纯函数：不合契约时抛 Error，信息里写明是哪个字段。
// 楼名、说明、署名一律来自 meta，代码里不许写死（PLAN 规则 8）。

export type Vec2 = [number, number];
export type Vec3 = [number, number, number];

/** 镜头停靠点。overview 为全景，其余五个与热点一一对应。 */
export type StopId = "overview" | "xg" | "jw" | "hq" | "bw" | "lib";

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
}

export interface CampusMeta {
  version: string;
  attribution: string;
  background: string;
  camera: CameraConfig;
  stops: Record<StopId, Stop>;
  hotspots: Hotspot[];
  buildings: Record<string, BuildingInfo>;
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
  const raw = obj[path.split(".").pop() ?? path];
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
    buildings[id] = { name, ...(category !== undefined ? { category } : {}), ...(anchor ? { anchor } : {}) };
  }

  const hotspotsRaw = raw["hotspots"];
  if (!Array.isArray(hotspotsRaw) || hotspotsRaw.length !== 5) {
    fail("hotspots", `必须恰好 5 个热点（收到 ${Array.isArray(hotspotsRaw) ? hotspotsRaw.length : "非数组"} 个）`);
  }
  const hotspots: Hotspot[] = hotspotsRaw.map((hRaw, i) => {
    if (!isObj(hRaw)) fail(`hotspots[${i}]`, "必须是对象");
    const h = hRaw as Record<string, unknown>;
    const no = getStr(h, "no");
    if (no !== `0${i + 1}`) fail(`hotspots[${i}].no`, `应为 "${`0${i + 1}`}"（收到 "${no}"）`);
    const board = getStr(h, "board");
    if (board !== BOARDS[i]) fail(`hotspots[${i}].board`, `应为「${BOARDS[i]}」（收到「${board}」）`);
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

  return { version, attribution, background, camera: { fov, near, far }, stops, hotspots, buildings };
}
