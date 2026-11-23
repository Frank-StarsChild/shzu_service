// ALIVE A5：智多星「在想」的回放数据。
// 前端不接后端实时流：用「发出提问 / 回答回来」两个时刻 + 回答里的出处，
// 把 读题 → 翻查 → 核证 → 作答 演出来。出处的发布单位查 places.issuers 得楼号。
import type { ChatResponse } from "@/api/client";
import type { Places } from "@/stage/packs";
import type { CampusMeta } from "@/campus3d/meta";

export type TracePhase = "idle" | "read" | "search" | "verify" | "answer" | "error";

export type TraceHit = {
  /** 出处里的原始发布单位（用于去重与查楼） */
  issuer: string;
  /** 题签上的短名（学生处 / 图书馆 …） */
  label: string;
  /** 这个部门落在哪栋楼；楼不在当前沙盘上时为 null */
  buildingId: string | null;
  /** 该单位名下几条出处 */
  count: number;
};

export type Trace = {
  phase: TracePhase;
  requestId: string | null;
  /** 翻查题签上的问题（前 10 个字） */
  query: string | null;
  hits: TraceHit[];
  /** 审定资料总条数 */
  evidence: number;
  /** A6 实时版用；回放版恒为 false */
  live: boolean;
};

export const IDLE_TRACE: Trace = {
  phase: "idle",
  requestId: null,
  query: null,
  hits: [],
  evidence: 0,
  live: false,
};

/** 「石河子大学党委学生工作部（学生处）」→「学生处」；「石河子大学图书馆」→「图书馆」 */
export function issuerLabel(issuer: string): string {
  const full = /（([^）]+)）/.exec(issuer);
  if (full?.[1]) return full[1].trim();
  const half = /\(([^)]+)\)/.exec(issuer);
  if (half?.[1]) return half[1].trim();
  let s = issuer.trim();
  if (s.startsWith("石河子大学")) s = s.slice("石河子大学".length);
  if (s.startsWith("党委")) s = s.slice("党委".length);
  return s.trim() || issuer.trim();
}

/**
 * 出处 → 部门命中：按 citations 顺序把同一 issuer 合成一条（count 为条数），
 * 最多 5 条；楼号查 places.issuers，但不在当前沙盘 meta.buildings 里时记 null。
 */
export function traceFromResponse(
  response: ChatResponse,
  places: Places,
  meta: CampusMeta | null,
): Pick<Trace, "hits" | "evidence"> {
  if (response.status !== "answer" && response.status !== "insufficient") {
    return { hits: [], evidence: 0 };
  }
  const hits: TraceHit[] = [];
  const index = new Map<string, TraceHit>();
  for (const c of response.citations ?? []) {
    const existing = index.get(c.issuer);
    if (existing) {
      existing.count += 1;
      continue;
    }
    if (hits.length >= 5) continue;
    const bid = places.issuers[c.issuer] ?? null;
    const hit: TraceHit = {
      issuer: c.issuer,
      label: issuerLabel(c.issuer),
      buildingId: bid && meta?.buildings[bid] ? bid : null,
      count: 1,
    };
    index.set(c.issuer, hit);
    hits.push(hit);
  }
  return { hits, evidence: (response.citations ?? []).length };
}

/** 翻查题签：去掉首尾空白，取前 10 个字符 */
export function queryOf(question: string): string {
  return question.trim().slice(0, 10);
}
