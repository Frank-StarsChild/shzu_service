<script lang="ts">
// PLAN 4.3：调试钩子类型。所有自动验证都靠 window.__campus3d，必须始终存在。
// 声明用 declare global 正常写（PLAN 规则 7）。
export interface Campus3dHook {
  mode: "static" | "scene";
  reason: string;
  status: "static" | "loading" | "ready" | "error";
  hotspotCount: number;
  buildingCount: number;
  activeBoard: string | null;
  hoveredBoard: string | null;
  stop: string;
  moving: boolean;
  frames: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  highlightMaterials: number;
  camera: { position: number[]; target: number[]; fov: number };
  projectPoint: (point: [number, number, number]) => { x: number; y: number; visible: boolean };
}

declare global {
  interface Window {
    __campus3d: Campus3dHook;
  }
}
</script>

<script setup lang="ts">
// PLAN S3 静态版：海报 + 5 个编号标记 + 说明文字。
// 不引入 three（S5 起才加载）；meta 请求或校验失败时只显示海报，不抛未捕获异常。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { parseMeta, type CampusMeta, type Hotspot } from "@/campus3d/meta";

const props = defineProps<{ activeBoard: string | null }>();
const emit = defineEmits<{
  (e: "marker-enter", board: string): void;
  (e: "marker-leave"): void;
}>();

const router = useRouter();
const meta = ref<CampusMeta | null>(null);
const mobile = ref(false);
let mq: MediaQueryList | null = null;

const hotspots = computed<Hotspot[]>(() => meta.value?.hotspots ?? []);
const attribution = computed(() => meta.value?.attribution ?? "");
const altText = computed(() =>
  meta.value
    ? "石河子大学中区校园沙盘（示意）：" +
      meta.value.hotspots.map((h) => h.label).join("、") +
      ` 等 ${Object.keys(meta.value.buildings).length} 栋建筑`
    : "石河子大学中区校园沙盘（示意）"
);

/** 标记用哪张海报的坐标：视口 ≤720px 用手机海报（与 <source> 切换一致）。 */
function coordsOf(h: Hotspot): [number, number] {
  return mobile.value ? h.posterMobile : h.posterDesktop;
}

function markerStyle(h: Hotspot) {
  const [x, y] = coordsOf(h);
  return { left: `${(x * 100).toFixed(4)}%`, top: `${(y * 100).toFixed(4)}%` };
}

function touchHook(patch: Partial<Campus3dHook>) {
  Object.assign(window.__campus3d, patch);
}

function onMediaChange(e: MediaQueryListEvent) {
  mobile.value = e.matches;
}

onMounted(async () => {
  // 钩子先建好，字段全部有值（PLAN S3：其余字段给 0、null 或空值）
  window.__campus3d = {
    mode: "static",
    reason: "not-ready",
    status: "static",
    hotspotCount: 0,
    buildingCount: 0,
    activeBoard: null,
    hoveredBoard: null,
    stop: "overview",
    moving: false,
    frames: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    highlightMaterials: 0,
    camera: { position: [0, 0, 0], target: [0, 0, 0], fov: 30 },
    projectPoint: () => ({ x: 0, y: 0, visible: false }),
  };
  mq = window.matchMedia("(max-width: 720px)");
  mobile.value = mq.matches;
  mq.addEventListener("change", onMediaChange);
  try {
    const resp = await fetch("/campus3d/campus.meta.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    meta.value = parseMeta(await resp.json());
    touchHook({
      hotspotCount: meta.value.hotspots.length,
      camera: { position: [0, 0, 0], target: [0, 0, 0], fov: meta.value.camera.fov },
    });
  } catch {
    // 请求或校验失败：不显示标记，海报照常显示（PLAN S3 第 3 条）
    meta.value = null;
  }
});

onBeforeUnmount(() => {
  mq?.removeEventListener("change", onMediaChange);
});

// 联动高亮写入调试钩子
watch(
  () => props.activeBoard,
  (b) => touchHook({ activeBoard: b })
);

/** 点击标记 = 点击对应板块按钮（PLAN S3 第 4 条）。 */
function goBoard(board: string) {
  router.push({ path: "/services", query: { board } });
}
</script>

<template>
  <figure class="campus-hero">
    <div class="campus-frame" data-testid="campus-hero">
      <picture>
        <source media="(max-width: 720px)" srcset="/campus3d/poster-mobile.jpg" />
        <img data-testid="campus-poster" src="/campus3d/poster-desktop.jpg"
             width="1920" height="800" :alt="altText" />
      </picture>
      <div v-if="hotspots.length" class="campus-overlay" data-testid="campus-overlay">
        <button
          v-for="h in hotspots"
          :key="h.no"
          :data-testid="`campus-marker-${h.no}`"
          type="button"
          class="campus-marker"
          :class="{ 'is-active': activeBoard === h.board }"
          :style="markerStyle(h)"
          :aria-label="`${h.no} ${h.board}：${h.label}`"
          @mouseenter="emit('marker-enter', h.board)"
          @mouseleave="emit('marker-leave')"
          @focus="emit('marker-enter', h.board)"
          @blur="emit('marker-leave')"
          @click="goBoard(h.board)"
        >
          <span class="no">{{ h.no }}</span>
          <span class="marker-card">
            <strong>{{ h.label }}</strong>
            <em v-if="h.note">{{ h.note }}</em>
          </span>
        </button>
      </div>
    </div>
    <slot />
    <figcaption class="campus-caption tiny" data-testid="campus-caption">
      <span>{{ attribution }}</span>
    </figcaption>
  </figure>
</template>
