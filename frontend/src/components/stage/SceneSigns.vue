<script setup lang="ts">
// STAGE W3：悬在校区上方的题签。位置每帧由 project(zone.label) 重算（STAGE 常见错误 7）：
// 题签底端中点在标记点上方 40px，中间一根 1px 线落到标记点。
// 只在 3D 就绪后显示；首页状态下落在题字矩形（左上 640×470）里的不显示，免得压字。
import { computed, inject, onBeforeUnmount, onMounted, ref, type Ref } from "vue";
import type { StageCtx } from "@/stage/types";
import type { ZoneInfo } from "@/campus3d/meta";
import { useStageStore } from "@/stores/stage";
import { cnNumber } from "@/stage/hud";
import { STAR_TRAIL_KEY, type StarTrailState } from "@/components/stage/ZdxStar.vue";
const ctx = inject<StageCtx>("stageCtx");
const store = useStageStore();
const meta = computed(() => ctx?.meta.value ?? null);

// W7：智多星的拖尾（ZdxStar 写 StarTrailState，这里只负责画）
const starTrail = inject<Ref<StarTrailState | null> | null>(STAR_TRAIL_KEY, null);

const HERO_RECT = { w: 640, h: 470 };

type Pos = { x: number; y: number; visible: boolean };
const positions = ref<Record<string, Pos>>({});

/** home + 默认包：全部「校区」题签；campus：只留选中的那块；
 *  home + 非默认包：校区题签全收，换成地标小题签（W3 第 6 条）；answer：全收（W5 换成楼的题签） */
const zones = computed<ZoneInfo[]>(() => {
  const m = meta.value;
  if (!m?.zones) return [];
  if (store.mode === "answer") return [];
  if (store.mode === "home" && store.packId !== store.default) return [];
  const kinded = m.zones.filter((z) => z.kind === "校区" && z.label);
  if (store.mode === "campus") return kinded.filter((z) => z.id === store.zoneId);
  return kinded;
});

/** W3：校区沙盘的首页——给元数据 hotspots 里的每一块地标小题签
 *  （文字 board、标记点 anchor；这张卡里不响应点击） */
const landmarks = computed(() => {
  if (store.mode !== "home" || store.packId === store.default) return [];
  return meta.value?.hotspots ?? [];
});

/** W5：答案态那栋楼的题签：标记点 = anchor 再往上 look.sign.lift，线长 60px */
const buildingSign = computed(() => {
  if (store.mode !== "answer" || !store.place) return null;
  const bid = store.place.buildingId;
  const b = meta.value?.buildings[bid];
  if (!b?.anchor) return null;
  const lift = meta.value?.look.sign?.lift ?? 0;
  const name = store.place.name
    .replace(/（[^）]*）/g, "")
    .replace(/\([^)]*\)/g, "")
    .trim();
  return {
    id: bid,
    name: name || store.place.name,
    anchor: [b.anchor[0], b.anchor[1] + lift, b.anchor[2]] as [number, number, number],
  };
});

/** W9：campus 态给这个片区每个学院的第一栋楼画序号标记（同楼两院只画第一个） */
type CollegeMark = { index: number; buildingId: string; name: string; anchor: [number, number, number] };
const collegeMarks = computed<CollegeMark[]>(() => {
  const m = meta.value;
  const zid = store.zoneId;
  if (store.mode !== "campus" || !m?.colleges || !zid) return [];
  const seen = new Set<string>();
  const marks: CollegeMark[] = [];
  for (const c of m.colleges) {
    if (c.zone !== zid) continue;
    const bid = c.buildingIds[0];
    if (!bid || seen.has(bid)) continue;
    const b = m.buildings[bid];
    if (!b?.anchor) continue;
    seen.add(bid);
    marks.push({
      index: marks.length + 1,
      buildingId: bid,
      name: c.name.replace(/（[^）]*）/g, "").replace(/\([^)]*\)/g, "").trim(),
      anchor: b.anchor,
    });
  }
  return marks;
});

const showLayer = computed(() => ctx?.sceneStatus.value === "ready");

