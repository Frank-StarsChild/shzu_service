// STAGE W6：首页（/）进舞台还是普通版。decideEntry 是纯函数（可穷举测试），规则表见
// cards/W6.md 第 1 条：从上到下，命中第一条就返回。读浏览器（?stage=、localStorage、
// decideMode 结果、视口宽）由 EntryView 在挂载时做一次，判定结果本页不再变。
//
// entryIsStage：/ 上 EntryView 渲染的是不是舞台。App.vue 的顶栏和页脚靠它和
// route.meta.stage 一起决定显隐（路由切换离开 / 时 EntryView 卸载，自动复位）。

import { ref } from "vue";

export type EntryInput = {
  /** 现有 decideMode() 的结果（静态版设备的首页只能是普通版） */
  mode: "static" | "scene";
  viewportWidth: number;
  /** 地址栏 ?stage= 的值 */
  queryStage: "1" | "0" | null;
  /** localStorage 的 shzu.stage 是否为 'classic'（在舞台上点过「普通版」） */
  prefer: "classic" | null;
};

export type EntryResult = { stage: boolean; reason: string };

export function decideEntry(input: EntryInput): EntryResult {
  if (input.queryStage === "0") return { stage: false, reason: "query-off" };
  if (input.mode === "static") return { stage: false, reason: "static" };
  if (input.viewportWidth < 1100) return { stage: false, reason: "narrow" };
  if (input.queryStage === "1") return { stage: true, reason: "query-on" };
  if (input.prefer === "classic") return { stage: false, reason: "prefer-classic" };
  return { stage: true, reason: "default" };
}

/** EntryView 维护的响应式标记（True = / 正在渲染舞台）；App.vue 联动用 */
export const entryIsStage = ref(false);
