// 校区学院行的唯一数据源：右侧面板的序号、地图上的序号角标、灯牌顺序都从这里取。
// 规则与 W9 面板一致：只看当前片区；一栋楼只占一行（同楼多学院归到同一行，
// 行内 colleges 保留全部，选择路径仍按楼）；楼号优先取「当前沙盘上真有的第一栋」，
// 不再是写死 buildingIds[0]（中区沙盘里生命科学学院的第一栋在别的片区）。
import type { CampusMeta } from "@/campus3d/meta";
import type { College, Emblems } from "@/stage/emblems";

export type Vec3 = [number, number, number];

export type CollegeEntry = {
  /** 与面板行号一致（1 起） */
  index: number;
  /** 这一行对应的楼（当前沙盘上的第一栋；都没有时退回 buildingIds[0] 或空串） */
  buildingId: string;
  /** 楼顶锚点（没有就不在地图上标） */
  anchor: Vec3 | null;
  /** 去掉括号的全名 */
  name: string;
  fullName: string;
  buildingName: string;
  confirmed: boolean;
  /** 同楼的学院（>=1，按 meta 顺序） */
  colleges: College[];
  /** 这一行里第一所有院徽的学院（用于灯牌/院徽标记） */
  emblem: College | null;
};

export function stripParens(s: string): string {
  return s.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
}

/**
 * 学院行。zoneId 为 null 表示「整包」（校区沙盘首页），否则只算该片区。
 * 同一个 buildingId 的多个学院归并成一行；行序 = meta.colleges 里首次出现的顺序。
 */
export function collegeEntries(
  meta: CampusMeta | null,
  emblems: Emblems | null,
  zoneId: string | null,
): CollegeEntry[] {
  if (!meta?.colleges) return [];
  const byBid = new Map<string, CollegeEntry>();
  const out: CollegeEntry[] = [];

  for (const mc of meta.colleges) {
    if (zoneId !== null && mc.zone !== zoneId) continue;
    const own = emblems?.colleges.find((c) => c.no === mc.no) ?? null;
    // 楼：优先当前沙盘上真有的第一栋（同 A2 灯牌的取法），没有就退回第一栋
    const onPack = own?.buildingIds.find((id) => !!meta.buildings[id]);
    const bid = onPack ?? own?.buildingIds[0] ?? mc.buildingIds[0] ?? "";
    if (!bid) continue;

    const existing = byBid.get(bid);
    if (existing) {
      if (own) {
        existing.colleges.push(own);
        if (!existing.emblem) existing.emblem = own;
      }
      continue;
    }

    const b = meta.buildings[bid];
    const entry: CollegeEntry = {
      index: out.length + 1,
      buildingId: bid,
      anchor: b?.anchor ?? null,
      name: stripParens(mc.name),
      fullName: mc.name,
      buildingName: b?.name ?? bid,
      confirmed: mc.confirmed === true,
      colleges: own ? [own] : [],
      emblem: own,
    };
    byBid.set(bid, entry);
    out.push(entry);
  }

  return out;
}

/** 学院号 → 面板行号（同楼第二所学院没有自己的行号，返回它所在行的行号） */
export function indexOfCollege(entries: CollegeEntry[], no: number): number | null {
  for (const e of entries) if (e.colleges.some((c) => c.no === no)) return e.index;
  return null;
}
