<script setup lang="ts">
// 办理路线面板：把本轮回答的步骤图（process）画成可展开的纵向节点。
// 两处共用：首页右侧回答面板（AnswerPanel）与 /chat 每条助手消息。
// 只用全局样式变量（主题切换时自动适配角），不引入新的设计令牌。
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { ActionFlowRef, CitationRef, ProcessBody, ProcessState } from "@/api/client";
import { setFlowPreset } from "@/stores/flowDraft";

const props = defineProps<{
  process: ProcessBody | null;
  citations: CitationRef[];
  /** 本轮可用的向导引用（workflow 状态与 checklist 卡的 flow），用于对齐预设 */
  flows?: ActionFlowRef[];
}>();

const emit = defineEmits<{ (e: "cite", id: string): void }>();

const router = useRouter();

const STATE_TEXT: Record<ProcessState, string> = {
  ready: "可查看",
  needs_user: "待你补充",
  needs_check: "待核实",
  upcoming: "后续步骤",
};

/** 展开中的节点；切换新一轮时展开 focus_id 与向导入口节点（入口要直接可见） */
const openIds = ref<string[]>([]);
watch(
  () => props.process,
  (p) => {
    const ids: string[] = [];
    if (p?.focus_id) ids.push(p.focus_id);
    const entry = p?.workflow_entry?.node_id;
    if (entry && !ids.includes(entry)) ids.push(entry);
    openIds.value = ids;
  },
  { immediate: true }
);

function toggle(id: string) {
  openIds.value = openIds.value.includes(id)
    ? openIds.value.filter((x) => x !== id)
    : [...openIds.value, id];
}

function isOpen(id: string): boolean {
  return openIds.value.includes(id);
}

/** 同一节点出发的多条边 = 分支：目标节点带条件文字、缩进显示 */
const branchLabel = computed(() => {
  const map = new Map<string, string>();
  const edges = props.process?.edges ?? [];
  const outCount = new Map<string, number>();
  for (const e of edges) outCount.set(e.from_id, (outCount.get(e.from_id) ?? 0) + 1);
  for (const e of edges) {
    if ((outCount.get(e.from_id) ?? 0) > 1) map.set(e.to_id, e.label || "分支");
  }
  return map;
});

/** 引用角标使用本轮 citations 的序号（与正文一致） */
function citeNo(id: string): number {
  const i = (props.citations ?? []).findIndex((c) => c.id === id);
  return i >= 0 ? i + 1 : 0;
}

/** 材料环节给向导入口时，找同回复里挂着的向导引用取预设 */
const entryFlow = computed<ActionFlowRef | null>(() => {
  const we = props.process?.workflow_entry;
  if (!we) return null;
  return (props.flows ?? []).find((f) => f.flow_id === we.flow_id) ?? null;
});

function enterFlow() {
  const we = props.process?.workflow_entry;
  if (!we) return;
  setFlowPreset(we.flow_id, entryFlow.value?.preset_slots, entryFlow.value?.preset_note);
  router.push(`/workflows/${we.flow_id}`);
}
</script>

<template>
  <section v-if="process && process.nodes.length" class="proc" data-testid="stage-process">
    <header class="proc-head">
      <h3 class="proc-title">办理路线 · {{ process.title }}</h3>
      <span class="proc-hint">点开每一环节看依据</span>
    </header>

    <div class="proc-flow">
      <template v-for="(n, idx) in process.nodes" :key="n.id">
        <div v-if="branchLabel.has(n.id)" class="proc-branch" :data-testid="`proc-branch-${n.id}`">
          <span class="proc-branch-label">{{ branchLabel.get(n.id) }}</span>
          <button
            type="button"
            class="proc-node"
            :class="`is-${n.state}`"
            :aria-expanded="isOpen(n.id)"
            :aria-controls="`proc-detail-${n.id}`"
            :data-testid="`proc-node-${n.id}`"
            @click="toggle(n.id)"
          >
            <span class="proc-no">{{ idx + 1 }}</span>
            <span class="proc-main">
              <span class="proc-name">{{ n.title }}</span>
              <span class="proc-state">{{ STATE_TEXT[n.state] }}</span>
            </span>
          </button>
        </div>

        <button
          v-else
          type="button"
          class="proc-node"
          :class="`is-${n.state}`"
          :aria-expanded="isOpen(n.id)"
          :aria-controls="`proc-detail-${n.id}`"
          :data-testid="`proc-node-${n.id}`"
          @click="toggle(n.id)"
        >
          <span class="proc-no">{{ idx + 1 }}</span>
          <span class="proc-main">
            <span class="proc-name">{{ n.title }}</span>
            <span class="proc-state">{{ STATE_TEXT[n.state] }}</span>
          </span>
        </button>

        <!-- 展开：说明 + 出处 + 材料环节的向导入口 -->
        <div
          v-if="isOpen(n.id)"
          :id="`proc-detail-${n.id}`"
          class="proc-detail"
          :data-testid="`proc-detail-${n.id}`"
        >
          <p v-if="n.detail" class="proc-detail-text">{{ n.detail }}</p>
          <div v-if="n.citation_ids.length" class="proc-cites">
            <button
              v-for="cid in n.citation_ids"
              :key="cid"
              type="button"
              class="proc-cite"
              @click="emit('cite', cid)"
            >[{{ citeNo(cid) }}] 看依据</button>
          </div>
          <div
            v-if="process.workflow_entry && process.workflow_entry.node_id === n.id"
            class="proc-enter"
          >
            <button type="button" class="proc-enter-btn" data-testid="proc-enter-flow" @click="enterFlow">
              进入向导
            </button>
            <span v-if="process.workflow_entry.historical" class="proc-enter-tag">2025 年历史演示</span>
          </div>
        </div>

        <span
          v-if="idx < process.nodes.length - 1 && !branchLabel.has(process.nodes[idx + 1].id)"
          class="proc-link"
          aria-hidden="true"
        ></span>
      </template>
    </div>
  </section>
