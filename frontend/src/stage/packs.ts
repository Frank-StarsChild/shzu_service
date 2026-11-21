// STAGE W1（第 5.2、5.5 节）：资产包 v3 的读取与类型。
// 纯函数 + fetch 加载；后端对找不到的文件会回 200+首页 HTML，因此必须检查 content-type。

import { parseMeta, type CampusMeta } from "@/campus3d/meta";

export type Pack = {
  id: string;
  name: string;
  dir: string;
  note?: string;
  meta: string;
  glb: string;
  posterDesktop: string;
  posterMobile: string;
  version: string;
};

export type CampusZoneRef = {
  id: string;
  name: string;
  pack: string;
  buildings: number;
  stop: string;
};

export type PackIndex = {
  version: string;
  default: string;
  packs: Pack[];
  campuses: CampusZoneRef[];
};

export type Places = {
  version: string;
  boards: Record<string, string>;
  issuers: Record<string, string>;
  names: [string, string | null][];
  packOf: Record<string, string>;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(field: string, msg: string): never {
  throw new Error(`packs.json：${field} ${msg}`);
}

/** 校验 packs.json（W1 验证第 1 条的反例都靠它抛错）。 */
export function parsePackIndex(json: unknown): PackIndex {
  if (!isObj(json)) fail("（根）", "必须是 JSON 对象");
  const version = json["version"];
  if (version !== "v3") fail("version", `必须是 "v3"（收到 ${JSON.stringify(version)}）`);
  const def = json["default"];
  const packsRaw = json["packs"];
  if (!Array.isArray(packsRaw) || packsRaw.length === 0) fail("packs", "必须是非空数组");
  const packs: Pack[] = packsRaw.map((p, i) => {
    if (!isObj(p)) fail(`packs[${i}]`, "必须是对象");
    for (const k of ["id", "name", "dir", "meta", "glb", "posterDesktop", "posterMobile"] as const) {
      const v = p[k];
      if (typeof v !== "string" || v === "") fail(`packs[${i}].${k}`, "必须是非空字符串");
    }
    return {
      id: p["id"] as string,
      name: p["name"] as string,
      dir: p["dir"] as string,
      note: typeof p["note"] === "string" ? p["note"] : undefined,
      meta: p["meta"] as string,
      glb: p["glb"] as string,
      posterDesktop: p["posterDesktop"] as string,
      posterMobile: p["posterMobile"] as string,
      version: typeof p["version"] === "string" ? p["version"] : "",
    };
  });
  const packIds = new Set(packs.map((p) => p.id));
  if (typeof def !== "string" || !packIds.has(def)) fail("default", "必须是某个包的 id");
  const campusesRaw = json["campuses"];
  if (!Array.isArray(campusesRaw)) fail("campuses", "必须是数组");
  const campuses: CampusZoneRef[] = campusesRaw.map((c, i) => {
    if (!isObj(c)) fail(`campuses[${i}]`, "必须是对象");
    for (const k of ["id", "name", "pack", "stop"] as const) {
      const v = c[k];
      if (typeof v !== "string" || v === "") fail(`campuses[${i}].${k}`, "必须是非空字符串");
    }
    if (!packIds.has(c["pack"] as string)) {
      fail(`campuses[${i}].pack`, `"${String(c["pack"])}" 不是任何包的 id`);
    }
    return {
      id: c["id"] as string,
      name: c["name"] as string,
      pack: c["pack"] as string,
      buildings: typeof c["buildings"] === "number" ? c["buildings"] : 0,
      stop: c["stop"] as string,
    };
  });
  return { version, default: def, packs, campuses };
}

export function packUrl(path: string): string {
  return "/campus3d/" + path.replace(/^\//, "");
}

async function fetchJson(url: string): Promise<unknown> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`加载失败 HTTP ${resp.status}：${url}`);
  const ctype = resp.headers.get("content-type") || "";
  if (!ctype.includes("json")) {
    throw new Error(`返回的不是 JSON（content-type: ${ctype}）：${url}`);
  }
  return resp.json();
}

export async function loadPackIndex(): Promise<PackIndex> {
  return parsePackIndex(await fetchJson(packUrl("packs.json")));
}

export async function loadPackMeta(index: PackIndex, id: string): Promise<CampusMeta> {
  const pack = index.packs.find((p) => p.id === id);
  if (!pack) throw new Error(`不存在的资产包：${id}`);
  const raw = await fetchJson(packUrl(pack.meta));
  return parseMeta(raw);
}

export async function loadPlaces(): Promise<Places> {
  const json = (await fetchJson(packUrl("places.json"))) as Record<string, unknown>;
  const version = json["version"];
  if (version !== "v3") throw new Error(`places.json：version 必须是 "v3"（收到 ${JSON.stringify(version)}）`);
  return {
    version: "v3",
    boards: (json["boards"] ?? {}) as Record<string, string>,
    issuers: (json["issuers"] ?? {}) as Record<string, string>,
    names: (json["names"] ?? []) as [string, string | null][],
    packOf: (json["packOf"] ?? {}) as Record<string, string>,
  };
}
