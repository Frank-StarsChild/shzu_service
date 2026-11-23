<script setup lang="ts">
// ALIVE A2：学院灯牌。校区沙盘首页（与 campus 态选中的校区）每个学院的主楼上方
// 悬一枚 40px 鎏金院徽 + 深色底金边圆 + 细金线落到楼顶 anchor；同楼多学院横向错开。
// 悬停：院徽 50 并发光，右边竖排小题签（学院简称 + 建院年份）；点击 showCollege(no)。
// 全校沙盘首页不画；answer/tour 不画（A3 把院徽放到楼题签顶上）；emblems/meta 为
// null 不画；静态模式（无 3D）不画。位置只在 onFrame 回调里算（同 W3/W7 的写法）。
import { computed, inject, onBeforeUnmount, onMounted, ref } from "vue";
import type { StageCtx } from "@/stage/types";
import { useStageStore } from "@/stores/stage";
import { shortName, type College } from "@/stage/emblems";
import EmblemMark from "@/components/stage/EmblemMark.vue";

const ctx = inject<StageCtx>("stageCtx");
const store = useStageStore();
const meta = computed(() => ctx?.meta.value ?? null);

/** 画哪些（ALIVE A2 第 1 条）：emblems 为 null 一个都不画 */
type Lantern = { college: College; buildingId: string; anchor: [number, number, number]; offset: number };

const lanterns = computed<Lantern[]>(() => {
  const m = meta.value;
  const emblems = store.emblems;
  if (!m?.colleges || !m?.buildings || !emblems) return [];
  if (store.mode === "answer" || store.mode === "tour") return [];
  if (store.mode === "home" && store.packId === store.default) return [];
  const picked: Lantern[] = [];
  for (const mc of m.colleges) {
    if (store.mode === "campus" && mc.zone !== store.zoneId) continue;
    const ec = emblems.colleges.find((c) => c.no === mc.no);
    if (!ec) continue;
    // 灯牌的楼：emblems.buildingIds 里第一个在当前沙盘 meta.buildings 里的
    const bid = ec.buildingIds.find((id) => m.buildings[id]?.anchor);
    if (!bid) continue;
    const b = m.buildings[bid];
    if (!b?.anchor) continue;
    picked.push({ college: ec, buildingId: bid, anchor: b.anchor, offset: 0 });
  }
  // 同一栋楼有几个学院：横向错开，第 i 个（从 0 起，共 n 个）偏移 (i − (n−1)/2) × 48
  const byBid = new Map<string, Lantern[]>();
  for (const l of picked) {
    const arr = byBid.get(l.buildingId) ?? [];
    arr.push(l);
    byBid.set(l.buildingId, arr);
  }
  const out: Lantern[] = [];
  for (const arr of byBid.values()) {
    arr.forEach((l, i) => out.push({ ...l, offset: (i - (arr.length - 1) / 2) * 48 }));
  }
  return out;
});

type Pos = { x: number; y: number; lineLen: number; visible: boolean };
const positions = ref<Record<number, Pos>>({});

/** 屏幕坐标超出视口 40px 以上视为画面外 */
const MARGIN = 40;

function updatePositions() {
  const handle = ctx?.getHandle() ?? null;
  const m = meta.value;
  if (!handle || !m) {
    positions.value = {};
    return;
  }
  const lift = m.look?.sign?.lift ?? 0;
  const next: Record<number, Pos> = {};
  let visibleCount = 0;
  for (const l of lanterns.value) {
    // 底端（线底）对准 anchor 的屏幕点；线长 = anchor 屏幕 y − (anchor+lift) 屏幕 y，最短 12px
    const p0 = handle.project(l.anchor);
    const p1 = handle.project([l.anchor[0], l.anchor[1] + lift, l.anchor[2]]);
    const lineLen = Math.max(12, Math.round(p0.y - p1.y));
    const visible =
      p0.visible
      && p0.x >= -MARGIN && p0.x <= window.innerWidth + MARGIN
      && p0.y >= -MARGIN && p0.y <= window.innerHeight + MARGIN;
    next[l.college.no] = { x: p0.x + l.offset, y: p0.y, lineLen, visible };
    if (visible) visibleCount += 1;
  }
  positions.value = next;
  // 调试钩子（A2 第 5 条）：当前可见的灯牌数
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  if (hook) hook.lanterns = visibleCount;
}

const showLayer = computed(() => ctx?.sceneStatus.value === "ready");

/** 悬停/键盘聚焦的学院（放大到 50、出题签） */
const hoverNo = ref<number | null>(null);

