<script setup lang="ts">
// STAGE W3 + 本次「标签分级」：悬在校区/地标/楼上方的题签。
// 位置每帧由 project() 重算，交给共用布局板统一避让（src/stage/labels.ts）：
//  - 全校首页：只留校区竖签；题字露出时真实题字区域留空（hero 也作为遮挡矩形）
//  - 校区概览：只留当前校区竖签（学院标记在 CollegeLanterns）
//  - 校区沙盘首页：地标题签（固定锚点，不被挤走）
//  - 回答定位：楼的题签唯一一块，朱砂边；被面板挤到时先用横排短签，再收起
// 题签的锚点（线底端）不动；需要错开时从文字框边缘画一根短引线回锚点。
import { computed, inject, onBeforeUnmount, onMounted, type Ref } from "vue";
import type { StageCtx } from "@/stage/types";
import type { ZoneInfo } from "@/campus3d/meta";
import { useStageStore } from "@/stores/stage";
import { LABEL_BOARD_KEY } from "@/stage/labelBoard";
import { shiftOf, type LabelSpec } from "@/stage/labels";
import { STAR_TRAIL_KEY, type StarTrailState } from "@/components/stage/ZdxStar.vue";
import EmblemMark from "@/components/stage/EmblemMark.vue";

const ctx = inject<StageCtx>("stageCtx");
const store = useStageStore();
const meta = computed(() => ctx?.meta.value ?? null);
const board = inject(LABEL_BOARD_KEY, null);

// W7：智多星的拖尾（ZdxStar 写 StarTrailState，这里只负责画）
const starTrail = inject<Ref<StarTrailState | null> | null>(STAR_TRAIL_KEY, null);

const HERO_RECT = { w: 640, h: 470 };
const VIS_MARGIN = 40;

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

/** W3：校区沙盘的首页——给元数据 hotspots 里的每一块地标小题签 */
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

const showLayer = computed(() => ctx?.sceneStatus.value === "ready");
const layouts = computed(() => board?.layouts.value ?? {});

/** ALIVE A3：楼题签顶上的本色院徽（collegeNo 由 store 按楼 + 回答文字定） */
const signCollege = computed(() => {
  if (store.mode !== "answer" || store.collegeNo === null || !store.emblems) return null;
  return store.emblems.colleges.find((c) => c.no === store.collegeNo) ?? null;
});

/** 竖排题签的尺寸估算（只算文字框，不含引线；引线绝对定位在框下） */
function signSize(name: string, _line: number, small = false) {
  const chars = Math.max(1, name.length);
  if (small) return { w: 34, h: 12 + chars * 17 + 3 };
  return { w: 40, h: 13 + chars * 26 };
}

/** 楼的短签：横排，最多 12 字（超出由右侧面板给全名） */
function shortSign(name: string) {
  const text = name.length > 12 ? `${name.slice(0, 11)}…` : name;
  return { text, w: Math.min(260, 26 + text.length * 13.5), h: 32 };
}

function projected(p: { x: number; y: number; visible: boolean }): boolean {
  return (
    p.visible
    && p.x >= -VIS_MARGIN && p.x <= window.innerWidth + VIS_MARGIN
    && p.y >= -VIS_MARGIN && p.y <= window.innerHeight + VIS_MARGIN
  );
}

function inHero(p: { x: number; y: number }): boolean {
  return store.mode === "home"
    && p.x >= 0 && p.x <= HERO_RECT.w && p.y >= 0 && p.y <= HERO_RECT.h;
}

function buildSpecs(): LabelSpec[] {
  const handle = ctx?.getHandle();
  if (!handle) return [];
  const list: LabelSpec[] = [];

  for (const z of zones.value) {
    if (!z.label) continue;
    const p = handle.project(z.label);
    const s = signSize(z.name, 40);
    list.push({
      id: `zone-${z.id}`,
      priority: store.mode === "campus" ? 80 : 70,
      ax: p.x,
      ay: p.y,
      w: s.w,
      h: s.h,
      gap: 40,
      compactW: s.w,
      compactH: s.h,
      compactGap: 40,
      visible: projected(p) && !inHero(p),
      movable: true,
      axis: "y",
    });
  }

  for (const h of landmarks.value) {
    if (!h.anchor) continue;
    const p = handle.project(h.anchor);
    const s = signSize(h.board, 26, true);
    list.push({
      id: `landmark-${h.no}`,
      priority: 90,
      ax: p.x,
      ay: p.y,
      w: s.w,
      h: s.h,
      gap: 26,
      compactW: s.w,
      compactH: s.h,
      compactGap: 26,
      visible: projected(p) && !inHero(p),
      movable: true,
      axis: "y",
    });
  }

  if (buildingSign.value) {
    const b = buildingSign.value;
    const p = handle.project(b.anchor);
    const s = signSize(b.name, 60);
    const c = shortSign(b.name);
    // 题签顶上还有院徽（44 + 6 边）+ 8px 红线 + 两段间距：整块往上长，底端不动
    if (signCollege.value) s.h += 72;
    list.push({
      id: `building-${b.id}`,
      priority: 100,
      ax: p.x,
      ay: p.y,
      w: s.w,
      h: s.h,
      gap: 60,
      compactW: c.w,
      compactH: c.h,
      compactGap: 20,
      visible: projected(p) && !inHero(p),
      movable: true,
      axis: "xy",
    });
  }

  return list;
}

