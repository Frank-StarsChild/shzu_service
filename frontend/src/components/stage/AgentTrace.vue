<script setup lang="ts">
// ALIVE A5：智多星「在想」——星周围一圈字、翻查题签、到各部门的金线、作答时变红。
// 只读 store.trace；位置每帧用 handle.project 重算（与 W7 的星同一个跟随点）。
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { StageCtx } from "@/stage/types";
import { useStageStore } from "@/stores/stage";

const ctx = inject<StageCtx>("stageCtx");
const store = useStageStore();
const meta = computed(() => ctx?.meta.value ?? null);
const trace = computed(() => store.trace);
const ready = computed(() => ctx?.sceneStatus.value === "ready");

const reduced = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const active = computed(() => ready.value && trace.value.phase !== "idle");
const showRing = computed(
  () => !reduced && ["read", "search", "verify"].includes(trace.value.phase)
);
const showQuery = computed(() => ["search", "verify"].includes(trace.value.phase));
const showThreads = computed(() => ["verify", "answer"].includes(trace.value.phase));

const ARC_ID = "stage-trace-arc";
const ringText = computed(
  () => `翻查审定资料 · ${trace.value.query ?? "读题"} ·`
);

type Thread = {
  buildingId: string;
  d: string;
  ex: number;
  ey: number;
};
type Tag = {
  key: string;
  label: string;
  count: number;
  x: number;
  y: number;
  buildingId: string | null;
};

const star = ref({ x: 0, y: 0, visible: false });
const threads = ref<Thread[]>([]);
const tags = ref<Tag[]>([]);

/** 星跟随的点（与 ZdxStar 同一规则：answer 态跟随楼，其余跟随 star.home） */
function starTarget() {
  const m = meta.value;
  if (!m?.look.star) return null;
  if (store.mode === "answer" && store.place) {
    const b = m.buildings[store.place.buildingId];
    if (b?.anchor) return [b.anchor[0], b.anchor[1] + m.look.star.lift, b.anchor[2]] as [number, number, number];
    return null;
  }
  return m.look.star.home;
}

