<script setup lang="ts">
// ALIVE A4：二十四院罗盘。盘面（SVG）按 −方位角 转，院徽是不转的按钮、按 dial.deg 摆；
// 指着院徽时它还原本色、外圈变红，一根红线落到沙盘上它的楼。
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { StageCtx } from "@/stage/types";
import { useStageStore } from "@/stores/stage";
import { shortName, type College } from "@/stage/emblems";
import EmblemMark from "@/components/stage/EmblemMark.vue";

const ctx = inject<StageCtx>("stageCtx");
const store = useStageStore();
const emblems = computed(() => store.emblems);
const meta = computed(() => ctx?.meta.value ?? null);

const reduced = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const vw = ref(typeof window !== "undefined" ? window.innerWidth : 0);
const vh = ref(typeof window !== "undefined" ? window.innerHeight : 0);
function onResize() {
  vw.value = window.innerWidth;
  vh.value = window.innerHeight;
}

/** 盘径：视口高的 0.82、最大 840、最多占视口宽 0.9 */
const D = computed(() => Math.min(0.82 * vh.value, 840, 0.9 * vw.value));
const k = computed(() => D.value / (emblems.value?.dial.viewBox ?? 1000));
/** 盘的左上角在视口里的位置（盘心在视口中心） */
const ox0 = computed(() => vw.value / 2 - D.value / 2);
const oy0 = computed(() => vh.value / 2 - D.value / 2);

const azimuth = ref(0);
/** 展开起点（罗盘中心相对盘左上角），用来做「从罗盘长出来」的缩放 */
const origin = ref({ x: 0, y: 0 });

type Slot = {
  no: number;
  college: College;
  /** 盘内坐标（left/top） */
  x: number;
  y: number;
  /** 简称的位置（盘内） */
  sx: number;
  sy: number;
  size: number;
  onPack: boolean;
  short: string;
  hint: string | null;
};

const slots = ref<Slot[]>([]);

type Thread = { d: string; ex: number; ey: number; label: string; meta: string };
const hoverThread = ref<Thread | null>(null);

/** 本地可见状态：收起动画还要 260ms，不能直接跟着 dialOpen 卸载 */
const visible = ref(false);
const closing = ref(false);
let closeTimer = 0;
let pendingTimer = 0;
const pendingNo = ref<number | null>(null);

const hoverSlot = computed(
  () => slots.value.find((s) => s.no === store.dialHover) ?? null
);

function packName(packId: string): string {
  const p = store.packs.find((x) => x.id === packId);
  return (p?.name ?? "").replace(/校区$/, "");
}

function zoneName(zone: string | undefined): string {
  if (!zone) return "";
  return meta.value?.zones?.find((z) => z.id === zone)?.name ?? zone;
}

function build() {
  const e = emblems.value;
  const m = meta.value;
  if (!visible.value || !e) return;
  const hook = (window as unknown as { __campus3d?: { azimuth?: number } }).__campus3d;
  azimuth.value = Number(hook?.azimuth ?? 0);

  const R = e.dial.emblemRadius * k.value;
  const R2 = 262 * k.value;
  const half = D.value / 2;
  const rad = Math.PI / 180;
  const pl = store.places;

  slots.value = e.colleges.map((c) => {
    const th = (c.dial.deg - azimuth.value) * rad;
    const onPack = m ? c.buildingIds.some((id) => !!m.buildings[id]) : true;
    const first = c.buildingIds[0];
    const other = first ? pl?.packOf[first] : undefined;
    const hint = onPack ? null : other ? packName(other) : "待定";
    return {
      no: c.no,
      college: c,
      x: half + R * Math.sin(th),
      y: half - R * Math.cos(th),
      sx: half + R2 * Math.sin(th),
      sy: half - R2 * Math.cos(th),
      size: e.dial.emblemSize * k.value,
      onPack,
      short: c.short,
      hint,
    };
  });

  // 指着的院徽 → 它的楼：红线从小牌中心往楼的方向走 6% 起步，中点再往上抬距离的 12%
  const hs = slots.value.find((s) => s.no === store.dialHover && s.onPack);
  const handle = ctx?.getHandle() ?? null;
  if (hs && handle && m) {
    const bid = hs.college.buildingIds.find((id) => !!m.buildings[id]);
    const b = bid ? m.buildings[bid] : null;
    if (b?.anchor) {
      const p = handle.project(b.anchor);
      const sx = ox0.value + hs.x;
      const sy = oy0.value + hs.y;
      const dx = p.x - sx;
      const dy = p.y - sy;
      const dist = Math.hypot(dx, dy);
      const x0 = sx + dx * 0.06;
      const y0 = sy + dy * 0.06;
      const mx = (x0 + p.x) / 2;
      const my = (y0 + p.y) / 2 - dist * 0.12;
      hoverThread.value = {
        d: `M ${x0.toFixed(1)} ${y0.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`,
        ex: p.x,
        ey: p.y,
        label: shortName(hs.college),
        meta: [zoneName(b.zone), b.name || bid].filter(Boolean).join(" · "),
      };
    } else {
      hoverThread.value = null;
    }
  } else {
    hoverThread.value = null;
  }
}

