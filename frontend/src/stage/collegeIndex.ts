// 校区学院名单的唯一数据源：右侧面板的每一行、地图灯牌与序号角标都从这里取。
// 规则（本次修正）：
//  - 以「学院号 no」识别学院；楼号只用于选楼与地图避让。一栋楼上的两所学院各占一行。
//  - 选中某个校区时，先看学院归属（meta.colleges[].zone），再看它在当前包里有没有落在
//    这个片区的楼：归属一致 → 本区；归属不同但当地有楼 → 跨区教学楼（用当地那栋）；
//    归属在附属片区（南区 ↔ FY / HX）→ 附属片区。
//  - 本包没有但项目清单里属于该附属片区、没有楼且未定位的学院（护理学院（筹））
//    生成一条只展示信息的行（楼号、锚点为空）。
//  - 位置确认状态单列：confirmed 为假（公共卫生学院）或没有可定位的楼时，行不可导航。
import type { CampusMeta } from "@/campus3d/meta";
import type { College, Emblems } from "@/stage/emblems";

export type Vec3 = [number, number, number];

/** 附属片区关系：南区沙盘同时包含 NQ / FY / HX，但左栏仍只有六个校区 */
export const AFFILIATED_ZONES: Record<string, string[]> = {
  NQ: ["FY", "HX"],
};

/** 片区名兜底（跨区行要写「学院归属北区」；当前包只含本片区时 meta.zones 里没有别的片区名）。
 *  来源：packs.json 的六个校区名 + 各包 meta.zones 里的附属单位名。 */
const ZONE_LABELS: Record<string, string> = {
  BY: "北苑新区",
  BQ: "北区",
  ZQ: "中区",
  NQ: "南区",
  DQ: "东区",
  JJ: "将军山",
  FY: "第一附属医院",
  HX: "护士学校",
};

export type CollegeGroup = "zone" | "cross" | "affiliated";

export type CollegeRow = {
  /** 学院号（唯一标识；面板 key、选中态、灯牌都用它） */
  no: number;
  /** 面板行号（分组后全局连续，1 起） */
  index: number;
  /** 去掉括号的学院名（护理学院（筹）保留原样） */
  name: string;
  fullName: string;
  /** 院徽数据（拿不到 emblems 时为 null，行照常显示） */
  college: College | null;
  /** 可用的楼号；空串 = 没有可定位地址 */
  buildingId: string;
  anchor: Vec3 | null;
  buildingName: string;
  /** 位置是否确认（false 时面板写「位置待确认」且不可导航） */
  confirmed: boolean;
  /** 有楼且有锚点，可以落到地图上 */
  canLocate: boolean;
  group: CollegeGroup;
  /** 同组里还有别的学院用同一栋楼（面板标「共用」） */
  sharedBuilding: boolean;
  /** 学院归属的片区名（跨区行用来写「学院归属北区」） */
  homeZoneName: string;
};

export function stripParens(s: string): string {
  return s.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim();
}

/** 当前沙盘上与 zoneId 关联的附属片区（只保留本包确实包含的） */
export function affiliatedZonesOf(meta: CampusMeta | null, zoneId: string | null): string[] {
  if (!meta || !zoneId) return [];
  const have = new Set((meta.zones ?? []).map((z) => z.id));
  return (AFFILIATED_ZONES[zoneId] ?? []).filter((z) => have.has(z));
}

type Draft = {
  no: number;
  name: string;
  fullName: string;
  college: College | null;
  buildingId: string;
  group: CollegeGroup;
  confirmed: boolean;
  homeZone: string;
};

/**
 * 学院行。zoneId 为 null 表示「整包」（校区沙盘首页），否则只列与该片区相关的学院。
 * 同一个校区画面里同一个学院只出现一次（按 no 去重）。
 */
