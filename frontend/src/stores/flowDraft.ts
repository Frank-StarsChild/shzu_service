// 办事体验改造：向导草稿持久化 + 聊天带入的预设事实登记。
//
// 草稿按「会话 × 事项」隔离（localStorage）：
// - 同一会话重进同一事项 → 恢复已确认值/手动修改值/当前步骤（手动修改优先于聊天预设）；
// - 新会话或另一事项 → 各自独立，互不串数据；
// - 打开证据页再返回 → 草稿仍在原步骤（WorkflowView 重新挂载时从这里恢复）。
//
// 预设（preset）是「学生在当前会话里自己说过的第一人称事实」（后端 seed_slots 抽取，
// 如 本科/二年级），仅在向导首进入（无草稿）或缺项时待确认带入；确认/跳过后不再出现。
export type FlowDraft = {
  flowId: string;
  flowName: string;
  inputs: Record<string, any>;
  stepIndex: number;
  historicalConfirmed: boolean;
  /** 已确认/已跳过的预设槽位（避免重进时重复弹确认卡） */
  presetConfirmedKeys: string[];
  updatedAt: number;
  /** 摘要：上次停在哪一步（步骤名）与下一项要补什么（必填槽位 label） */
  stepName: string;
  nextTodo: string | null;
};

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

const KEY_PREFIX = "shzu.flow.draft.";

export function draftKey(sessionId: string, flowId: string): string {
  return `${KEY_PREFIX}${sessionId}:${flowId}`;
}

export function parseDraft(raw: string | null): FlowDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw);
    if (!d || typeof d !== "object" || typeof d.flowId !== "string") return null;
    return {
      flowId: String(d.flowId),
      flowName: String(d.flowName || ""),
      inputs: (d.inputs && typeof d.inputs === "object") ? d.inputs : {},
      stepIndex: Number.isInteger(d.stepIndex) && d.stepIndex >= 0 ? d.stepIndex : 0,
      historicalConfirmed: !!d.historicalConfirmed,
      presetConfirmedKeys: Array.isArray(d.presetConfirmedKeys) ? d.presetConfirmedKeys : [],
      updatedAt: Number(d.updatedAt) || 0,
      stepName: String(d.stepName || ""),
      nextTodo: (d.nextTodo == null || d.nextTodo === "") ? null : String(d.nextTodo),
    };
  } catch {
    return null;
  }
}

export function loadDraft(sessionId: string, flowId: string, storage: StorageLike | null = defaultStorage()): FlowDraft | null {
  if (!storage || !sessionId || !flowId) return null;
  try {
    return parseDraft(storage.getItem(draftKey(sessionId, flowId)));
  } catch {
    return null;
  }
}

export function saveDraft(sessionId: string, draft: FlowDraft, storage: StorageLike | null = defaultStorage()): void {
  if (!storage || !sessionId || !draft.flowId) return;
  try {
    storage.setItem(draftKey(sessionId, draft.flowId), JSON.stringify(draft));
  } catch {
    // 隐私模式/配额：草稿写不进去时静默失败（不影响当前会话内的填写）
  }
}

/** 全部草稿（新→旧）。首页「继续办理」用；解析失败的单条跳过。
 *  返回 { sessionId, draft }：sessionId 是草稿归属的聊天会话（从存储键解析），
 *  跳转 /workflows/{id}?draft={sessionId} 恢复那份草稿。 */
export function listDrafts(
  storage: StorageLike | null = defaultStorage()
): { sessionId: string; draft: FlowDraft }[] {
  if (!storage) return [];
  const out: { sessionId: string; draft: FlowDraft }[] = [];
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k || !k.startsWith(KEY_PREFIX)) continue;
      const rest = k.slice(KEY_PREFIX.length);
      const sep = rest.indexOf(":");
      const sessionId = sep > 0 ? rest.slice(0, sep) : "";
      const draft = parseDraft(storage.getItem(k));
      if (draft && sessionId) out.push({ sessionId, draft });
    }
  } catch {
    return out;
  }
  return out.sort((a, b) => b.draft.updatedAt - a.draft.updatedAt);
}

/** 由 detail 计算摘要字段（保存草稿时调用）：上次步骤名 + 第一个未填的必填项。 */
export function draftSummary(draft: FlowDraft, steps: { name: string }[], slots: { key: string; label: string; required: boolean }[]): void {
  draft.stepName = steps[draft.stepIndex]?.name ?? steps[0]?.name ?? "";
  const missing = (slots || []).find(
    (s) => s.required && String(draft.inputs[s.key] ?? "").trim() === ""
  );
  draft.nextTodo = missing ? missing.label : null;
}

// ---------- 预设事实登记（内存注册表：聊天入口 → 向导页跨路由传递） ----------

type PresetEntry = { slots: Record<string, any>; note: string };
const presetRegistry = new Map<string, PresetEntry>();

/** 从聊天里的向导入口点击「进入向导」时登记（同事项后写覆盖先写）。 */
export function setFlowPreset(flowId: string, slots: Record<string, any> | null | undefined, note?: string | null): void {
  if (!flowId || !slots || Object.keys(slots).length === 0) return;
  presetRegistry.set(flowId, { slots, note: note || "" });
}

/** 向导页挂载时取出（不删除：同路由内重复挂载仍能拿到）。 */
export function getFlowPreset(flowId: string): PresetEntry | null {
  return presetRegistry.get(flowId) ?? null;
}