/** 罗盘中心相对盘左上角（读 .stage 上的底部留白，与 StageHud 的实际位置一致） */
function measureOrigin() {
  const stageEl = document.querySelector(".stage") as HTMLElement | null;
  const cs = stageEl ? getComputedStyle(stageEl) : null;
  const dock = parseFloat(cs?.getPropertyValue("--st-dock-bottom") ?? "") || 36;
  const edge = parseFloat(cs?.getPropertyValue("--st-bot-edge") ?? "") || 24;
  // 罗盘：76×76，left = edge、bottom = dock + 4
  const compassX = edge + 38;
  const compassY = vh.value - dock - 4 - 38;
  origin.value = { x: compassX - ox0.value, y: compassY - oy0.value };
}

watch(
  () => store.dialOpen,
  async (on) => {
    if (on) {
      if (!emblems.value) return;
      window.clearTimeout(closeTimer);
      closing.value = false;
      visible.value = true;
      await nextTick();
      measureOrigin();
      // 楼在别的沙盘上的小字要查 packOf
      void store.loadPlacesData().finally(() => build());
      build();
      return;
    }
    if (!visible.value) return;
    closing.value = true;
    closeTimer = window.setTimeout(() => {
      visible.value = false;
      closing.value = false;
    }, reduced ? 0 : 260);
  }
);

function enter(no: number) {
  store.hoverDial(no);
  build();
}
function leave(no: number) {
  if (store.dialHover === no) store.hoverDial(null);
  build();
}

/** 换沙盘后等新场景就绪，再落到这个学院的楼 */
function waitPackThenCollege(packId: string, no: number) {
  const done = () =>
    store.sceneReady
    && store.packId === packId
    && store.meta !== null
    && store.meta.pack?.id === packId;
  if (done()) {
    void store.showCollege(no);
    return;
  }
  const stop = watch(done, (ok) => {
    if (!ok) return;
    stop();
    void store.showCollege(no);
  });
}

async function pick(s: Slot) {
  const no = s.no;
  const bid = s.college.buildingIds.find((id) => !!meta.value?.buildings[id]);
  if (bid) {
    store.closeDial();
    await store.showCollege(no);
    return;
  }
  // 不在当前沙盘：楼在其他沙盘 → 换过去；没有楼 → 位置待确认
  await store.loadPlacesData().catch(() => undefined);
  const first = s.college.buildingIds[0];
  const pack = first ? store.places?.packOf[first] : undefined;
  if (pack) {
    store.closeDial();
    store.switchPack(pack);
    waitPackThenCollege(pack, no);
    return;
  }
  pendingNo.value = no;
  window.clearTimeout(pendingTimer);
  pendingTimer = window.setTimeout(() => {
    pendingNo.value = null;
  }, 1500);
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && store.dialOpen) store.closeDial();
}

let offFrame: (() => void) | null = null;

