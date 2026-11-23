<script setup lang="ts">
// STAGE W2：罗盘、比例尺、读数、署名。罗盘跟着镜头方位角转（每帧更新）；
// 静态模式下方位角用 home 停靠点计算。数字一律等宽字体。
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import { azimuthDeg, coordText, shichen } from "@/stage/hud";
import type { StageCtx } from "@/stage/types";
import type { CampusMeta } from "@/campus3d/meta";

const ctx = inject<StageCtx>("stageCtx");
const meta = computed(() => ctx?.meta.value ?? null);

const azimuth = ref(0);
const scalePx = ref<number | null>(null);
const now = ref(new Date());

let offFrame: (() => void) | null = null;
let clockTimer: number | null = null;

const stopName = computed(() => {
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  return String(hook?.stop ?? "home");
});

function updateScale(handle: ReturnType<NonNullable<StageCtx["getHandle"]>> | null, m: CampusMeta) {
  const pair = m.look.hud.scale100[stopName.value];
  if (!pair) {
    scalePx.value = null;
    return;
  }
  if (!handle) {
    scalePx.value = null;
    return;
  }
  const p0 = handle.project(pair[0]);
  const p1 = handle.project(pair[1]);
  scalePx.value = Math.abs(p1.x - p0.x);
}

function onFrame() {
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  azimuth.value = Number(hook?.azimuth ?? 0);
  const handle = ctx?.getHandle() ?? null;
  if (meta.value) updateScale(handle, meta.value);
}

onMounted(() => {
  // 静态模式（没有场景）：用 home 停靠点计算方位角
  if (meta.value && (!ctx || ctx.sceneStatus.value === "static" || ctx.sceneStatus.value === "error")) {
    const home = meta.value.stops.home ?? meta.value.stops.overview;
    azimuth.value = azimuthDeg(home.position, home.target);
    scalePx.value = null;
  }
  offFrame = ctx?.registerFrame(onFrame) ?? null;
  // 3D 就绪后也用静态兜底值直到第一帧
  if (meta.value && azimuth.value === 0) {
    const home = meta.value.stops.home ?? meta.value.stops.overview;
    azimuth.value = azimuthDeg(home.position, home.target);
  }
  clockTimer = window.setInterval(() => { now.value = new Date(); }, 30_000);
  // 首帧兜底
  void nextTickFrame();
});

async function nextTickFrame() {
  await Promise.resolve();
  onFrame();
}

onBeforeUnmount(() => {
  offFrame?.();
  if (clockTimer !== null) window.clearInterval(clockTimer);
});

// 读数四行
const title = computed(() => meta.value?.look.hud.title ?? "");
const coordLine = computed(() => coordText(meta.value?.look.hud.coord ?? ""));
const counts = computed(() => {
  const m = meta.value;
  if (!m) return { buildings: 0, campuses: 0 };
  return {
    buildings: Object.keys(m.buildings).length,
    campuses: (m.zones ?? []).filter((z) => z.kind === "校区").length,
  };
});
const clockText = computed(() => {
  const d = now.value;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return { shichen: shichen(d.getHours()), time: `${hh}:${mm}` };
});
const scaleLabel = computed(() => meta.value?.look.hud.scaleLabel ?? "");
</script>

<template>
  <div class="stage-hud-widget">
    <div class="stage-compass-box" data-testid="stage-compass">
      <img src="/campus3d/ui/compass.svg" alt="罗盘" class="stage-compass"
            :style="{ transform: `rotate(${-azimuth}deg)` }" width="76" height="76" />
    </div>
    <div v-if="scalePx !== null && scalePx > 0" class="stage-scale" data-testid="stage-scale">
      <span class="stage-scale-line" :style="{ width: `${scalePx}px` }"></span>
      <span class="stage-scale-text">{{ scaleLabel }}</span>
    </div>
    <div class="stage-read" data-testid="stage-hud">
      <div class="stage-read-title">{{ title }}</div>
      <div class="stage-read-line">{{ coordLine }}</div>
      <div class="stage-read-line">
        <span class="num">{{ counts.buildings }}</span> 栋楼 <span class="num">{{ counts.campuses }}</span> 个校区
      </div>
      <div class="stage-read-line">{{ clockText.shichen }} <span class="num">{{ clockText.time }}</span></div>
    </div>
  </div>
</template>

<style scoped>
.stage-hud-widget {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 4;
  pointer-events: none;
}
.stage-compass-box {
  position: absolute;
  left: 92px;
  bottom: 34px;
  width: 76px;
  height: 76px;
}
.stage-compass {
  width: 76px;
  height: 76px;
  display: block;
}
.stage-scale {
  position: absolute;
  left: 184px;
  bottom: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-faint);
}
.stage-scale-line {
  display: block;
  height: 1px;
  background: var(--st-ov-fg2);
}
.stage-scale-text {
  font-family: var(--st-song);
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--st-ov-fg);
}
.stage-read {
  position: absolute;
  right: 30px;
  bottom: 30px;
  text-align: right;
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 8px 12px;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-faint);
}
.stage-read-title {
  font-family: var(--st-song);
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.2em;
  color: var(--st-ov-fg);
}
.stage-read-line {
  font-size: 11.5px;
  letter-spacing: 0.12em;
  color: var(--st-ov-fg2);
}
.stage-read-line .num {
  font-family: var(--mono, monospace);
  color: var(--st-ov-fg);
}
</style>
