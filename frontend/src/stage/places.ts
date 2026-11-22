// STAGE W5（第 5.5 节）：回答落到哪栋楼。不让大模型猜地点——回答文字里出现的楼名、
// 出处的发布单位，查 places.json 这张表得到楼号；查不到就不动镜头。

import type { ChatResponse } from "@/api/client";
import type { Places } from "@/stage/packs";

export const EMPTY_PLACES: Places = {
  version: "v3",
  boards: {},
  issuers: {},
  names: [],
  packOf: {},
};

/**
 * 纯函数，按定位证据强度从高到低：
 * 0. actions 里工具核算过的定位（place 卡 matches[0].building_id、errand 卡 place.building_id）
 *    ——后端已把办事窗口映射到沙盘楼栋，明确可靠，优先于文字猜测；
 * 1. 只处理 status === 'answer'，别的状态返回 null。
 * 2. 按顺序看 answer.blocks 每段 text：找出 names 中出现过的名字，取出现位置
 *    最靠前的；位置相同取更长的。选中的名字对到楼号就用它；对到 null（位置
 *    未确认）或该段没有名字：看下一段。
 * 3. 所有段落都没有楼名：按顺序看 citations，第一个 issuer 在 issuers 表里的用它。
 * 4. 还没有：null。
 */
export function resolvePlace(response: ChatResponse, places: Places): string | null {
  if (response.status !== "answer") return null;
  for (const a of response.actions ?? []) {
    if (a.kind === "place") {
      const bid = a.matches?.find((m) => m.building_id)?.building_id;
      if (bid) return bid;
    }
    if (a.kind === "errand" && a.place?.building_id) {
      return a.place.building_id;
    }
  }
  for (const block of response.answer?.blocks ?? []) {
    const text = block.text ?? "";
    let chosen: { name: string; id: string | null; pos: number } | null = null;
    for (const [name, id] of places.names) {
      const pos = text.indexOf(name);
      if (pos < 0) continue;
      if (
        chosen === null
        || pos < chosen.pos
        || (pos === chosen.pos && name.length > chosen.name.length)
      ) {
        chosen = { name, id, pos };
      }
    }
    if (chosen) {
      if (chosen.id) return chosen.id; // 用它，不再往下看
      // 对到 null：这一段当作没有楼名，接着看下一段
    }
  }
  for (const c of response.citations ?? []) {
    const id = places.issuers[c.issuer] ?? null;
    if (id) return id;
  }
  return null;
}