function styleOf(no: number): Record<string, string> {
  const p = positions.value[no];
  if (!p || !p.visible) return { display: "none" };
  return { left: `${p.x}px`, top: `${p.y}px` };
}

function lineStyleOf(no: number): Record<string, string> {
  const p = positions.value[no];
  if (!p || !p.visible) return { height: "12px" };
  return { height: `${p.lineLen}px` };
}

function onLanternClick(no: number) {
  void store.showCollege(no);
}

let offFrame: (() => void) | null = null;

onMounted(() => {
  offFrame = ctx?.registerFrame(updatePositions) ?? null;
  updatePositions();
});

onBeforeUnmount(() => {
  offFrame?.();
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  if (hook) hook.lanterns = 0;
});
</script>

<template>
  <div v-if="showLayer" class="stage-lanterns" aria-label="学院灯牌">
    <button
      v-for="l in lanterns"
      :key="l.college.no"
      type="button"
      class="stage-lantern"
      :class="{ 'is-hover': hoverNo === l.college.no }"
      :data-testid="`stage-lantern-${l.college.no}`"
      :style="styleOf(l.college.no)"
      :aria-label="l.college.name"
      @click="onLanternClick(l.college.no)"
      @mouseenter="hoverNo = l.college.no"
      @mouseleave="hoverNo = null"
      @focus="hoverNo = l.college.no"
      @blur="hoverNo = null"
    >
      <span class="stage-lantern-disc">
        <EmblemMark
          :college="l.college"
          :size="hoverNo === l.college.no ? 50 : 40"
          tone="gilt"
        />
      </span>
      <span class="stage-lantern-line" :style="lineStyleOf(l.college.no)"></span>
      <!-- 悬停：右边竖排小题签（学院简称；有建院年份的下面一行小字） -->
      <span v-if="hoverNo === l.college.no" class="stage-lantern-tag">
        <span class="stage-lantern-tag-name">{{ shortName(l.college) }}</span>
        <span v-if="l.college.year !== null" class="stage-lantern-tag-year">{{ l.college.year }}</span>
      </span>
    </button>
  </div>
</template>

<style scoped>
/* 学院灯牌层：同场景标签层（z-index 3）、面板之下、不挡 W9 的序号标记（那在 anchor 上） */
.stage .stage-lanterns {
  position: fixed;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}
/* 灯牌：transform 把底端中点对准 anchor 的屏幕点；从上到下 = 圆 + 1px 竖线 */
.stage .stage-lantern {
  position: fixed;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  background: none;
  border: none;
  padding: 0;
  cursor: pointer;
  pointer-events: auto;
}
.stage .stage-lantern:focus-visible {
  outline: 1px solid var(--st-gold2);
  outline-offset: 3px;
}
/* 深色底 + 细金边的圆，里面放鎏金院徽 */
.stage .stage-lantern-disc {
  display: flex;
  padding: 3px;
  background: rgba(7, 10, 15, 0.86);
  box-shadow: 0 0 0 1px var(--st-gold2), 0 6px 18px rgba(0, 0, 0, 0.6);
  transition: box-shadow 160ms;
}
/* 悬停/聚焦：圆发光（院徽尺寸在组件里切到 50） */
.stage .stage-lantern.is-hover .stage-lantern-disc {
  box-shadow: 0 0 0 1.5px var(--st-gold), 0 0 26px 4px rgba(232, 201, 138, 0.55);
}
/* 落到楼顶的细金线：1px，从金渐变到透明（长度每帧按投影算） */
.stage .stage-lantern-line {
  width: 1px;
  min-height: 12px;
  background: linear-gradient(to bottom, var(--st-gold), rgba(232, 201, 138, 0));
}
/* 悬停题签：竖排小签（宋体 600 12px、字距 0.24em），近黑底、1px 淡金边、顶边 1.5px 金线 */
.stage .stage-lantern-tag {
  position: absolute;
  left: calc(100% + 10px);
  top: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 7px 4px 9px;
  background: rgba(5, 8, 13, 0.92);
  border: 1px solid var(--st-gold2);
  border-top: 1.5px solid var(--st-gold);
  pointer-events: none;
}
.stage .stage-lantern-tag-name {
  writing-mode: vertical-rl;
  font-family: var(--st-song);
  font-weight: 600;
  font-size: 12px;
  letter-spacing: 0.24em;
  color: var(--st-moon);
}
/* 建院年份：10px 等宽小字，在题签下端 */
.stage .stage-lantern-tag-year {
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--st-gold2);
}
</style>
