<script setup lang="ts">
// ALIVE A2 + 本次「标签分级」：学院标记。
//  - 有院徽的学院：主楼上方 40px 鎏金院徽 + 细线落楼（同楼多学院横向错开 48px），
//    角标是右侧面板同一行号（序号来自 collegeIndex，和面板共用一份数据）。
//  - 没有院徽（emblems 未载入）的学院：退回 22px 小序号方块，点了落楼。
//  - 不再在地图上拼学院全名：悬停/键盘聚焦才出横排短名，全名在 aria-label 与右侧面板。
// 位置每帧交给共用布局板（labels.ts）统一避让：先试原位置，再左右挪 28–72px，
// 仍放不下缩成 30px 小院徽，最后才收起（面板仍保留入口）。
// 全校沙盘首页不画；answer/tour 不画；静态模式（无 3D）不画。
import { computed, inject, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { StageCtx } from "@/stage/types";
import { useStageStore } from "@/stores/stage";
import { shortName, type College } from "@/stage/emblems";
import { collegeEntries, indexOfCollege } from "@/stage/collegeIndex";
import { LABEL_BOARD_KEY } from "@/stage/labelBoard";
import { shiftOf, type LabelSpec } from "@/stage/labels";
import { cnNumber } from "@/stage/hud";
import EmblemMark from "@/components/stage/EmblemMark.vue";

const ctx = inject<StageCtx>("stageCtx");
const store = useStageStore();
const board = inject(LABEL_BOARD_KEY, null);
const meta = computed(() => ctx?.meta.value ?? null);

/** 画哪些：answer/tour 不画；全校沙盘首页（默认包 home）不画 */
const showLanterns = computed(() => {
  if (store.mode === "answer" || store.mode === "tour") return false;
  if (store.mode === "home" && store.packId === store.default) return false;
  return true;
});

/** 与右侧面板同一份学院行（校区态只看当前片区；沙盘首页看全包） */
const entries = computed(() =>
  collegeEntries(meta.value, store.emblems, store.mode === "campus" ? store.zoneId : null)
);

type Lantern = {
  college: College;
  buildingId: string;
  anchor: [number, number, number];
  offset: number;
  badge: number | null;
};

const lanterns = computed<Lantern[]>(() => {
  const m = meta.value;
  if (!m?.buildings || !showLanterns.value) return [];
  const picked: Omit<Lantern, "offset">[] = [];
  for (const e of entries.value) {
    for (const c of e.colleges) {
      const bid = c.buildingIds.find((id) => m.buildings[id]?.anchor);
      if (!bid) continue;
      picked.push({
        college: c,
        buildingId: bid,
        anchor: m.buildings[bid].anchor as [number, number, number],
        // 角标只给「这一行的代表学院」，同楼第二所不加号（避免两个号抢同一行）
        badge: e.buildingId === bid && e.colleges[0]?.no === c.no ? e.index : null,
      });
    }
  }
  // 同楼多学院：横向错开，第 i 个偏移 (i − (n−1)/2) × 48
  const byBid = new Map<string, Omit<Lantern, "offset">[]>();
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

/** 没有院徽的学院行：小序号方块（点位每帧投影） */
type MarkEntry = {
  index: number;
  name: string;
  fullName: string;
  buildingId: string;
  anchor: [number, number, number];
};
const markEntries = computed<MarkEntry[]>(() => {
  if (!showLanterns.value) return [];
  const m = meta.value;
  if (!m?.buildings) return [];
  const out: MarkEntry[] = [];
  for (const e of entries.value) {
    if (e.emblem) continue;
    if (!e.anchor) continue;
    out.push({
      index: e.index,
      name: e.name,
      fullName: e.fullName,
      buildingId: e.buildingId,
      anchor: e.anchor,
    });
  }
  return out;
});

const positions = ref<Record<number, { x: number; y: number; visible: boolean }>>({});

const layouts = computed(() => board?.layouts.value ?? {});

function layoutOf(no: number) {
  return layouts.value[`lantern-${no}`];
}

function isHidden(no: number): boolean {
  const L = layoutOf(no);
  return !L || L.form === "hidden";
}

function isCompact(no: number): boolean {
  return layoutOf(no)?.form === "compact";
}

function discSize(no: number): number {
  if (hoverNo.value === no && !isCompact(no)) return 50;
  return isCompact(no) ? 30 : 40;
}

/** 同楼另有几个学院被挤掉了（代表院徽上加「+N」，全名在 aria-label） */
function extraOf(no: number): number {
  const self = lanterns.value.find((l) => l.college.no === no);
  if (!self) return 0;
  return lanterns.value.filter(
    (l) => l.buildingId === self.buildingId && l.college.no !== no && isHidden(l.college.no)
  ).length;
}

function ariaOf(l: Lantern): string {
  const extra = extraOf(l.college.no);
  return extra > 0 ? `${l.college.name}（同楼另有 ${extra} 个学院）` : l.college.name;
}

function lanternStyle(no: number): Record<string, string> {
  const L = layoutOf(no);
  if (!L || L.form === "hidden") return { display: "none" };
  const d = shiftOf(L);
  return { left: `${L.ax + d.dx}px`, top: `${L.ay}px` };
}

function lineHeight(no: number): string {
  return `${layoutOf(no)?.gap ?? 12}px`;
}

function dxOf(no: number): number {
  const L = layoutOf(no);
  return L && L.form !== "hidden" ? shiftOf(L).dx : 0;
}

function leaderStyle(no: number): Record<string, string> {
  const dx = dxOf(no);
  return {
    width: `${Math.abs(dx)}px`,
    transform: `translateX(${dx > 0 ? "-100%" : "0"})`,
  };
}

/** 悬停/聚焦的学院（放大到 50、出横排题签） */
const hoverNo = ref<number | null>(null);
const hoverMark = ref<number | null>(null);

/** 题签靠右会出屏时翻到左边 */
function tagLeft(no: number): boolean {
  const L = layoutOf(no);
  return !!L && L.x + L.w / 2 > window.innerWidth - 250;
}

function onLanternClick(no: number) {
  void store.showCollege(no);
}

function onMarkClick(e: MarkEntry) {
  store.board = null;
  void store.showBuilding(e.buildingId);
}

function markStyle(index: number): Record<string, string> {
  const p = positions.value[index];
  if (!p || !p.visible) return { display: "none" };
  return { left: `${p.x}px`, top: `${p.y}px` };
}

/** MARGIN：屏幕坐标超出视口 40px 以上视为画面外 */
const MARGIN = 40;

function updatePositions() {
  const handle = ctx?.getHandle() ?? null;
  const m = meta.value;
  if (!handle || !m) {
    positions.value = {};
    return;
  }
  const lift = m.look?.sign?.lift ?? 0;
  const specs: LabelSpec[] = [];
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
    if (visible) visibleCount += 1;
    specs.push({
      id: `lantern-${l.college.no}`,
      priority: store.collegeNo === l.college.no ? 60 : 50,
      ax: p0.x + l.offset,
      ay: p0.y,
      w: 46,
      h: 46,
      gap: lineLen,
      compactW: 36,
      compactH: 36,
      compactGap: 12,
      visible,
      movable: true,
      axis: "x",
    });
  }
  board?.publish("lanterns", specs);

  // 没有院徽的学院：小序号方块（不参与灯牌避让，点位直接用锚点）
  const next: Record<number, { x: number; y: number; visible: boolean }> = {};
  for (const e of markEntries.value) {
    const p = handle.project(e.anchor);
    next[e.index] = {
      x: p.x,
      y: p.y,
      visible: p.visible
        && p.x >= -MARGIN && p.x <= window.innerWidth + MARGIN
        && p.y >= -MARGIN && p.y <= window.innerHeight + MARGIN,
    };
  }
  positions.value = next;

  // 调试钩子（A2 第 5 条）：当前可见的灯牌数（布局算出前先用投影数）
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  if (hook) hook.lanterns = visibleCount;
}

const showLayer = computed(() => ctx?.sceneStatus.value === "ready");

/** 键盘焦点落在被收起的灯牌上时，交给右侧面板同一行，Tab 不落在看不见的标记上 */
watch(layouts, (ls) => {
  const active = document.activeElement as HTMLElement | null;
  const id = active?.dataset?.lanternId;
  if (!id) return;
  const L = ls[id];
  if (!L || L.form !== "hidden") return;
  const no = Number(id.replace("lantern-", ""));
  const index = indexOfCollege(entries.value, no);
  if (!index) return;
  const row = document.querySelector<HTMLElement>(`[data-testid="stage-college-${index}"]`);
  row?.focus();
});

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
  <div v-if="showLayer" class="stage-lanterns" aria-label="学院标记">
    <button
      v-for="l in lanterns"
      :key="l.college.no"
      type="button"
      class="stage-lantern"
      :class="{ 'is-hover': hoverNo === l.college.no, 'is-compact': isCompact(l.college.no) }"
      :data-testid="`stage-lantern-${l.college.no}`"
      :data-lantern-id="`lantern-${l.college.no}`"
      :style="lanternStyle(l.college.no)"
      :aria-label="ariaOf(l)"
      :aria-hidden="isHidden(l.college.no) ? 'true' : undefined"
      :tabindex="isHidden(l.college.no) ? -1 : undefined"
      @click="onLanternClick(l.college.no)"
      @mouseenter="hoverNo = l.college.no"
      @mouseleave="hoverNo = null"
      @focus="hoverNo = l.college.no"
      @blur="hoverNo = null"
    >
      <span class="stage-lantern-disc">
        <EmblemMark
          :college="l.college"
          :size="discSize(l.college.no)"
          tone="gilt"
        />
        <span v-if="l.badge !== null" class="stage-lantern-no" aria-hidden="true">{{ cnNumber(l.badge) }}</span>
        <span v-if="extraOf(l.college.no) > 0" class="stage-lantern-plus" aria-hidden="true">+{{ extraOf(l.college.no) }}</span>
      </span>
      <span class="stage-lantern-line" :style="{ height: lineHeight(l.college.no) }"></span>
      <span
        v-if="Math.abs(dxOf(l.college.no)) > 0.5"
        class="stage-lantern-leader"
        :style="leaderStyle(l.college.no)"
      ></span>
      <!-- 悬停：横排短名（有建院年份的下面一行小字）；全名在 aria-label 与右侧面板 -->
      <span
        v-if="hoverNo === l.college.no"
        class="stage-lantern-tag"
        :class="{ 'is-left': tagLeft(l.college.no) }"
      >
        <span class="stage-lantern-tag-name">{{ shortName(l.college) }}</span>
        <span v-if="l.college.year !== null" class="stage-lantern-tag-year">{{ l.college.year }}</span>
      </span>
    </button>

    <!-- 没有院徽的学院：小序号（点了落楼；悬停出短名） -->
    <button
      v-for="e in markEntries"
      :key="`mark-${e.index}`"
      type="button"
      class="stage-mark"
      :class="{ 'is-hover': hoverMark === e.index }"
      :data-testid="`stage-mark-${e.index}`"
      :style="markStyle(e.index)"
      :aria-label="e.fullName"
      @click="onMarkClick(e)"
      @mouseenter="hoverMark = e.index"
      @mouseleave="hoverMark = null"
      @focus="hoverMark = e.index"
      @blur="hoverMark = null"
    >
      {{ cnNumber(e.index) }}
      <span v-if="hoverMark === e.index" class="stage-mark-tag">{{ e.name }}</span>
    </button>
  </div>
</template>

<style scoped>
/* 学院标记层：同场景标签层（z-index 3）、面板之下 */
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
  outline: 2px solid var(--st-ov-gold);
  outline-offset: 3px;
}
/* 深色底 + 细金边的圆，里面放鎏金院徽（固定深墨蓝，不随页面主题变） */
.stage .stage-lantern-disc {
  position: relative;
  display: flex;
  padding: 3px;
  background: var(--st-ov-bg);
  box-shadow: 0 0 0 1px var(--st-ov-gold-soft), 0 6px 18px rgba(0, 0, 0, 0.6);
  transition: box-shadow 160ms;
}
/* 与右侧面板对应的行号（右下角小角标） */
.stage .stage-lantern-no {
  position: absolute;
  right: -5px;
  bottom: -5px;
  min-width: 16px;
  height: 16px;
  padding: 0 2px;
  display: grid;
  place-items: center;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-soft);
  font-family: var(--st-song);
  font-weight: 700;
  font-size: 9.5px;
  line-height: 1;
  color: var(--st-ov-gold);
}
/* 同楼多学院被挤掉时，代表院徽右上角的「+N」 */
.stage .stage-lantern-plus {
  position: absolute;
  right: -6px;
  top: -6px;
  min-width: 16px;
  height: 16px;
  padding: 0 2px;
  display: grid;
  place-items: center;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold);
  font-family: var(--st-hei);
  font-weight: 600;
  font-size: 9.5px;
  line-height: 1;
  color: var(--st-ov-gold);
}
/* 悬停/聚焦：圆发光（院徽尺寸在组件里切到 50） */
.stage .stage-lantern.is-hover .stage-lantern-disc {
  box-shadow: 0 0 0 1.5px var(--st-ov-gold), 0 0 26px 4px rgba(232, 201, 138, 0.55);
}
/* 落到楼顶的细金线：1px，从金渐变到透明（长度每帧按投影算） */
.stage .stage-lantern-line {
  width: 1px;
  min-height: 12px;
  background: linear-gradient(to bottom, var(--st-ov-gold), rgba(232, 201, 138, 0));
}
/* 横向错开后补的一小段水平细线（从线底回到真实锚点） */
.stage .stage-lantern-leader {
  position: absolute;
  left: 50%;
  bottom: 0;
  height: 1px;
  background: linear-gradient(to right, var(--st-ov-gold), rgba(232, 201, 138, 0.2));
  pointer-events: none;
}
/* 悬停题签：横排（黑体 13px 600、行高 1.4、内边距 6×10），固定深墨蓝底、淡金边 */
.stage .stage-lantern-tag {
  position: absolute;
  left: calc(100% + 10px);
  top: 2px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: max-content;
  max-width: min(11em, 42vw);
  padding: 6px 10px;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-soft);
  border-left: 2px solid var(--st-ov-gold);
  box-shadow: var(--st-ov-shadow);
  pointer-events: none;
  z-index: 2;
}
.stage .stage-lantern-tag.is-left {
  left: auto;
  right: calc(100% + 10px);
  border-left: 1px solid var(--st-ov-gold-soft);
  border-right: 2px solid var(--st-ov-gold);
}
.stage .stage-lantern-tag-name {
  writing-mode: horizontal-tb;
  font-family: var(--st-hei);
  font-weight: 600;
  font-size: 13px;
  line-height: 1.4;
  letter-spacing: 0.02em;
  text-align: left;
  overflow-wrap: anywhere;
  color: var(--st-ov-fg);
}
/* 建院年份：10px 等宽小字，在题签第二行 */
.stage .stage-lantern-tag-year {
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 10px;
  letter-spacing: 0.06em;
  color: var(--st-ov-gold);
}
/* 无院徽时的小序号方块（W9 原样，颜色已改覆盖件固定色） */
.stage .stage-mark {
  position: fixed;
  transform: translate(-50%, -50%);
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-fg2);
  font-family: var(--st-song);
  font-weight: 700;
  font-size: 11px;
  line-height: 1;
  color: var(--st-ov-fg);
  cursor: pointer;
  pointer-events: auto;
}
.stage .stage-mark:focus-visible {
  outline: 2px solid var(--st-ov-gold);
  outline-offset: 2px;
}
.stage .stage-mark-tag {
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  transform: translateY(-50%);
  padding: 3px 8px;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-soft);
  white-space: nowrap;
  font-family: var(--st-hei);
  font-weight: 600;
  font-size: 12.5px;
  line-height: 1.4;
  color: var(--st-ov-fg);
  pointer-events: none;
}
</style>