function updatePositions() {
  const handle = ctx?.getHandle() ?? null;
  if (!handle) return;
  const next: Record<string, Pos> = {};
  for (const z of zones.value) {
    if (!z.label) continue;
    next[z.id] = handle.project(z.label);
  }
  // W3：地标小题签（key 用 landmark-<no>）
  for (const h of landmarks.value) {
    next[`landmark-${h.no}`] = handle.project(h.anchor);
  }
  if (buildingSign.value) {
    next[buildingSign.value.id] = handle.project(buildingSign.value.anchor);
  }
  // W9：学院序号标记（key 用 mark-<序号>，同楼去重后的那批楼）
  for (const m of collegeMarks.value) {
    next[`mark-${m.index}`] = handle.project(m.anchor);
  }
  positions.value = next;
}

function landmarkStyle(no: string): Record<string, string> {
  const p = positions.value[`landmark-${no}`];
  if (!p || !p.visible) return { display: "none" };
  if (store.mode === "home" && p.x >= 0 && p.x <= HERO_RECT.w && p.y >= 0 && p.y <= HERO_RECT.h) {
    return { display: "none" };
  }
  return { left: `${p.x}px`, top: `${p.y}px` };
}

function markStyle(index: number): Record<string, string> {
  const p = positions.value[`mark-${index}`];
  if (!p || !p.visible) return { display: "none" };
  return { left: `${p.x}px`, top: `${p.y}px` };
}

function styleOf(id: string): Record<string, string> {
  const p = positions.value[id];
  if (!p || !p.visible) return { display: "none" };
  if (store.mode === "home" && p.x >= 0 && p.x <= HERO_RECT.w && p.y >= 0 && p.y <= HERO_RECT.h) {
    return { display: "none" };
  }
  return { left: `${p.x}px`, top: `${p.y}px` };
}

function onClick(id: string) {
  void store.pickCampus(id);
}

/** W9：点序号标记等于点学院列表那一行 */
function onMarkClick(row: { buildingId: string }) {
  store.board = null;
  void store.showBuilding(row.buildingId);
}

/** W9：点地标题签 → 飞到它的楼（先清板，板块面板让位给楼的题签面板形态） */
function onLandmarkClick(buildingId: string) {
  store.board = null;
  void store.showBuilding(buildingId);
}

let offFrame: (() => void) | null = null;

onMounted(() => {
  offFrame = ctx?.registerFrame(updatePositions) ?? null;
  updatePositions();
});

onBeforeUnmount(() => {
  offFrame?.();
});
</script>

<template>
  <div v-if="showLayer" class="stage-signs" aria-label="校区题签">
    <!-- W7：智多星的飞行拖尾（连线层里的二次曲线，渐隐白线；注入的 ref 在模板自动解包） -->
    <svg
      v-if="starTrail"
      class="stage-signs-trail"
      :class="{ 'is-fading': starTrail.fading }"
      data-testid="stage-star-trail"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="stage-star-trail-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="rgba(255, 255, 255, 0)" />
          <stop offset="1" stop-color="rgba(255, 255, 255, 0.9)" />
        </linearGradient>
      </defs>
      <path :d="starTrail.d" fill="none" stroke="url(#stage-star-trail-grad)" stroke-width="1.5" />
    </svg>
    <button
      v-for="z in zones"
      :key="z.id"
      type="button"
      class="stage-sign"
      :class="{ 'is-selected': store.mode === 'campus' }"
      :data-testid="`stage-sign-${z.id}`"
      :style="styleOf(z.id)"
      @click="onClick(z.id)"
    >
      <span class="stage-sign-label">{{ z.name }}</span>
      <span class="stage-sign-line"></span>
    </button>
    <!-- W3 画、W9 改可点：校区沙盘首页的地标小题签——点了飞到它的楼 -->
    <button
      v-for="h in landmarks"
      :key="`landmark-${h.no}`"
      type="button"
      class="stage-sign is-landmark"
      :data-testid="`stage-landmark-${h.no}`"
      :style="landmarkStyle(h.no)"
      @click="onLandmarkClick(h.buildingId)"
    >
      <span class="stage-sign-label">{{ h.board }}</span>
      <span class="stage-sign-line"></span>
    </button>
    <button
      v-for="m in collegeMarks"
      :key="m.buildingId"
      type="button"
      class="stage-mark"
      :data-testid="`stage-mark-${m.index}`"
      :style="markStyle(m.index)"
      @click="onMarkClick(m)"
    >
      <span class="stage-mark-label">{{ m.name }}</span>
      {{ cnNumber(m.index) }}
    </button>
    <button
      v-if="buildingSign"
      type="button"
      class="stage-sign is-selected is-building"
      :data-testid="`stage-sign-${buildingSign.id}`"
      :style="styleOf(buildingSign.id)"
    >
      <span class="stage-sign-label">{{ buildingSign.name }}</span>
      <span class="stage-sign-line"></span>
    </button>
  </div>
