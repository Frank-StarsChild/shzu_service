<script setup lang="ts">
// ALIVE A5：问话栏上方那一行——读题 — 翻查 — 核证 — 作答。
// 只读 store.trace；当前阶段金色带光晕，之前月白 66%，之后月白 38%。
import { computed } from "vue";
import { useStageStore } from "@/stores/stage";

const store = useStageStore();
const trace = computed(() => store.trace);

const STEPS = ["read", "search", "verify", "answer"] as const;
const WORDS: Record<string, string> = {
  read: "读题",
  search: "翻查",
  verify: "核证",
  answer: "作答",
};

const current = computed(() => STEPS.indexOf(trace.value.phase as (typeof STEPS)[number]));
const departments = computed(() => trace.value.hits.length);
</script>

<template>
  <p
    v-if="trace.phase !== 'idle'"
    class="stage-phase"
    data-testid="stage-phase"
    :data-phase="trace.phase"
  >
    <template v-if="trace.phase === 'error'">
      <span class="stage-phase-error">这一轮没有答出来</span>
    </template>
    <template v-else>
      <template v-for="(s, i) in STEPS" :key="s">
        <span
          class="stage-phase-word"
          :class="{
            'is-now': i === current,
            'is-done': i < current,
            'is-next': i > current,
          }"
        >{{ WORDS[s] }}</span>
        <span v-if="i < STEPS.length - 1" class="stage-phase-sep">—</span>
      </template>
      <span v-if="trace.phase === 'verify'" class="stage-phase-meta">
        {{ departments }} 个部门 · {{ trace.evidence }} 条审定资料
      </span>
    </template>
  </p>
</template>