onMounted(() => {
  window.addEventListener("resize", onResize);
  window.addEventListener("keydown", onKey);
  offFrame = ctx?.registerFrame(build) ?? null;
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onResize);
  window.removeEventListener("keydown", onKey);
  window.clearTimeout(closeTimer);
  window.clearTimeout(pendingTimer);
  offFrame?.();
});
</script>

<template>
  <div
    v-if="visible && emblems"
    class="stage-dial-mask"
    :class="{ 'is-closing': closing }"
    data-testid="stage-dial-mask"
    @click.self="store.closeDial()"
  >
    <!-- 红线：画在遮罩之上，视口坐标 -->
    <svg
      v-if="hoverThread"
      class="stage-dial-thread-svg"
      :viewBox="`0 0 ${vw} ${vh}`"
      aria-hidden="true"
    >
      <path :d="hoverThread.d" class="stage-dial-thread" data-testid="stage-dial-thread" />
      <circle :cx="hoverThread.ex" :cy="hoverThread.ey" r="6" class="stage-dial-thread-ring" />
      <circle :cx="hoverThread.ex" :cy="hoverThread.ey" r="1.8" class="stage-dial-thread-dot" />
    </svg>

    <div
      class="stage-dial"
      data-testid="stage-dial"
      :style="{
        width: `${D}px`,
        height: `${D}px`,
        transformOrigin: `${origin.x}px ${origin.y}px`,
      }"
    >
      <img
        class="stage-dial-face"
        :src="`/campus3d/${emblems.dial.svg}`"
        :style="{ transform: `rotate(${-azimuth}deg)` }"
        alt=""
      />

      <!-- 院徽：按钮不转，只按角度摆位置 -->
      <button
        v-for="s in slots"
        :key="s.no"
        type="button"
        class="stage-dial-slot"
        :class="{ 'is-off': !s.onPack, 'is-hover': store.dialHover === s.no }"
        :data-testid="`stage-dial-slot-${s.no}`"
        :aria-label="s.college.name"
        :style="{
          left: `${s.x}px`,
          top: `${s.y}px`,
          width: `${s.size}px`,
          height: `${s.size}px`,
          animationDelay: `${s.college.dial.slot * 18}ms`,
        }"
        @pointerenter="enter(s.no)"
        @pointerleave="leave(s.no)"
        @focus="enter(s.no)"
        @blur="leave(s.no)"
        @click.stop="pick(s)"
      >
        <EmblemMark
          :college="s.college"
          :size="s.size - 6"
          :tone="store.dialHover === s.no ? 'color' : 'gilt'"
        />
        <span v-if="pendingNo === s.no" class="stage-dial-pending" data-testid="stage-dial-pending">
          位置待确认
        </span>
      </button>

      <!-- 简称（正立） -->
      <span
        v-for="s in slots"
        :key="`n-${s.no}`"
        class="stage-dial-name"
        :class="{ 'is-off': !s.onPack, 'is-hover': store.dialHover === s.no }"
        :data-testid="`stage-dial-name-${s.no}`"
        :style="{ left: `${s.sx}px`, top: `${s.sy}px` }"
      >
        {{ s.short }}
        <em v-if="s.hint">{{ s.hint }}</em>
      </span>

      <!-- 盘心 -->
      <div class="stage-dial-core">
        <strong class="stage-dial-core-title">二十四院</strong>
        <span class="stage-dial-core-sub">石河子大学 · 六个校区</span>
        <em class="stage-dial-core-hint">点院徽，去它的楼</em>
        <button
          type="button"
          class="stage-dial-close"
          data-testid="stage-dial-close"
          @click="store.closeDial()"
        >收起</button>
      </div>
    </div>

    <!-- 指着院徽时的小牌：学院名 + 片区 · 楼名 -->
    <div
      v-if="hoverThread"
      class="stage-dial-plate"
      data-testid="stage-dial-plate"
      :style="{ left: `${hoverThread.ex + 14}px`, top: `${hoverThread.ey}px` }"
    >
      <strong>{{ hoverThread.label }}</strong>
      <span>{{ hoverThread.meta }}</span>
    </div>
  </div>
</template>