</template>

<style scoped>
/* 场景标签层（4.1 层 3）：占满视口、本身不接收鼠标；题签可以点。
   题签底端中点落在锚点（translate(-50%,-100%)），线占底部 40px。 */
.stage .stage-signs {
  position: fixed;
  inset: 0;
  z-index: 3;
  pointer-events: none;
}
/* W7：拖尾层——fixed 全屏、不设 viewBox、不接鼠标；飞完 300ms 淡出后由 ZdxStar 移除 */
.stage .stage-signs-trail {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  transition: opacity 300ms;
}
.stage .stage-signs-trail.is-fading {
  opacity: 0;
}
.stage .stage-sign {
  position: fixed;
  transform: translate(-50%, -100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 7px 0;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-faint);
  border-top: 2px solid var(--st-ov-gold);
  box-shadow: var(--st-ov-shadow);
  cursor: pointer;
  pointer-events: auto;
}
.stage .stage-sign:focus-visible {
  outline: 1px solid var(--st-gold2);
  outline-offset: 2px;
}
.stage .stage-sign.is-selected {
  border-color: var(--st-red);
  border-top-color: var(--st-red);
}
.stage .stage-sign-label {
  writing-mode: vertical-rl;
  font-family: var(--st-song);
  font-weight: 600;
  font-size: 17px;
  letter-spacing: 0.32em;
  color: var(--st-ov-fg);
}
.stage .stage-sign-line {
  display: block;
  width: 1px;
  height: 40px;
  background: linear-gradient(to bottom, var(--st-ov-gold), rgba(232, 201, 138, 0));
}
/* W5：楼的题签线长 60px（校区 40px） */
.stage .stage-sign.is-building .stage-sign-line {
  height: 60px;
}
/* W3 画、W9 可点：地标小题签——线 26px、字小一号；点击飞到它的楼 */
.stage .stage-sign.is-landmark {
  cursor: pointer;
  pointer-events: auto;
  padding: 8px 7px 0;
  border-top-width: 1px;
}
.stage .stage-sign.is-landmark .stage-sign-label {
  font-size: 13px;
  letter-spacing: 0.24em;
}
.stage .stage-sign.is-landmark .stage-sign-line {
  height: 26px;
}
/* W9：学院序号标记——20×20 小方块，固定深墨蓝底、月白字；右边学院名落同款底板 */
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
  z-index: 1;
}
.stage .stage-mark:focus-visible {
  outline: 1px solid var(--st-gold2);
  outline-offset: 2px;
}
.stage .stage-mark-label {
  position: absolute;
  left: 27px;
  top: 50%;
  transform: translateY(-50%);
  max-width: 11em;
  width: max-content;
  padding: 3px 8px;
  white-space: normal;
  background: var(--st-ov-bg);
  border: 1px solid var(--st-ov-gold-faint);
  border-left: 1.5px solid var(--st-ov-gold-soft);
  font-family: var(--st-hei);
  font-weight: 500;
  font-size: 12.5px;
  line-height: 1.4;
  letter-spacing: 0.02em;
  text-align: left;
  color: var(--st-ov-fg2);
  pointer-events: none;
}
</style>