</template>

<style scoped>
.proc {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.proc-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 12px;
}
.proc-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text);
}
.proc-hint {
  font-size: 11.5px;
  color: var(--text-3, var(--text-2));
}
.proc-flow {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* 节点：左边序号，右边标题 + 状态文字（状态不只用颜色表达） */
.proc-node {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: var(--bg-panel, transparent);
  border: 1px solid var(--line-soft);
  border-left: 3px solid var(--gold-soft, var(--gold));
  text-align: left;
  cursor: pointer;
  font: inherit;
  color: inherit;
}
.proc-node:hover { border-color: var(--gold-soft, var(--gold)); }
.proc-node:focus-visible { outline: 1px solid var(--vermilion); outline-offset: 2px; }
.proc-node.is-needs_user { border-left-color: var(--vermilion); }
.proc-node.is-needs_check { border-left: 3px dashed var(--gold); }
.proc-node.is-upcoming { border-left-color: var(--line-soft); }
.proc-node.is-upcoming .proc-name { color: var(--text-2); }

.proc-no {
  flex: none;
  min-width: 18px;
  height: 18px;
  line-height: 18px;
  text-align: center;
  font-size: 11px;
  border: 1px solid currentColor;
  color: var(--text-2);
  border-radius: 0;
}
.proc-main {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 10px;
  min-width: 0;
}
.proc-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--text);
  overflow-wrap: anywhere;
}
.proc-state {
  font-size: 11px;
  color: var(--text-2);
  border: 1px solid var(--line-soft);
  padding: 0 5px;
  white-space: nowrap;
}
.proc-node.is-needs_user .proc-state { color: var(--vermilion); border-color: currentColor; }
.proc-node.is-needs_check .proc-state { color: var(--gold, var(--text-2)); border-color: currentColor; }

/* 两环节之间的竖线 */
.proc-link {
  width: 1px;
  height: 10px;
  margin-left: 19px;
  background: var(--line-soft);
}

/* 分支：条件文字 + 缩进子路线（手机仍纵向） */
.proc-branch {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-left: 12px;
  padding-left: 10px;
  border-left: 1px dashed var(--gold-soft, var(--gold));
}
.proc-branch-label {
  font-size: 11.5px;
  color: var(--text-2);
}
.proc-branch-label::before { content: "└ "; color: var(--gold-soft, var(--gold)); }

/* 展开内容 */
.proc-detail {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 4px 0 6px 28px;
  padding: 8px 10px;
  border: 1px dashed var(--line-soft);
  background: color-mix(in srgb, var(--bg-panel, transparent) 60%, transparent);
}
.proc-detail-text {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--text-2);
  overflow-wrap: anywhere;
}
.proc-cites {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.proc-cite {
  padding: 2px 8px;
  background: none;
  border: 1px solid var(--gold-soft, var(--gold));
  color: var(--text-2);
  font-size: 11.5px;
  cursor: pointer;
}
.proc-cite:hover { color: var(--vermilion); border-color: var(--vermilion); }
.proc-cite:focus-visible { outline: 1px solid var(--vermilion); outline-offset: 2px; }

.proc-enter {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.proc-enter-btn {
  align-self: flex-start;
  padding: 4px 12px;
  background: var(--vermilion);
  color: #fff;
  border: none;
  font-size: 12.5px;
  cursor: pointer;
}
.proc-enter-btn:hover { filter: brightness(1.08); }
.proc-enter-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.proc-enter-tag {
  font-size: 11px;
  color: var(--vermilion);
  border: 1px solid currentColor;
  padding: 0 6px;
}

@media (max-width: 480px) {
  .proc-detail { margin-left: 12px; }
  .proc-branch { margin-left: 6px; }
}
</style>
