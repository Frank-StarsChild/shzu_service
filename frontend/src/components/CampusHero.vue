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
// PLAN S3 静态版 + S4 能力判定 + S5 三维加载：
// 海报 + 5 编号标记 + 说明文字 + 3D 开关 + 加载条 + 失败重试。
// scene.ts 通过动态 import() 懒加载（文件顶部不许静态 import 它）；
// three 对象不进 Vue 响应式（sceneHandle 存普通变量）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { parseMeta, type CampusMeta, type Hotspot } from "@/campus3d/meta";
import { decideMode, readGateInput, type GateInput, type GateResult } from "@/campus3d/gate";
import type { CampusSceneHandle } from "@/campus3d/scene"; // 仅类型，构建时擦除

const props = defineProps<{ activeBoard: string | null; activeSource: "tile" | "marker" | "canvas" | null }>();
const emit = defineEmits<{
  (e: "marker-enter", board: string): void;
  (e: "marker-leave"): void;
  (e: "canvas-enter", board: string): void;
  (e: "canvas-leave"): void;
}>();

const router = useRouter();
const meta = ref<CampusMeta | null>(null);
const mobile = ref(false);
let mq: MediaQueryList | null = null;

// ---- S4 能力判定 ----
const LS_KEY = "shzu.campus3d";
const gate = ref<GateResult>({ mode: "static", reason: "not-ready", canEnable: false });
/** 本次访问内用户点了「仅看静态图」（即使地址栏带 ?3d=1 也立即静态） */
const userOff = ref(false);
let lastInput: GateInput | null = null;

const effectiveMode = computed<GateResult>(() =>
  userOff.value ? { mode: "static", reason: "user-off", canEnable: true } : gate.value
);

/** 开关文案：scene→「仅看静态图」；static 且可开启→「开启 3D 沙盘」；其余不显示 */
const toggleLabel = computed<string | null>(() => {
  const m = effectiveMode.value;
  if (m.mode === "scene") return "仅看静态图";
  if (m.canEnable) return "开启 3D 沙盘";
  return null;
});

function onToggle() {
  if (effectiveMode.value.mode === "scene") {
    localStorage.setItem(LS_KEY, "off");
    userOff.value = true;
    teardownScene("static");
    touchHook({ mode: "static", reason: "user-off" });
  } else {
    localStorage.removeItem(LS_KEY);
    userOff.value = false;
    // 按地址栏 ?3d=1 重新判定（PLAN S4 第 3 条）
    const r = decideMode({ ...(lastInput as GateInput), query3d: "1", storedPref: null });
    gate.value = r;
    touchHook({ mode: r.mode, reason: r.reason });
  }
}

// ---- S5 三维场景（状态机：static → loading → ready / error） ----
const sceneStatus = ref<"static" | "loading" | "ready" | "error">("static");
const progress = ref(0);
const canvasMounted = ref(false);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let sceneHandle: CampusSceneHandle | null = null; // three 对象不进响应式
let canvasEl: HTMLCanvasElement | null = null;

/** 场景是否应该初始化：scene 模式 + meta 就绪 + 当前是静态可加载状态 */
const wantScene = computed(
  () => effectiveMode.value.mode === "scene" && !!meta.value && sceneStatus.value === "static"
);

async function initScene() {
  if (!wantScene.value) return;
  const m = meta.value;
  if (!m) return;
  sceneStatus.value = "loading";
  progress.value = 0;
  touchHook({ status: "loading" });
  canvasMounted.value = true;
  await nextTick();
  canvasEl = canvasRef.value;
  if (!canvasEl) {
    sceneStatus.value = "error";
    touchHook({ status: "error" });
    canvasMounted.value = false;
    return;
  }
  canvasEl.addEventListener("webglcontextlost", onContextLost);
  try {
    const { createCampusScene } = await import("@/campus3d/scene");
    if (!canvasEl) return; // 等待期间已被卸载
    const handle = await createCampusScene(canvasEl, m, {
      glbUrl: `/campus3d/campus.glb?v=${m.version}`,
      reducedMotion: lastInput?.reducedMotion === true,
      onProgress: (p) => {
        progress.value = p;
      },
    });
    if (!canvasEl) {
      // 等待期间已被卸载：立即释放
      handle.dispose();
      return;
    }
    sceneHandle = handle;
    sceneStatus.value = "ready";
    touchHook({ status: "ready" });
    // S7：画布悬停/点击（悬停→上层 activeBoard 以 canvas 来源联动，只高亮不动镜头）
    handle.onHover((board) => {
      if (board) emit("canvas-enter", board);
      else emit("canvas-leave");
    });
    handle.onPick((board) => goBoard(board));
    handle.setHighlight(props.activeBoard); // 若此刻已有联动高亮（tile/marker 来源）
    // S6：标记位置改为跟随场景投影（只在有渲染帧时更新；静止后停在原位）
    handle.onFrame(updateMarkerPos);
    updateMarkerPos();
    // S6：若此刻已有板块被悬停，立即移动镜头到位
    if (props.activeBoard && props.activeSource === "tile") {
      const h = meta.value?.hotspots.find((x) => x.board === props.activeBoard);
      if (h) handle.goTo(h.stop, { immediate: false });
    }
  } catch {
    if (!canvasEl || sceneStatus.value !== "loading") return; // 中途已切静态/已失败
    sceneHandle = null;
    sceneStatus.value = "error";
    touchHook({ status: "error" });
    removeCanvas();
  }
}

function removeCanvas() {
  canvasMounted.value = false;
  if (canvasEl) {
    canvasEl.removeEventListener("webglcontextlost", onContextLost);
    canvasEl = null;
  }
}