function updateFrame() {
  board?.publish("signs", buildSpecs());
}

function layoutOf(id: string) {
  return layouts.value[id];
}

function hidden(id: string): boolean {
  return !layoutOf(id) || layoutOf(id)!.form === "hidden";
}

function isCompact(id: string): boolean {
  return layoutOf(id)?.form === "compact";
}

function signStyle(id: string): Record<string, string> {
  const L = layoutOf(id);
  if (!L || L.form === "hidden") return { display: "none" };
  if (L.form === "compact") return { display: "none" };
  const d = shiftOf(L);
  return {
    left: `${L.ax + d.dx}px`,
    top: `${L.ay - L.gap - d.dy}px`,
  };
}

/** 紧凑形态（只有楼的题签用）：锚点正上方 20px 的横排短签 */
function compactStyle(id: string): Record<string, string> {
  const L = layoutOf(id);
  if (!L || L.form !== "compact") return { display: "none" };
  const d = shiftOf(L);
  return {
    left: `${L.ax + d.dx}px`,
    top: `${L.ay - L.gap - d.dy}px`,
  };
}

function lineHeight(id: string): string {
  const L = layoutOf(id);
  if (!L) return "0px";
  const d = shiftOf(L);
  return `${L.gap + d.dy}px`;
}

/** 只有横向错开才需要斜引线（纯向上挪时仍是竖直引线，锚点不变） */
function shifted(id: string): boolean {
  const L = layoutOf(id);
  return !!L && L.form !== "hidden" && Math.abs(shiftOf(L).dx) > 0.5;
}

/** 错开后从文字框底边画一根 1px 短引线回锚点（角度按屏幕坐标） */
function leaderStyle(id: string): Record<string, string> {
  const L = layoutOf(id);
  if (!L || L.form === "hidden") return { display: "none" };
  const d = shiftOf(L);
  const dy = L.gap + d.dy;
  const len = Math.hypot(d.dx, dy);
  const deg = (Math.atan2(dy, -d.dx) * 180) / Math.PI;
  return { width: `${len}px`, transform: `rotate(${deg}deg)` };
}

function onClick(id: string) {
  void store.pickCampus(id);
}

/** W9：点地标题签 → 飞到它的楼 */
function onLandmarkClick(buildingId: string) {
  store.board = null;
  void store.showBuilding(buildingId);
}

/** ALIVE A9：点灯（首页五块校区题签）——按标记点到原点水平距离由近到远，每盏错开 60ms */
const lit = computed(() => store.lightSeq > 0);
const zoneLightDelays = computed(() => {
  const map = new Map<string, number>();
  const arr = zones.value
    .filter((z) => z.label)
    .map((z) => ({ id: z.id, d: Math.hypot(z.label![0], z.label![2]) }));
  arr.sort((a, b) => a.d - b.d);
  arr.forEach((x, i) => map.set(x.id, i * 60));
  return map;
});

let offFrame: (() => void) | null = null;

