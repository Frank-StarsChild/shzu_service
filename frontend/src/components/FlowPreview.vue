<script setup lang="ts">
// 办事体验改造：向导右侧的实时申请表预览。
// - 奖学金流程用「申请表样式」（与导出 Word 的栏目对应）；
// - 其它流程退化为通用字段清单；
// - 值改动时对应格子做一次轻微底色提示（flashKeys 由父组件按最近改动的键传入）。
import { computed } from "vue";
import type { WorkflowDetail } from "@/api/client";

const props = defineProps<{
  detail: WorkflowDetail;
  inputs: Record<string, any>;
  historical?: boolean;
  flashKeys?: string[];
}>();

const isLizhi = computed(() => props.detail.flow_id === "national_inspirational_2025");

function v(key: string): string {
  const val = props.inputs[key];
  if (val === undefined || val === null || String(val).trim() === "") return "";
  return String(val);
}
function shown(key: string): string {
  return v(key) || "（待填）";
}
function rankPair(rankKey: string, totalKey: string): string {
  const r = v(rankKey), t = v(totalKey);
  if (!r && !t) return "（待填）";
  if (!t) return `${r} / （总人数待填）`;
  if (!r) return `（名次待填） / ${t}`;
  return `${r} / ${t}`;
}
function flash(key: string): boolean {
  return (props.flashKeys || []).includes(key);
}
const genericSlots = computed(() => props.detail.slots);

const LIZHI_ROWS = computed(() => ([
  { label: "姓名", key: "name" },
  { label: "学生层次", key: "student_type" },
  { label: "所在年级", key: "grade" },
  { label: "院（系）", key: "college" },
  { label: "专业与班级", key: "major_class" },
  { label: "家庭经济困难认定", key: "difficulty_confirmed" },
]));

const GROUPS = computed(() => {
  const gs: { title: string; items: { label: string; type: string; key: string; options?: string[] }[] }[] = [];
  for (const s of (genericSlots.value || [])) {
    const g = gs.find((x) => x.title === (s.group ?? ""));
    if (g) g.items.push(s);
    else gs.push({ title: s.group ?? "", items: [s] });
  }
  return gs;
});
</script>

<template>
  <div class="fprev" :data-flow="detail.flow_id">
    <div class="fprev-head">
      <strong>{{ isLizhi ? "本专科生国家励志奖学金申请表" : detail.name }}</strong>
      <span v-if="historical" class="fprev-tag">2025 年度历史演示</span>
    </div>

    <!-- 奖学金：申请表样式的简化预览（与导出 Word 栏目一致） -->
    <table v-if="isLizhi" class="fprev-table">
      <tbody>
        <tr v-for="row in LIZHI_ROWS" :key="row.key" :class="{ 'is-flash': flash(row.key) }">
          <th>{{ row.label }}</th>
          <td :class="{ 'is-empty': !v(row.key) }">{{ shown(row.key) }}</td>
        </tr>
        <tr :class="{ 'is-flash': flash('study_rank') || flash('study_total') }">
          <th>学习成绩排名</th>
          <td :class="{ 'is-empty': !v('study_rank') && !v('study_total') }">{{ rankPair("study_rank", "study_total") }}（名次/总人数）</td>
        </tr>
        <tr :class="{ 'is-flash': flash('zongce_rank') || flash('zongce_total') }">
          <th>综合测评排名</th>
          <td :class="{ 'is-empty': !v('zongce_rank') && !v('zongce_total') }">{{ rankPair("zongce_rank", "zongce_total") }}（名次/总人数）</td>
        </tr>
        <tr class="fprev-block" :class="{ 'is-flash': flash('reason') }">
          <th>申请理由</th>
          <td :class="{ 'is-empty': !v('reason') }">{{ v("reason") || "（可在“文书生成”步骤填写）" }}</td>
        </tr>
        <tr class="fprev-blank"><th>申请人签名</th><td class="is-empty">（线下签名）</td></tr>
        <tr class="fprev-blank"><th>院系 / 学校审核</th><td class="is-empty">（盖章栏留白）</td></tr>
      </tbody>
    </table>

    <!-- 其它流程：通用字段清单 -->
    <div v-else class="fprev-groups">
      <div v-for="(g, gi) in GROUPS" :key="gi" class="fprev-group">
        <p v-if="g.title" class="fprev-group-title tiny">{{ g.title }}</p>
        <div class="fprev-row" v-for="s in g.items" :key="s.key"
             :class="{ 'is-flash': flash(s.key) }">
          <span class="fprev-label">{{ s.label }}</span>
          <span class="fprev-value" :class="{ 'is-empty': !v(s.key) }">{{ shown(s.key) }}</span>
        </div>
      </div>
    </div>

    <p class="fprev-foot tiny">预览随填写实时更新；导出的 Word 以「核对并生成预览」后的内容为准。</p>
  </div>
</template>

<style scoped>
.fprev {
  position: sticky;
  top: 84px;
  border: 1px solid var(--line);
  background: var(--paper, var(--bg-panel));
  padding: 14px 16px;
}
.fprev-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  border-bottom: 2px solid var(--line);
  padding-bottom: 8px;
  margin-bottom: 10px;
}
.fprev-head strong { font-size: 14px; }
.fprev-tag {
  flex: none;
  font-size: 11px;
  border: 1px solid var(--vermilion, #e2001a);
  color: var(--vermilion, #e2001a);
  padding: 1px 6px;
  letter-spacing: 0.06em;
}
.fprev-table { width: 100%; border-collapse: collapse; }
.fprev-table th {
  text-align: left;
  font-weight: 400;
  color: var(--text-3);
  font-size: 12px;
  width: 92px;
  padding: 6px 8px 6px 0;
  vertical-align: top;
  white-space: nowrap;
}
.fprev-table td { font-size: 13px; padding: 6px 0; overflow-wrap: anywhere; }
.fprev-table tr { border-bottom: 1px solid var(--line-soft); }
.fprev-table td.is-empty { color: var(--text-3); }
.fprev-block td { line-height: 1.6; min-height: 48px; }
/* 值变化的一次轻微底色提示（随主题令牌换色） */
.fprev-table tr.is-flash td,
.fprev-row.is-flash .fprev-value {
  animation: fprev-flash 900ms ease-out;
}
@keyframes fprev-flash {
  0% { background: color-mix(in srgb, var(--vermilion, #e2001a) 14%, transparent); }
  100% { background: transparent; }
}
.fprev-groups { display: flex; flex-direction: column; gap: 10px; }
.fprev-group-title { margin: 0 0 4px; color: var(--text-3); letter-spacing: 0.08em; }
.fprev-row { display: flex; gap: 10px; justify-content: space-between; border-bottom: 1px solid var(--line-soft); padding: 5px 0; }
.fprev-label { color: var(--text-3); font-size: 12.5px; flex: none; }
.fprev-value { font-size: 13px; text-align: right; overflow-wrap: anywhere; }
.fprev-value.is-empty { color: var(--text-3); }
.fprev-foot { margin: 10px 0 0; color: var(--text-3); }

@media (prefers-reduced-motion: reduce) {
  .fprev-table tr.is-flash td,
  .fprev-row.is-flash .fprev-value { animation: none; }
}
</style>