function teardownScene(nextStatus: "static" | "error") {
  sceneHandle?.dispose();
  sceneHandle = null;
  removeCanvas();
  sceneStatus.value = nextStatus;
  touchHook({ status: nextStatus });
}

function onContextLost(e: Event) {
  e.preventDefault();
  sceneHandle?.dispose();
  sceneHandle = null;
  removeCanvas();
  sceneStatus.value = "error";
  touchHook({ status: "error" });
}

function retryScene() {
  if (sceneStatus.value !== "error") return;
  sceneStatus.value = "static";
  touchHook({ status: "static" });
  void initScene();
}

watch(effectiveMode, (m) => {
  if (m.mode === "static") {
    if (sceneHandle || canvasMounted.value) teardownScene("static");
  } else if (wantScene.value) {
    void initScene();
  }
});
watch([() => meta.value, sceneStatus], () => {
  if (wantScene.value) void initScene();
});

// ---- S6 镜头联动：仅来源是板块按钮（tile）时镜头才移动；
// 来源是标记/画布时只高亮（标记和楼跟随镜头，镜头一动会从鼠标下移开，画面会抖）
let returnTimer: number | null = null;
watch(
  () => [props.activeBoard, props.activeSource] as const,
  ([board, source]) => {
    if (returnTimer !== null) {
      window.clearTimeout(returnTimer);
      returnTimer = null;
    }
    if (board && source === "tile") {
      const h = meta.value?.hotspots.find((x) => x.board === board);
      if (h) sceneHandle?.goTo(h.stop);
    } else if (!board && sceneHandle) {
      // 鼠标在按钮之间移动时不来回抽动：静止 600ms 才回全景
      returnTimer = window.setTimeout(() => {
        returnTimer = null;
        if (!props.activeBoard) sceneHandle?.goTo("overview");
      }, 600);
    }
  }
);

// 3D 就绪后 5 个标记的位置（场景坐标经 project 换算的归一化坐标）
const markerPos = ref<Record<string, { x: number; y: number; visible: boolean }>>({});

function updateMarkerPos() {
  const handle = sceneHandle;
  const m = meta.value;
  const frameEl = canvasEl?.parentElement;
  if (!handle || !m || !frameEl) return;
  const rect = frameEl.getBoundingClientRect();
  const next: Record<string, { x: number; y: number; visible: boolean }> = {};
  for (const h of m.hotspots) {
    const p = handle.project(h.anchor);
    next[h.no] = {
      x: (p.x - rect.left) / rect.width,
      y: (p.y - rect.top) / rect.height,
      visible: p.visible,
    };
  }
  markerPos.value = next;
}

// ---- 静态版：海报坐标与标记 ----
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

/** 标记定位：3D 就绪且已有投影数据时用投影，否则用海报坐标（静态版/加载中）。 */
function markerStyle(h: Hotspot): Record<string, string> {
  const dyn = sceneStatus.value === "ready" ? markerPos.value[h.no] : undefined;
  if (dyn) {
    const base: Record<string, string> = {
      left: `${(dyn.x * 100).toFixed(4)}%`,
      top: `${(dyn.y * 100).toFixed(4)}%`,
    };
    if (!dyn.visible) base.visibility = "hidden";
    return base;
  }
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

  // S4 判定一次，写进钩子
  lastInput = readGateInput();
  gate.value = decideMode(lastInput);
  touchHook({ mode: effectiveMode.value.mode, reason: effectiveMode.value.reason });

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
  if (returnTimer !== null) window.clearTimeout(returnTimer);
  // 释放 3D 场景（含 WebGL 上下文）
  if (sceneHandle || canvasMounted.value) {
    sceneHandle?.dispose();
    sceneHandle = null;
    removeCanvas();
  }
});

// 联动高亮写入调试钩子
watch(
  () => props.activeBoard,
  (b) => {
    touchHook({ activeBoard: b });
    sceneHandle?.setHighlight(b); // 任何来源的 activeBoard 变化都调 setHighlight（S7 第 4 条）
  }
);

// S7 无障碍：activeBoard 变化时写入 aria-live 区（楼名+板块，来自 meta，不写死）
const liveText = computed(() => {
  const b = props.activeBoard;
  if (!b) return "";
  const h = meta.value?.hotspots.find((x) => x.board === b);
  if (!h) return "";
  return `${h.label}（${h.note ?? ""}），对应板块：${h.board}`;
});

/** 点击标记/热点楼 = 点击对应板块按钮（PLAN S3/S7）。 */
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
      <canvas v-if="canvasMounted" ref="canvasRef" data-testid="campus-canvas"
              class="campus-canvas" :class="{ 'is-ready': sceneStatus === 'ready' }"></canvas>
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
      <div v-if="sceneStatus === 'loading'" class="campus-progress"
           data-testid="campus-progress" :style="{ width: `${Math.round(progress * 100)}%` }"></div>
      <div v-if="sceneStatus === 'error'" class="campus-error-box">
        <span class="tiny" data-testid="campus-error">3D 加载失败，已显示静态图</span>
        <button type="button" class="btn-sm" data-testid="campus-retry" @click="retryScene">重试</button>
      </div>
    </div>
    <div class="campus-sr" aria-live="polite" data-testid="campus-live">{{ liveText }}</div>
    <slot />
    <figcaption class="campus-caption tiny" data-testid="campus-caption">
      <span>{{ attribution }}</span>
      <button
        v-if="toggleLabel"
        type="button"
        class="btn-sm"
        data-testid="campus-toggle"
        @click="onToggle"
      >{{ toggleLabel }}</button>
    </figcaption>
  </figure>
</template>
