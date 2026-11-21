<script lang="ts">
// SFC 支持 script setup + 普通 script 并存：类型与注入 key 必须从普通块导出
// （setup 块不允许 ES 导出）。定义在这里，属于本组件文件，不新建文件。
import type { InjectionKey, Ref } from "vue";
import type { Vec3 } from "@/campus3d/meta";

export type StarTrailState = {
  /** 二次贝塞尔 path 的 d（从起飞点的屏幕快照到星当前位置） */
  d: string;
  /** 飞完淡出中（300ms 后由 ZdxStar 移除） */
  fading: boolean;
};

/** 容器由 StageView provide；ZdxStar 写、SceneSigns 画（provide/inject 不能跨兄弟组件） */
export const STAR_TRAIL_KEY: InjectionKey<Ref<StarTrailState | null>> = Symbol("stage-star-trail");
export type Vec3Like = Vec3;
</script>

<script setup lang="ts">
// STAGE W7：智多星——悬在校园上空的十字星芒光点（页面 div，不是 3D 物体）。
// 每帧在 onFrame 回调里把跟随的场景点 project() 成屏幕坐标（常见错误 1：另开 rAF 会
// 抖），目标点 = meta.look.star.home（home/campus/tour）或 楼的 anchor+look.star.lift
// （answer）。目标变化时 900ms 缓动飞行，途中 Y 加 sin(π·t)×距离×0.25 的拱起，身后拖
// 一条渐隐弧线（拖尾画在 SceneSigns 的连线层里）。data-state：idle / thinking（chat
// busy）/ flying。静态模式不显示；减少动态：不闪、瞬移、无拖尾。层级在场景标签层（3），
// 低于面板（常见错误 2）。
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { StageCtx } from "@/stage/types";
import { easeInOutCubic } from "@/campus3d/camera";
import { useStageStore } from "@/stores/stage";
import { useChatStore } from "@/stores/chat";

const ctx = inject<StageCtx>("stageCtx");
const store = useStageStore();
const chat = useChatStore();

const reducedMotion =
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** 只在 3D 就绪后显示（静态模式没有星，W7 验证第 6 条） */
const showStar = computed(() => ctx?.sceneStatus.value === "ready");

const stateEl = ref<HTMLElement | null>(null);
const state = ref<"idle" | "thinking" | "flying">("idle");

// ---- 跟随哪个点（卡第 2 条）----
const target = computed<Vec3 | null>(() => {
  const m = ctx?.meta.value;
  if (!m?.look.star) return null;
  if (store.mode === "answer" && store.place) {
    const b = m.buildings[store.place.buildingId];
    if (b?.anchor) {
      return [b.anchor[0], b.anchor[1] + m.look.star.lift, b.anchor[2]];
    }
    return null;
  }
  return m.look.star.home;
});

/** 当前位置（场景坐标，非响应式；只在 onFrame 里投影） */
let cur: Vec3 | null = null;
let flight: { from: Vec3; to: Vec3; start: number } | null = null;
const FLY_MS = 900;
let fadeTimer: number | null = null;

/** 拖尾状态：ZdxStar 写、SceneSigns 画。容器由 StageView provide（provide/inject 不能跨兄弟） */
const trail = inject<Ref<StarTrailState | null>>(STAR_TRAIL_KEY, ref<StarTrailState | null>(null));

function clearTrail() {
  if (fadeTimer !== null) {
    window.clearTimeout(fadeTimer);
    fadeTimer = null;
  }
  trail.value = null;
}

/** 飞行启动：记起飞点屏幕快照，建拖尾 */
function startFlight(to: Vec3) {
  if (!cur) {
    cur = [...to] as Vec3;
    return;
  }
  flight = { from: [...cur] as Vec3, to, start: performance.now() };
  state.value = "flying";
  const handle = ctx?.getHandle();
  if (handle && !reducedMotion) {
    const p = handle.project(flight.from);
    trail.value = { d: `M ${p.x} ${p.y} Q ${p.x} ${p.y} ${p.x} ${p.y}`, fading: false };
  }
}

/** 目标点变化：飞过去（减少动态直接跳，W7 第 6 条） */
watch(target, (to) => {
  if (!to) return;
  if (cur === null) {
    cur = [...to] as Vec3; // 首次出现
    return;
  }
  if (reducedMotion) {
    cur = [...to] as Vec3;
    clearTrail();
    return;
  }
  startFlight(to);
});