onMounted(() => {
  offFrame = ctx?.registerFrame(updateFrame) ?? null;
  updateFrame();
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
      :class="{ 'is-selected': store.mode === 'campus', 'is-lighting': lit }"
      :data-testid="`stage-sign-${z.id}`"
      :aria-hidden="hidden(`zone-${z.id}`) ? 'true' : undefined"
      :tabindex="hidden(`zone-${z.id}`) ? -1 : undefined"
      :style="{
        ...signStyle(`zone-${z.id}`),
        '--light-delay': `${zoneLightDelays.get(z.id) ?? 0}ms`,
      }"
      @click="onClick(z.id)"
    >
      <span class="stage-sign-label">{{ z.name }}</span>
      <span
        v-if="!shifted(`zone-${z.id}`)"
        class="stage-sign-line"
        :style="{ height: lineHeight(`zone-${z.id}`) }"
      ></span>
      <span v-else class="stage-sign-leader" :style="leaderStyle(`zone-${z.id}`)"></span>
    </button>
    <!-- W3 画、W9 改可点：校区沙盘首页的地标小题签——点了飞到它的楼 -->
    <button
      v-for="h in landmarks"
      :key="`landmark-${h.no}`"
      type="button"
      class="stage-sign is-landmark"
      :data-testid="`stage-landmark-${h.no}`"
      :aria-hidden="hidden(`landmark-${h.no}`) ? 'true' : undefined"
      :tabindex="hidden(`landmark-${h.no}`) ? -1 : undefined"
      :style="signStyle(`landmark-${h.no}`)"
      @click="onLandmarkClick(h.buildingId)"
    >
      <span class="stage-sign-label">{{ h.board }}</span>
      <span
        v-if="!shifted(`landmark-${h.no}`)"
        class="stage-sign-line"
        :style="{ height: lineHeight(`landmark-${h.no}`) }"
      ></span>
      <span v-else class="stage-sign-leader" :style="leaderStyle(`landmark-${h.no}`)"></span>
    </button>
    <!-- 回答定位：唯一一块楼题签（朱砂边）；挤不下时缩成横排短签 -->
    <button
      v-if="buildingSign"
      type="button"
      class="stage-sign is-selected is-building"
      :class="{ 'is-compact': isCompact(`building-${buildingSign.id}`) }"
      :data-testid="`stage-sign-${buildingSign.id}`"
      :aria-hidden="hidden(`building-${buildingSign.id}`) ? 'true' : undefined"
      :tabindex="hidden(`building-${buildingSign.id}`) ? -1 : undefined"
      :style="isCompact(`building-${buildingSign.id}`)
        ? compactStyle(`building-${buildingSign.id}`)
        : signStyle(`building-${buildingSign.id}`)"
    >
      <span v-if="signCollege && !isCompact(`building-${buildingSign.id}`)" class="stage-sign-emblem" data-testid="stage-sign-emblem">
        <EmblemMark :college="signCollege" :size="44" tone="color" />
      </span>
      <span v-if="signCollege && !isCompact(`building-${buildingSign.id}`)" class="stage-sign-emblem-line" aria-hidden="true"></span>
      <span class="stage-sign-label">{{ buildingSign.name }}</span>
      <span
        v-if="!shifted(`building-${buildingSign.id}`)"
        class="stage-sign-line"
        :style="{ height: lineHeight(`building-${buildingSign.id}`) }"
      ></span>
      <span v-else class="stage-sign-leader" :style="leaderStyle(`building-${buildingSign.id}`)"></span>
    </button>
  </div>
</template>

<style scoped>
/* 场景标签层（4.1 层 3）：占满视口、本身不接收鼠标；题签可以点。
   题签底端中点落在锚点（translate(-50%,-100%)）；线/引线从底边伸出。 */
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
/* ALIVE A9：开场点灯——由近到远，每块 240ms 从 0.6 倍、透明到原样 */
.stage .stage-sign.is-lighting {
  animation: stage-sign-light-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  animation-delay: var(--light-delay, 0ms);
}
@keyframes stage-sign-light-in {
  from { opacity: 0; transform: translate(-50%, -100%) scale(0.6); }
  to { opacity: 1; transform: translate(-50%, -100%) scale(1); }
}
@media (prefers-reduced-motion: reduce) {
  .stage .stage-sign.is-lighting { animation: none; }
}
.stage .stage-sign:focus-visible {
  outline: 2px solid var(--st-ov-gold);
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
  position: absolute;
  left: 50%;
  top: 100%;
  width: 1px;
  background: linear-gradient(to bottom, var(--st-ov-gold), rgba(232, 201, 138, 0));
  pointer-events: none;
}
/* ALIVE A3：楼题签顶上的本色院徽（朱红圈 + 8px 朱红短线），底端位置不变 */
.stage .stage-sign-emblem {
  display: flex;
  padding: 3px;
  border-radius: 50%;
  background: var(--st-ov-bg);
  box-shadow: 0 0 0 2px var(--st-red), 0 0 22px rgba(226, 0, 26, 0.55);
}
.stage .stage-sign-emblem-line {
  display: block;
  width: 2px;
  height: 8px;
  background: var(--st-red);
}
/* 错开后的短引线：从底边中点回锚点（角度由布局结果算） */
.stage .stage-sign-leader {
  position: absolute;
  left: 50%;
  bottom: 0;
  height: 1px;
  transform-origin: 0 50%;
  background: linear-gradient(to right, var(--st-ov-gold), rgba(232, 201, 138, 0.15));
  pointer-events: none;
}
.stage .stage-sign.is-selected .stage-sign-leader {
  background: linear-gradient(to right, var(--st-red), rgba(214, 59, 44, 0.2));
}
/* W3 画、W9 可点：地标小题签——线 26px、字小一号 */
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
/* 楼题签挤不下时的横排短签（朱砂边、20px 短引线） */
.stage .stage-sign.is-compact {
  flex-direction: row;
  gap: 0;
  padding: 6px 10px;
}
.stage .stage-sign.is-compact .stage-sign-label {
  writing-mode: horizontal-tb;
  font-family: var(--st-hei);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: 0.02em;
  white-space: nowrap;
}
.stage .stage-sign.is-compact .stage-sign-line {
  width: 1px;
  background: var(--st-red);
}</style>
