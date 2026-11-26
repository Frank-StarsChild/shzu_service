// STAGE W5 / 按需定位：回答要不要动镜头。
// 旧规则曾把「正文里第一个楼名」「出处的发布单位」都当成办理地点，问候和借阅规则
// 也会把人拽去图书馆。现在分三级：
//   hold  —— 保持视角（问候、闲聊、政策条件、数量、时间、材料清单…）
//   offer —— 给手动入口（多候选、歧义、跨校区、场景未就绪、只有点名楼栋或纯文字）
//   auto  —— 自动飞（用户明确问位置 + 唯一结构化目标 + 目标就在当前场景里）
// 只有结构化结果（place 卡的 matches / errand 卡的 place）能触发定位；
// 正文楼名与引用发布单位只作为原文展示，不再指挥镜头。

import type { ChatResponse } from "@/api/client";
import type { Places } from "@/stage/packs";

export const EMPTY_PLACES: Places = {
  version: "v3",
  boards: {},
  issuers: {},
  names: [],
  packOf: {},
};

export type PlaceAction = "hold" | "offer" | "auto";

export type PlaceCandidate = {
  buildingId: string;
  name: string;
  /** 当前沙盘上的片区名，或目标所在沙盘名 */
  context: string;
  /** 该楼是否就在当前已加载的沙盘上 */
  inScene: boolean;
  /** 需要换到的沙盘（null = 当前沙盘） */
  packId: string | null;
};

export type PlaceDecision = {
  action: PlaceAction;
  candidates: PlaceCandidate[];
  /** 工具只给了文字地址（没有楼号）时，面板原样显示这段文字 */
  text: string | null;
  reason: string;
};

export type DecidePlaceInput = {
  /** 本轮用户的原话 */
  question: string;
  response: ChatResponse | null;
  places: Places;
  /** 当前沙盘上可以落楼的楼号；null = 场景尚未就绪 */
  inScene: Set<string> | null;
  /** 楼号 → 所在片区名（可选，只用于候选显示） */
  contextOf?: (buildingId: string) => string | null;
  /** 沙盘 id → 沙盘名（可选，跨沙盘候选显示用） */
  packNameOf?: (packId: string) => string | null;
};

const HOLD: PlaceDecision = { action: "hold", candidates: [], text: null, reason: "hold" };

/** 用户是不是在问「位置 / 去哪办」——按整句判断，不只看某个词 */
export function asksLocation(question: string): boolean {
  const s = (question || "").trim();
  if (!s) return false;
  // 「在哪看 / 在哪查 / 在哪下载」问的是资料位置，不是楼栋
  if (/在哪(?:里|儿)?(?:看|查|下载|申请|填写|打印|办理|找到|获取)/.test(s)) return false;
  if (/在哪(?:里|儿)?(?:能|可以)(?:看|查|下载)/.test(s)) return false;
  if (/在哪/.test(s)) return true;
  if (/哪里(?:能|可以|有|买|借|还|办|补|打印)/.test(s)) return true;
  if (/哪(?:一)?(?:栋|座)(?:楼)?/.test(s)) return true;
  if (/去(?:哪|哪儿|哪里)(?:办|补|领|交|取|打|借|送|找|弄)/.test(s)) return true;
  if (/去(?:哪|哪儿|哪里)[？?！!。]?$/.test(s)) return true;
  if (/怎么(?:走|去|到)/.test(s)) return true;
  if (/在沙盘(?:定位|看|找)/.test(s)) return true;
  if (/(?:定位到|指给我看|帮我定位)/.test(s)) return true;
  return false;
}

/** 纯问候/致谢/寒暄：即使误带地点也不动镜头 */
export function isSmallTalk(question: string): boolean {
  const s = (question || "").replace(/[\s，。！？、,.!?~～…]/g, "").toLowerCase();
  if (!s) return true;
  if (/^(你好|您好|hi|hello|嗨|哈喽|在吗|在么|早上好|中午好|下午好|晚上好)/.test(s)) {
    // 「你好，图书馆在哪」仍算问位置（由 asksLocation 先行判断）
    return !asksLocation(question);
  }
  if (/^(谢谢|谢谢你|多谢|感谢|好的|好|嗯|收到|明白了|知道了|ok|okay)/.test(s)) return true;
  return false;
}

type Structured = {
  targets: { id: string; label: string | null }[];
  ambiguous: boolean;
  text: string | null;
};

