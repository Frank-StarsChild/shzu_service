// ALIVE A1（3.1/7.2 节）：读 24 个学院的院徽清单。纯函数 + 一次性加载。
// 后面的卡（灯牌/罗盘/题签/办理地点）都从这里拿学院数据；emblems 为 null 时一律不画。
import type { Places } from "@/stage/packs";
import type { CampusMeta } from "@/campus3d/meta";

export type College = {
  no: number;
  name: string;
  short: string;
  zone: string;
  buildingIds: string[];
  located: boolean;
  color: string | null;
  mask: string;
  kind: "emblem" | "emblem+seal" | "fallback";
  year: number | null;
  note: string | null;
  dial: { slot: number; mountain: string; deg: number };
};

export type Emblems = {
  version: string;
  size: number;
  dial: {
    mountains: string;
    stepDeg: number;
    svg: string;
    viewBox: number;
    emblemRadius: number;
    emblemSize: number;
  };
  colleges: College[];
};

/** 资产的绝对地址。CSS 变量里的 url()（含 mask）按样式表位置解析相对地址，必须传绝对的 */
export function emblemUrl(path: string): string {
  return new URL("/campus3d/" + path, location.origin).href;
}

let cached: Promise<Emblems> | null = null;

/** 取 /campus3d/emblems/emblems.json（只取一次）。colleges 不是 24 条时抛错。 */
export function loadEmblems(): Promise<Emblems> {
  if (!cached) {
    cached = fetch("/campus3d/emblems/emblems.json")
      .then((r) => {
        if (!r.ok) throw new Error(`emblems.json HTTP ${r.status}`);
        return r.json() as Promise<Emblems>;
      })
      .then((e) => {
        if (!e || !Array.isArray(e.colleges) || e.colleges.length !== 24) {
          throw new Error(`emblems.json colleges 应为 24 条，实际 ${e?.colleges?.length}`);
        }
        return e;
      })
      .catch((e) => {
        cached = null; // 失败不缓存，下次进来可以重试
        throw e;
      });
  }
  return cached;
}

/** 学院名去掉全角括号及里面的内容（「信息科学与技术学院（网络空间安全学院）」→「信息科学与技术学院」） */
export function shortName(c: College): string {
  return c.name.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "");
}

/** buildingIds 里有这个楼号的学院，按 no 从小到大 */
export function collegesOfBuilding(emblems: Emblems, buildingId: string): College[] {
  return emblems.colleges
    .filter((c) => c.buildingIds.includes(buildingId))
    .sort((a, b) => a.no - b.no);
}

/**
 * 这栋楼对应回答里的哪个学院：
 * - 楼上只有一个学院 → 它；没有 → null；
 * - 有几个（如工科楼是机电+水建）→ 在 texts 里按顺序找每个学院的 name（去括号）
 *   和 short，出现位置最靠前的胜出——同一段内比位置，前一段出现的优先于后一段；
 * - 没有一个出现 → 返回 no 最小的。
 */
export function collegeForPlace(emblems: Emblems, buildingId: string, texts: string[]): College | null {
  const list = collegesOfBuilding(emblems, buildingId);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  let best: College | null = null;
  let bestSeg = Infinity;
  let bestPos = Infinity;
  for (let seg = 0; seg < texts.length; seg++) {
    const text = texts[seg] ?? "";
    let hit = false;
    for (const c of list) {
      for (const needle of [shortName(c), c.short]) {
        if (!needle) continue;
        const pos = text.indexOf(needle);
        if (pos < 0) continue;
        if (seg < bestSeg || (seg === bestSeg && pos < bestPos)) {
          best = c;
          bestSeg = seg;
          bestPos = pos;
          hit = true;
        }
      }
    }
    if (hit) {
      return best; // 本段已有命中，不往后面的段落看
    }
  }
  // 没有一个名字出现：no 最小的
  return best ?? list[0];
}

/** ALIVE A8：打字预判命中的地点 */
export type Mention = {
  buildingId: string;
  collegeNo: number | null;
  /** 命中的那个名字（原样） */
  label: string;
};

/**
 * ALIVE A8：在输入里找地点名（纯前端，不调后端）。
 * 候选：places.names 里有楼号的名字 + 24 个学院去掉括号的全名（不用两字简称，
 * 「理学」会误中「物理学」）。取出现位置最靠前的；同位置取更长的；楼不在当前
 * 沙盘上的候选直接跳过。collegeNo 优先用命中的学院，否则用这栋楼上第一个学院。
 */
export function findMention(
  text: string,
  places: Places | null,
  emblems: Emblems | null,
  meta: CampusMeta | null
): Mention | null {
  if (!text || !meta) return null;
  type Cand = { name: string; buildingId: string; collegeNo: number | null };
  const cands: Cand[] = [];
  for (const [name, bid] of places?.names ?? []) {
    if (!bid || name.length < 2) continue;
    cands.push({ name, buildingId: bid, collegeNo: null });
  }
  for (const c of emblems?.colleges ?? []) {
    const nm = shortName(c);
    if (!nm || nm.length < 2) continue;
    const bid = c.buildingIds.find((id) => !!meta.buildings[id]);
    if (!bid) continue;
    cands.push({ name: nm, buildingId: bid, collegeNo: c.no });
  }

  let best: { pos: number; len: number; cand: Cand } | null = null;
  for (const cand of cands) {
    if (!meta.buildings[cand.buildingId]) continue;
    const pos = text.indexOf(cand.name);
    if (pos < 0) continue;
    if (
      !best
      || pos < best.pos
      || (pos === best.pos && cand.name.length > best.len)
    ) {
      best = { pos, len: cand.name.length, cand };
    }
  }
  if (!best) return null;

  let collegeNo = best.cand.collegeNo;
  if (collegeNo === null && emblems) {
    collegeNo = collegesOfBuilding(emblems, best.cand.buildingId)[0]?.no ?? null;
  }
  return { buildingId: best.cand.buildingId, collegeNo, label: best.cand.name };
}