function build() {
  const handle = ctx?.getHandle() ?? null;
  const m = meta.value;
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  if (!handle || !m || !active.value) {
    threads.value = [];
    tags.value = [];
    if (hook) hook.threads = 0;
    return;
  }
  const target = starTarget();
  const sp = target ? handle.project(target) : { x: 0, y: 0, visible: false };
  star.value = { x: sp.x, y: sp.y, visible: sp.visible };

  const nextThreads: Thread[] = [];
  const nextTags: Tag[] = [];
  let nullIndex = 0;
  const hits = trace.value.hits;
  hits.forEach((h, i) => {
    if (h.buildingId && m.buildings[h.buildingId]?.anchor) {
      const a = m.buildings[h.buildingId].anchor as [number, number, number];
      const p = handle.project([a[0], a[1] + 4, a[2]]);
      const dx = p.x - sp.x;
      const dy = p.y - sp.y;
      const dist = Math.hypot(dx, dy);
      const cx = (sp.x + p.x) / 2 + (sp.y - p.y) * 0.15;
      const cy = Math.min(sp.y, p.y) - dist * 0.18;
      nextThreads.push({
        buildingId: h.buildingId,
        d: `M ${sp.x} ${sp.y} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
        ex: p.x,
        ey: p.y,
      });
      nextTags.push({
        key: `b${h.buildingId}`,
        label: h.label,
        count: h.count,
        x: p.x,
        y: p.y - 14,
        buildingId: h.buildingId,
      });
      return;
    }
    // 没有楼的部门：竖着排在翻查题签下面
    nextTags.push({
      key: `n${i}`,
      label: h.label,
      count: h.count,
      x: sp.x + 44,
      y: sp.y + 76 + nullIndex * 44,
      buildingId: null,
    });
    nullIndex += 1;
  });
  threads.value = nextThreads;
  tags.value = nextTags;
  if (hook) hook.threads = showThreads.value ? nextThreads.length : 0;
}

const selectedId = computed(() =>
  trace.value.phase === "answer" ? store.place?.buildingId ?? null : null
);

function isSelected(t: Thread): boolean {
  return selectedId.value !== null && t.buildingId === selectedId.value;
}

function tagDim(bid: string | null): boolean {
  return trace.value.phase === "answer" && bid !== selectedId.value;
}

let offFrame: (() => void) | null = null;

// 阶段/命中变化时立即算一次（相机不动时 onFrame 不会触发，否则金线出不来）
watch(() => [trace.value.phase, trace.value.hits], () => build());

onMounted(() => {
  offFrame = ctx?.registerFrame(build) ?? null;
  build();
});

onBeforeUnmount(() => {
  offFrame?.();
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  if (hook) hook.threads = 0;
});
</script>

<template>
  <div
    v-if="active"
    class="stage-trace"
    data-testid="stage-trace"
    :data-phase="trace.phase"
    aria-live="polite"
  >
    <!-- 星周围一圈字（读题/翻查/核证；减少动态时不画） -->
    <div
      v-if="showRing"
      class="stage-trace-star"
      :style="{ left: `${star.x}px`, top: `${star.y}px` }"
      aria-hidden="true"
    >
      <svg class="stage-trace-ring" viewBox="-60 -60 120 120" width="120" height="120">
        <defs>
          <path :id="ARC_ID" d="M -42 0 a 42 42 0 1 1 84 0 a 42 42 0 1 1 -84 0" />
        </defs>
        <circle r="42" fill="none" stroke="rgba(232, 201, 138, 0.18)" stroke-width="1" />
        <circle
          r="52"
          fill="none"
          stroke="rgba(232, 201, 138, 0.1)"
          stroke-width="1"
          stroke-dasharray="2 5"
        />
        <text class="stage-trace-ring-text">
          <textPath :href="`#${ARC_ID}`" startOffset="0">{{ ringText }}</textPath>
        </text>
      </svg>
    </div>

    <!-- 翻查题签：竖排，星右侧 -->
    <div
      v-if="showQuery && trace.query !== null"
      class="stage-trace-query"
      data-testid="stage-trace-query"
      :style="{ left: `${star.x + 44}px`, top: `${star.y + 20}px` }"
    >
      <span class="stage-trace-query-k">翻查</span>
      <span class="stage-trace-query-q">{{ trace.query }}</span>
    </div>

    <!-- 到各部门的金线（最上层 SVG） -->
    <svg v-if="showThreads" class="stage-trace-threads" aria-hidden="true">
      <g
        v-for="(t, i) in threads"
        :key="t.buildingId"
        class="stage-trace-thread-g"
        :class="{ 'is-dim': trace.phase === 'answer' && !isSelected(t) }"
      >
        <path
          :d="t.d"
          pathLength="1"
          class="stage-trace-thread"
          :class="{ 'is-selected': isSelected(t) }"
          :style="{ animationDelay: `${90 * i}ms` }"
          :data-testid="`stage-trace-thread-${t.buildingId}`"
        />
        <circle
          :cx="t.ex"
          :cy="t.ey"
          r="5"
          class="stage-trace-thread-ring"
          :class="{ 'is-selected': isSelected(t) }"
        />
        <circle
          :cx="t.ex"
          :cy="t.ey"
          r="1.8"
          class="stage-trace-thread-dot"
          :class="{ 'is-selected': isSelected(t) }"
        />
      </g>
    </svg>

    <!-- 部门题签：有楼的在线的上方，没楼的排在翻查题签下面 -->
    <div
      v-for="(t, i) in tags"
      :key="t.key"
      class="stage-trace-tag"
      :class="{ 'is-dim': tagDim(t.buildingId), 'is-vertical': t.buildingId === null }"
      :data-testid="`stage-trace-tag-${i + 1}`"
      :style="{ left: `${t.x}px`, top: `${t.y}px` }"
    >
      <span class="stage-trace-tag-label">{{ t.label }}</span>
      <span class="stage-trace-tag-count">{{ t.count }} 条</span>
    </div>
  </div>
</template>
