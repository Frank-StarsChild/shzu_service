<script setup lang="ts">
// 标签布局驱动：每帧（在所有标签组件 publish 之后，模板里排在它们后面）调用一次
// board.solve()，把视口/遮挡矩形与候选标签算成同一份布局结果。
// 只在尺寸、模式、面板开合、视口变化时重读遮挡矩形（其余靠 board 的低频兜底）。
import { inject, onBeforeUnmount, onMounted, watch } from "vue";
import type { StageCtx } from "@/stage/types";
import { LABEL_BOARD_KEY } from "@/stage/labelBoard";
import { useStageStore } from "@/stores/stage";
import { useChatStore } from "@/stores/chat";

const ctx = inject<StageCtx>("stageCtx");
const board = inject(LABEL_BOARD_KEY, null);
const store = useStageStore();
const chat = useChatStore();

let offFrame: (() => void) | null = null;
let ro: ResizeObserver | null = null;

function onResize() {
  board?.invalidate();
}

/** 调试钩子：哪些标签被收起/缩成紧凑/错开（e2e 与自查用，不参与渲染） */
function publishDebug() {
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  if (!hook || !board) return;
  const hidden: string[] = [];
  const compact: string[] = [];
  const shifted: string[] = [];
  const detail: Record<string, unknown> = {};
  for (const l of Object.values(board.layouts.value)) {
    if (l.form === "hidden") hidden.push(l.id);
    else if (l.form === "compact") compact.push(l.id);
    if (l.shifted) shifted.push(l.id);
    detail[l.id] = {
      form: l.form,
      x: Math.round(l.x),
      y: Math.round(l.y),
      w: Math.round(l.w),
      h: Math.round(l.h),
      ax: Math.round(l.ax),
      ay: Math.round(l.ay),
      gap: Math.round(l.gap),
    };
  }
  hook.labels = { hidden, compact, shifted };
  hook.labelLayouts = detail;
}

onMounted(() => {
  offFrame = ctx?.registerFrame(() => {
    board?.solve();
    publishDebug();
  }) ?? null;
  board?.invalidate();
  window.addEventListener("resize", onResize);
  const el = document.querySelector(".stage");
  if (el && typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(onResize);
    ro.observe(el);
  }
});

watch(
  () => [store.mode, store.zoneId, store.packId, store.board, store.answerOpen, store.collegeNo, chat.turns.length],
  () => board?.invalidate()
);

onBeforeUnmount(() => {
  offFrame?.();
  window.removeEventListener("resize", onResize);
  ro?.disconnect();
  ro = null;
});
</script>

<template>
  <span class="stage-label-driver" aria-hidden="true"></span>
</template>

<style scoped>
.stage .stage-label-driver {
  display: none;
}
</style>