function onFrame() {
  const handle = ctx?.getHandle();
  if (!handle || !target.value || cur === null) return;

  if (flight) {
    const raw = Math.min((performance.now() - flight.start) / FLY_MS, 1);
    const e = easeInOutCubic(raw);
    const from = flight.from;
    const to = flight.to;
    const dist = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    cur = [
      from[0] + (to[0] - from[0]) * e,
      from[1] + (to[1] - from[1]) * e + Math.sin(Math.PI * raw) * dist * 0.25,
      from[2] + (to[2] - from[2]) * e,
    ];
    if (raw >= 1) {
      cur = [...to] as Vec3;
      flight = null;
      state.value = "idle";
      if (trail.value) {
        trail.value = { ...trail.value, fading: true };
        if (fadeTimer !== null) window.clearTimeout(fadeTimer);
        fadeTimer = window.setTimeout(clearTrail, 300);
      }
    }
  }

  // 每帧投影贴位置（transform 直接写，不走响应式）
  const p = handle.project(cur);
  if (stateEl.value) {
    stateEl.value.style.display = p.visible ? "" : "none";
    stateEl.value.style.transform = `translate(${p.x}px, ${p.y}px)`;
  }

  // 拖尾终点跟着星走
  if (trail.value && !trail.value.fading) {
    const m = /M ([\d.-]+) ([\d.-]+)/.exec(trail.value.d);
    if (m) {
      const mx = (Number(m[1]) + p.x) / 2;
      const my = (Number(m[2]) + p.y) / 2 - Math.hypot(p.x - Number(m[1]), p.y - Number(m[2])) * 0.25;
      trail.value.d = `M ${m[1]} ${m[2]} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
    }
  }
}

// thinking 在 flying 之外优先级低：飞行时保持 flying（卡对这两种态没有叠加要求）
watch(
  () => chat.busy,
  (busy) => {
    if (!busy && state.value === "thinking") state.value = "idle";
    else if (busy && !flight) state.value = "thinking";
  }
);

let offFrame: (() => void) | null = null;
onMounted(() => {
  offFrame = ctx?.registerFrame(onFrame) ?? null;
});
onBeforeUnmount(() => {
  offFrame?.();
  clearTrail();
});
</script>

<template>
  <div
    v-if="showStar"
    ref="stateEl"
    class="stage-star"
    data-testid="stage-star"
    :data-state="state"
    aria-hidden="true"
  >
    <span class="stage-star-name">智多星</span>
  </div>
</template>

<style scoped>
/* 层级：场景标签层（3），低于面板（W7 常见错误 2）。核心 10×10 白点 + 三层光晕（卡原文）。 */
.stage .stage-star {
  position: fixed;
  top: 0;
  left: 0;
  z-index: 3;
  width: 10px;
  height: 10px;
  margin: -5px 0 0 -5px;
  border-radius: 50%;
  background: #fff;
  box-shadow:
    0 0 0 2px rgba(255, 255, 255, 0.35),
    0 0 18px 6px rgba(190, 220, 255, 0.85),
    0 0 60px 22px rgba(120, 170, 255, 0.45);
  pointer-events: none;
}
/* 星芒：一横一竖两条中间白、两端透明的线性渐变（卡：这是星自己的一部分） */
.stage .stage-star::before,
.stage .stage-star::after {
  content: "";
  position: absolute;
  left: 50%;
  top: 50%;
  width: 74px;
  height: 1.5px;
  transform: translate(-50%, -50%);
  background: linear-gradient(to right, rgba(255, 255, 255, 0), #fff, rgba(255, 255, 255, 0));
}
.stage .stage-star::after {
  transform: translate(-50%, -50%) rotate(90deg);
}
/* 「智多星」三个字：右上方（偏移 16px, −30px），宋体 600 13px、字距 0.4em、白字深影 */
.stage .stage-star-name {
  position: absolute;
  left: 16px;
  top: -30px;
  white-space: nowrap;
  font-family: var(--st-song);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.4em;
  color: #fff;
  text-shadow: 0 0 6px rgba(0, 0, 0, 0.9), 0 1px 3px rgba(0, 0, 0, 0.9), 0 0 2px rgba(0, 0, 0, 0.9);
}
/* thinking：光晕每 1.2 秒放大缩小一次（只改 box-shadow 的扩散与不透明度） */
.stage .stage-star[data-state="thinking"] {
  animation: stage-star-think 1.2s ease-in-out infinite;
}
@keyframes stage-star-think {
  0%, 100% {
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.35),
      0 0 18px 6px rgba(190, 220, 255, 0.85),
      0 0 60px 22px rgba(120, 170, 255, 0.45);
  }
  50% {
    box-shadow:
      0 0 0 2px rgba(255, 255, 255, 0.6),
      0 0 30px 12px rgba(190, 220, 255, 0.95),
      0 0 90px 34px rgba(120, 170, 255, 0.6);
  }
}
/* 减少动态：不闪（W7 第 6 条） */
@media (prefers-reduced-motion: reduce) {
  .stage .stage-star[data-state="thinking"] {
    animation: none;
  }
}
</style>