export function collegeEntries(
  meta: CampusMeta | null,
  emblems: Emblems | null,
  zoneId: string | null
): CollegeRow[] {
  if (!meta) return [];
  const m = meta;
  const affiliated = affiliatedZonesOf(m, zoneId);
  const zoneName = (id: string | null | undefined): string =>
    (id && m.zones?.find((z) => z.id === id)?.name) || (id ? ZONE_LABELS[id] ?? id : "");

  /** 在这组楼号里挑第一栋「当前沙盘有、且落在允许的片区」的楼 */
  const pickBuilding = (ids: string[], allowed: string[] | null): string => {
    for (const id of ids) {
      const b = m.buildings[id];
      if (!b) continue;
      if (!allowed || allowed.includes(b.zone ?? "")) return id;
    }
    return "";
  };

  const drafts: Draft[] = [];
  const seen = new Set<number>();

  for (const mc of m.colleges ?? []) {
    if (seen.has(mc.no)) continue;
    const own = emblems?.colleges.find((c) => c.no === mc.no) ?? null;
    const ids = mc.buildingIds ?? [];
    // parseMeta 只保留显式的 confirmed: true，缺省按「未确认」处理
    const confirmed = mc.confirmed === true;

    if (zoneId === null) {
      // 整包视图：每所学院一行，楼取当前包上第一栋
      const bid = pickBuilding(ids, null) || (own ? pickBuilding(own.buildingIds, null) : "");
      drafts.push({
        no: mc.no,
        name: stripParens(mc.name),
        fullName: mc.name,
        college: own,
        buildingId: bid,
        group: "zone",
        confirmed,
        homeZone: mc.zone,
      });
      seen.add(mc.no);
      continue;
    }

    const localBid = pickBuilding(ids, [zoneId]);

    if (!confirmed) {
      // 待确认：只在本区组里露个名字与院徽，不给地址
      if (mc.zone === zoneId) {
        drafts.push({
          no: mc.no,
          name: stripParens(mc.name),
          fullName: mc.name,
          college: own,
          buildingId: "",
          group: "zone",
          confirmed: false,
          homeZone: mc.zone,
        });
        seen.add(mc.no);
      }
      continue;
    }

    if (mc.zone === zoneId) {
      drafts.push({
        no: mc.no,
        name: stripParens(mc.name),
        fullName: mc.name,
        college: own,
        buildingId: localBid,
        group: "zone",
        confirmed: true,
        homeZone: mc.zone,
      });
      seen.add(mc.no);
      continue;
    }

    if (localBid) {
      // 归属在别的片区，但在本片区有教学楼
      drafts.push({
        no: mc.no,
        name: stripParens(mc.name),
        fullName: mc.name,
        college: own,
        buildingId: localBid,
        group: "cross",
        confirmed: true,
        homeZone: mc.zone,
      });
      seen.add(mc.no);
      continue;
    }

    if (mc.zone && affiliated.includes(mc.zone)) {
      const affBid = pickBuilding(ids, affiliated);
      drafts.push({
        no: mc.no,
        name: stripParens(mc.name),
        fullName: mc.name,
        college: own,
        buildingId: affBid,
        group: "affiliated",
        confirmed: true,
        homeZone: mc.zone,
      });
      seen.add(mc.no);
    }
  }

  // 本包没有登记、但项目清单里属于这个附属片区且没有楼的学院（护理学院（筹））
  if (zoneId !== null && affiliated.length > 0) {
    for (const c of emblems?.colleges ?? []) {
      if (seen.has(c.no)) continue;
      if (!c.zone || !affiliated.includes(c.zone)) continue;
      if (c.located === true) continue;
      if ((c.buildingIds ?? []).some((id) => !!m.buildings[id])) continue;
      drafts.push({
        no: c.no,
        name: c.name, // 保留「（筹）」
        fullName: c.name,
        college: c,
        buildingId: "",
        group: "affiliated",
        confirmed: false,
        homeZone: c.zone,
      });
      seen.add(c.no);
    }
  }

  const order: CollegeGroup[] = ["zone", "cross", "affiliated"];
  drafts.sort(
    (a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.no - b.no
  );

  const counts = new Map<string, number>();
  for (const d of drafts) {
    if (!d.buildingId) continue;
    const k = `${d.group}|${d.buildingId}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  return drafts.map((d, i) => {
    const b = d.buildingId ? m.buildings[d.buildingId] : null;
    return {
      no: d.no,
      index: i + 1,
      name: d.name,
      fullName: d.fullName,
      college: d.college,
      buildingId: d.buildingId,
      anchor: b?.anchor ?? null,
      buildingName: b?.name ?? "",
      confirmed: d.confirmed,
      canLocate: !!d.buildingId && !!b?.anchor,
      group: d.group,
      sharedBuilding:
        !!d.buildingId && (counts.get(`${d.group}|${d.buildingId}`) ?? 0) > 1,
      homeZoneName: zoneName(d.homeZone),
    };
  });
}

/** 学院号 → 面板行号 */
export function indexOfCollege(rows: CollegeRow[], no: number): number | null {
  for (const r of rows) if (r.no === no) return r.index;
  return null;
}