/** 只从动作卡取结构化楼号：place.matches、errand.place；同一楼号只算一个（保留第一个展示名） */
function collectStructured(response: ChatResponse): Structured {
  const map = new Map<string, string | null>();
  let ambiguous = false;
  let text: string | null = null;
  const add = (id: string, label?: string | null) => {
    if (!map.has(id)) map.set(id, label ?? null);
  };
  for (const a of response.actions ?? []) {
    if (a.kind === "place") {
      if (a.ambiguous) ambiguous = true;
      let any = false;
      for (const m of a.matches ?? []) {
        if (!m.building_id) continue;
        any = true;
        add(m.building_id, m.label || null);
      }
      if (!any && a.fallback_text) text = a.fallback_text;
    }
    if (a.kind === "errand" && a.place?.building_id) {
      add(a.place.building_id, a.place.building || null);
    }
  }
  return { targets: [...map].map(([id, label]) => ({ id, label })), ambiguous, text };
}

/**
 * 用户原话里点名的登记楼栋。优先完整名称：「北区图书馆」先占住这段文字，
 * 里面的「图书馆」不能再算第二个命中。
 */
export function matchNamedBuildings(question: string, places: Places): string[] {
  const q = question || "";
  const sorted = [...places.names].sort((a, b) => (b[0]?.length ?? 0) - (a[0]?.length ?? 0));
  const hits: { id: string; start: number; end: number }[] = [];
  for (const [name, id] of sorted) {
    if (!name || !id) continue;
    let from = 0;
    while (from <= q.length) {
      const pos = q.indexOf(name, from);
      if (pos < 0) break;
      const end = pos + name.length;
      const overlaps = hits.some((h) => pos < h.end && end > h.start);
      if (!overlaps) {
        hits.push({ id, start: pos, end });
        break;
      }
      from = pos + 1;
    }
  }
  return [...new Set(hits.map((h) => h.id))];
}

/** 楼号 → 登记名（places.names 是 [名, 楼号] 的别名表，取第一个） */
export function registeredName(buildingId: string, places: Places): string {
  return places.names.find(([, id]) => id === buildingId)?.[0] ?? buildingId;
}

/**
 * 本轮要不要动镜头、给不给手动入口。纯函数：不改状态、不发请求。
 */
export function decidePlace(input: DecidePlaceInput): PlaceDecision {
  const { question, response, places } = input;
  if (!response) return HOLD;
  if (response.status !== "answer" && response.status !== "insufficient") return HOLD;
  const q = (question || "").trim();
  // 追问选项轮：「怎么补办卡 学生证（含乘车优惠卡）」本身没有「在哪/去哪」。
  // 但办事单（errand）带楼号就说明是到楼办理——按问地点处理，后面的 auto/offer 照旧。
  // 只有学生证补办这类线下办理才有 errand；借书、成绩单打印没有，仍然是 hold。
  const hasErrandBuilding = (response.actions ?? []).some(
    (a) => a.kind === "errand" && !!a.place?.building_id,
  );
  if (!asksLocation(q) && !hasErrandBuilding) return HOLD;
  if (isSmallTalk(q)) return HOLD;

  const { targets, ambiguous, text } = collectStructured(response);

  const toCandidate = (bid: string, label: string | null): PlaceCandidate => {
    const inScene = !!input.inScene?.has(bid);
    const packId = inScene ? null : places.packOf[bid] ?? null;
    const context = (inScene ? input.contextOf?.(bid) : null)
      ?? (packId ? input.packNameOf?.(packId) : null)
      ?? "";
    return {
      buildingId: bid,
      name: label?.trim() || registeredName(bid, places),
      context,
      inScene,
      packId,
    };
  };

  if (targets.length > 1) {
    return {
      action: "offer",
      candidates: targets.map((t) => toCandidate(t.id, t.label)),
      text,
      reason: "multiple",
    };
  }
  if (targets.length === 1) {
    const only = targets[0];
    if (ambiguous) {
      return { action: "offer", candidates: [toCandidate(only.id, only.label)], text, reason: "ambiguous" };
    }
    if (input.inScene === null) {
      return { action: "offer", candidates: [toCandidate(only.id, only.label)], text, reason: "scene-not-ready" };
    }
    if (!input.inScene.has(only.id)) {
      return { action: "offer", candidates: [toCandidate(only.id, only.label)], text, reason: "other-pack" };
    }
    return { action: "auto", candidates: [toCandidate(only.id, only.label)], text, reason: "unique-in-scene" };
  }

  // 没有结构化结果：只认用户明确点名的登记楼栋，且只给手动入口
  const named = matchNamedBuildings(q, places);
  if (named.length) {
    return {
      action: "offer",
      candidates: named.map((bid) => {
        // 点名匹配用登记名展示（places.names 里能对上这一个楼号的名字）
        return toCandidate(bid, places.names.find(([, id]) => id === bid)?.[0] ?? null);
      }),
      text,
      reason: "named-only",
    };
  }
  if (text) return { action: "offer", candidates: [], text, reason: "text-only" };
  return HOLD;
}
