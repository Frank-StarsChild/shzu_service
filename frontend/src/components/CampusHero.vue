<script lang="ts">
// PLAN 4.3 + NIGHT 各卡：调试钩子类型。所有自动验证都靠 window.__campus3d，必须始终存在。
export interface Campus3dHook {
  mode: "static" | "scene";
  reason: string;
  status: "static" | "loading" | "intro" | "ready" | "error";
  hotspotCount: number;
  buildingCount: number;
  activeBoard: string | null;
  hoveredBoard: string | null;
  /** 对话定位：当前被聚焦的建筑 ID（无聚焦为 null） */
  focusedBuilding: string | null;
  stop: string;
  moving: boolean;
  frames: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  highlightMaterials: number;
  // N1：夜景资产与高亮件
  assetVersion: string;
  hotNodes: number;
  hotVisible: string | null;
  hotRise: number;
  // N3：动效循环
  looping: boolean;
  fxOffset: number;
  // N4：开场动画
  intro: "none" | "playing" | "done" | "skipped";
  introReason: string;
  nodeScaleY: (name: string) => number | null;
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
// PLAN S3 静态版 + S4 能力判定 + S5 三维加载 + NIGHT N1–N5：
// 海报 + 五编号标记 + 四角信息条 + 比例尺 + 说明 + 3D 开关 + 加载条 + 失败重试。
// scene.ts 通过动态 import() 懒加载；three 对象不进 Vue 响应式（sceneHandle 存普通变量）。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { parseMeta, type CampusMeta, type Hotspot } from "@/campus3d/meta";
import {
  decideIntro,
  decideMode,
  readGateInput,
  readIntroQuery,
  type GateInput,
  type GateResult,
} from "@/campus3d/gate";
import type { CampusSceneHandle } from "@/campus3d/scene"; // 仅类型，构建时擦除

const props = defineProps<{
  activeBoard: string | null;
  activeSource: "tile" | "marker" | "canvas" | null;
  /** N2：各板块的服务数量（HomeView 从 /api/v1/services 统计，失败时为空对象） */
  serviceCounts?: Record<string, number>;
}>();
const emit = defineEmits<{
  (e: "marker-enter", board: string): void;
  (e: "marker-leave"): void;
  (e: "canvas-enter", board: string): void;
  (e: "canvas-leave"): void;
}>();

const router = useRouter();
const route = useRoute();
const meta = ref<CampusMeta | null>(null);
const mobile = ref(false);
let mq: MediaQueryList | null = null;

// ---- 「进入 3D 校园」：从普通版回舞台（原顶栏「校园」入口，保留设备判断与偏好清除） ----
// 只在设备能跑 3D 且视口不小于 1100 时显示；点击删掉 shzu.stage（舞台「普通版」记下的选择），
// 去 /?stage=1 回舞台；当前页带着 ?3d=1（软件渲染环境里唯一能强制 scene 的开关）时一并带上。
const canEnterStage = computed(
  () => gate.value.mode === "scene" && window.innerWidth >= 1100
);
const campusTo = computed(() => (lastInput?.query3d === "1" ? "/?stage=1&3d=1" : "/?stage=1"));

function enterStage() {
  localStorage.removeItem("shzu.stage");
  router.push(campusTo.value);
}

// ---- 对话定位（?focus=buildingId）：聊天页「在沙盘查看」按钮跳转而来 ----
const focusId = computed<string | null>(() => {
  const f = route.query.focus;
  return typeof f === "string" && f.trim() ? f.trim() : null;
});
const focusInfo = computed(() => {
  if (!focusId.value || !meta.value) return null;
  const b = meta.value.buildings[focusId.value];
  return b && b.name ? { name: b.name, category: b.category ?? "" } : null;
});

// ---- S4 能力判定 ----
const LS_KEY = "shzu.campus3d";
const INTRO_KEY = "shzu.campus3d.intro";
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
    touchHook({ mode: "static", reason: "user-off", intro: "skipped" });
  } else {
    localStorage.removeItem(LS_KEY);
    userOff.value = false;
    // 按地址栏 ?3d=1 重新判定（PLAN S4 第 3 条）
    const r = decideMode({ ...(lastInput as GateInput), query3d: "1", storedPref: null });
    gate.value = r;
    touchHook({ mode: r.mode, reason: r.reason });
  }
}

// ---- S5 三维场景（状态机：static → loading → intro/ready → error） ----
const sceneStatus = ref<"static" | "loading" | "intro" | "ready" | "error">("static");
const progress = ref(0);
const canvasMounted = ref(false);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let sceneHandle: CampusSceneHandle | null = null; // three 对象不进响应式
let canvasEl: HTMLCanvasElement | null = null;

/** N4：开场判定结果（hasClip 由资产契约保证；实际片段在 scene 里查找） */
let introDecision: { play: boolean; reason: string } = { play: false, reason: "not-ready" };
let introFinishedEarly = false;

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

  // N4：模型加载完、创建场景之前判定要不要播开场
  introDecision = decideIntro({
    queryIntro: readIntroQuery(),
    played: sessionStorage.getItem(INTRO_KEY) === "1",
    reducedMotion: lastInput?.reducedMotion === true,
    hasClip: true,
  });
  introFinishedEarly = false;
  touchHook({ introReason: introDecision.reason, intro: "none" });

  canvasMounted.value = true;
  await nextTick();
  canvasEl = canvasRef.value;
  if (!canvasEl) {
    sceneStatus.value = "error";
    touchHook({ status: "error", intro: "skipped" });
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
      playIntro: introDecision.play,
      onProgress: (p) => {
        progress.value = p;
      },
      onIntroDone: () => finalizeIntro(),
    });
    if (!canvasEl) {
      handle.dispose();
      return;
    }
    sceneHandle = handle;
    if (introDecision.play && !introFinishedEarly) {
      sceneStatus.value = "intro";
      touchHook({ status: "intro", intro: "playing" });
      handle.startIntro();
    } else {
      sceneStatus.value = "ready";
      touchHook({
        status: "ready",
        intro: introFinishedEarly ? "done" : "skipped",
      });
    }
    // S7：画布悬停/点击（悬停→上层 activeBoard 以 canvas 来源联动，只高亮不动镜头）
    handle.onHover((board) => {
      if (board) emit("canvas-enter", board);
      else emit("canvas-leave");
    });
    handle.onPick((board) => goBoard(board));
    handle.setHighlight(props.activeBoard);
    handle.onFrame(() => {
      updateMarkerPos();
      updateScale();
    });
    updateMarkerPos();
    updateScale();
    if (props.activeBoard && props.activeSource === "tile") {
      const h = meta.value?.hotspots.find((x) => x.board === props.activeBoard);
      if (h) handle.goTo(h.stop, { immediate: false });
    }
  } catch {
    if (!canvasEl || (sceneStatus.value !== "loading" && sceneStatus.value !== "intro")) return;
    sceneHandle = null;
    sceneStatus.value = "error";
    touchHook({ status: "error", intro: "skipped" });
    removeCanvas();
  }
}

/** N4：开场结束（片段播完 + 镜头到位）→ ready，并记住本标签页已播过。 */
function finalizeIntro() {
  introFinishedEarly = true;
  if (sceneStatus.value === "loading") return; // 等 create 完成后再写 ready
  if (sceneStatus.value !== "intro") return;
  sceneStatus.value = "ready";
  sessionStorage.setItem(INTRO_KEY, "1");
  touchHook({ status: "ready", intro: "done" });
  updateScale();
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
  touchHook({ status: "error", intro: "skipped" });
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

// 对话定位：场景就绪 + ?focus=buildingId → 聚焦镜头并高亮（只处理已登记楼）
watch(
  [focusId, sceneStatus, () => meta.value] as const,
  () => {
    if ((sceneStatus.value !== "ready" && sceneStatus.value !== "intro") || !sceneHandle || !focusId.value) return;
    if (meta.value && focusId.value in meta.value.buildings) {
      sceneHandle.focusBuilding(focusId.value);
      touchHook({ focusedBuilding: focusId.value });
    }
  },
  { immediate: true }
);

// ---- S6 镜头联动：仅来源是板块按钮（tile）时镜头才移动 ----
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

// ---- 3D 就绪后 5 个标记的位置与比例尺 ----
const markerPos = ref<Record<string, { x: number; y: number; visible: boolean }>>({});
const currentStop = ref("overview");
const scalePx = ref(0);
const frameW = ref(0);
let frameObs: ResizeObserver | null = null;

function sceneLive(): boolean {
  return sceneStatus.value === "ready" || sceneStatus.value === "intro";
}

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
  currentStop.value = window.__campus3d?.stop ?? "overview";
}

/** N2：3D 版比例尺 = 当前停靠点一对 100 米点投影后的像素距离；静态版 = 画框宽 × 比例。 */
function updateScale() {
  const m = meta.value;
  if (!m) return;
  const frameEl = canvasEl?.parentElement ?? document.querySelector<HTMLElement>('[data-testid="campus-hero"]');
  if (frameEl) frameW.value = frameEl.getBoundingClientRect().width;
  if (sceneLive() && sceneHandle && m.look.hud.scale100[currentStop.value]) {
    const [a, b] = m.look.hud.scale100[currentStop.value];
    const p0 = sceneHandle.project(a);
    const p1 = sceneHandle.project(b);
    scalePx.value = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  } else {
    scalePx.value = frameW.value * (mobile.value ? m.look.hud.scalePoster.mobile : m.look.hud.scalePoster.desktop);
  }
}

// ---- 静态版：海报坐标与标记 ----
const hotspots = computed<Hotspot[]>(() => meta.value?.hotspots ?? []);
const attribution = computed(() => meta.value?.attribution ?? "");
const look = computed(() => meta.value?.look ?? null);
const altText = computed(() =>
  meta.value
    ? "石河子大学中区校园沙盘（示意）：" +
      meta.value.hotspots.map((h) => h.label).join("、") +
      ` 等 ${Object.keys(meta.value.buildings).length} 栋建筑`
    : "石河子大学中区校园沙盘（示意）"
);

const titleParts = computed<[string, string]>(() => {
  const t = look.value?.hud.title ?? "";
  const i = t.indexOf("/");
  if (i < 0) return [t, ""];
  return [t.slice(0, i), t.slice(i)];
});
const buildingCount = computed(() => (meta.value ? Object.keys(meta.value.buildings).length : 0));

const readout = computed(() => {
  const board = props.activeBoard;
  const h = board ? meta.value?.hotspots.find((x) => x.board === board) : undefined;
  if (!h) return "移到板块上查看位置";
  const n = props.serviceCounts?.[h.board];
  const suffix = typeof n === "number" && n > 0 ? ` · ${n} 项服务` : "";
  return `■ ${h.no} ${h.label}${h.note ? ` · ${h.note}` : ""}${suffix}`;
});

/** 标记用哪张海报的坐标：视口 ≤720px 用手机海报（与 <source> 切换一致）。 */
function coordsOf(h: Hotspot): [number, number] {
  return mobile.value ? h.posterMobile : h.posterDesktop;
}

/** 标记定位：3D 就绪（含开场）且已有投影数据时用投影，否则用海报坐标。 */
function markerStyle(h: Hotspot): Record<string, string> {
  const dyn = sceneLive() ? markerPos.value[h.no] : undefined;
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
  updateScale();
}

function onResize() {
  updateScale();
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
    focusedBuilding: null,
    stop: "overview",
    moving: false,
    frames: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    highlightMaterials: 0,
    assetVersion: "",
    hotNodes: 0,
    hotVisible: null,
    hotRise: 0,
    looping: false,
    fxOffset: 0,
    intro: "none",
    introReason: "not-ready",
    nodeScaleY: () => null,
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
  window.addEventListener("resize", onResize);
  try {
    const resp = await fetch("/campus3d/campus.meta.json");
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    meta.value = parseMeta(await resp.json());
    touchHook({
      hotspotCount: meta.value.hotspots.length,
      assetVersion: meta.value.version,
      camera: { position: [0, 0, 0], target: [0, 0, 0], fov: meta.value.camera.fov },
    });
    await nextTick();
    updateScale();
    const frameEl = document.querySelector<HTMLElement>('[data-testid="campus-hero"]');
    if (frameEl && typeof ResizeObserver !== "undefined") {
      frameObs = new ResizeObserver(() => updateScale());
      frameObs.observe(frameEl);
    }
  } catch {
    // 请求或校验失败：不显示标记，海报照常显示（PLAN S3 第 3 条）
    meta.value = null;
  }
});

onBeforeUnmount(() => {
  mq?.removeEventListener("change", onMediaChange);
  window.removeEventListener("resize", onResize);
  frameObs?.disconnect();
  if (returnTimer !== null) window.clearTimeout(returnTimer);
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
    <div class="campus-frame" data-testid="campus-hero" :style="look ? {
      background: look.colors.panel,
      '--hud': look.colors.hud,
      '--hud-dim': look.colors.hudDim,
      '--accent': look.colors.accent,
      '--marker-bg': look.colors.markerBg,
      '--marker-border': look.colors.markerBorder,
    } : undefined">
      <picture>
        <source media="(max-width: 720px)" srcset="/campus3d/poster-mobile.jpg" />
        <img data-testid="campus-poster" src="/campus3d/poster-desktop.jpg"
             width="1920" height="800" :alt="altText" />
      </picture>
      <canvas v-if="canvasMounted" ref="canvasRef" data-testid="campus-canvas"
              class="campus-canvas" :class="{ 'is-ready': sceneLive() }"></canvas>

      <!-- N2：装饰层（暗角 / 扫描线 / 四角角标），全部 pointer-events: none -->
      <div class="campus-fx" aria-hidden="true">
        <div class="campus-vignette"></div>
        <div class="campus-scanlines"></div>
        <i class="campus-corner tl"></i>
        <i class="campus-corner tr"></i>
        <i class="campus-corner bl"></i>
        <i class="campus-corner br"></i>
      </div>

      <!-- N2：四角等信息条 -->
      <div v-if="look" class="campus-hud" data-testid="campus-hud" :style="{
        '--hud': look.colors.hud,
        '--hud-dim': look.colors.hudDim,
        '--accent': look.colors.accent,
      }">
        <div class="campus-hud-box hud-tl" data-testid="campus-hud-title">
          <span class="hud-line"><strong>{{ titleParts[0] }}</strong>{{ titleParts[1] }}</span>
          <span class="hud-line hud-dim">{{ look.hud.subtitle }}</span>
        </div>
        <div class="campus-hud-box hud-tr" data-testid="campus-hud-coord">
          <span class="hud-line">{{ look.hud.coord }}</span>
          <span class="hud-line hud-dim">{{ buildingCount }} BUILDINGS · {{ hotspots.length }} BOARDS</span>
        </div>
        <div class="campus-hud-box hud-bl">
          <div class="campus-scale-bar">
            <div class="campus-scale-line" data-testid="campus-scale" :style="{ width: scalePx + 'px' }"></div>
            <span class="hud-line hud-dim" data-testid="campus-scale-label">{{ look.hud.scaleLabel }}</span>
          </div>
        </div>
        <div class="campus-hud-box hud-br" data-testid="campus-hud-readout">
          <span class="hud-line">{{ readout }}</span>
        </div>
      </div>

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
          <span class="marker-label" :data-testid="`campus-marker-label-${h.no}`">
            <template v-if="activeBoard === h.board">
              <strong>{{ h.label }}</strong>
              <em v-if="h.note">{{ h.note }}</em>
            </template>
            <template v-else>{{ h.board }}</template>
          </span>
        </button>
      </div>

      <div v-if="sceneStatus === 'loading'" class="campus-progress"
           data-testid="campus-progress" :style="{ width: `${Math.round(progress * 100)}%` }"></div>
      <div v-if="sceneStatus === 'error'" class="campus-error-box">
        <span class="tiny" data-testid="campus-error">3D 加载失败，已显示静态图</span>
        <button type="button" class="btn-sm" data-testid="campus-retry" @click="retryScene">重试</button>
      </div>
      <!-- 对话定位结果：无论 3D 是否可用都显示楼名；3D 就绪时镜头与高亮由场景控制 -->
      <div v-if="focusInfo" class="campus-focus-chip" data-testid="campus-focus-chip">
        <span class="mono tiny">已定位</span>
        <strong class="small">{{ focusInfo.name }}</strong>
        <span class="tiny muted" v-if="!sceneLive()">当前显示静态图；开启 3D 沙盘后可查看建筑位置</span>
      </div>
      <div v-else-if="focusId" class="campus-focus-chip" data-testid="campus-focus-unknown">
        <span class="tiny">该建筑未在沙盘登记（沙盘覆盖中区校园；可按官方通知确认地点）</span>
      </div>
    </div>
    <div class="campus-sr" aria-live="polite" data-testid="campus-live">{{ liveText }}</div>
    <slot />
    <figcaption class="campus-caption tiny" data-testid="campus-caption">
      <!-- 场景仍为夜景（团队后续提供日景 GLB 与双端海报再接真正的昼夜切换） -->
      <span class="caption-line">
        <span class="tag tag-soft" data-testid="campus-scene-mode">场景 · 夜景</span>
        <span>{{ attribution }}</span>
      </span>
      <span class="caption-actions">
        <!-- 普通版回舞台：设备够格才显示（原顶栏「校园」入口，放沙盘说明区） -->
        <button
          v-if="canEnterStage"
          type="button"
          class="btn-sm"
          data-testid="campus-enter-stage"
          title="进入 3D 校园（全屏沙盘）"
          @click="enterStage"
        >进入 3D 校园 →</button>
        <button
          v-if="toggleLabel"
          type="button"
          class="btn-sm"
          data-testid="campus-toggle"
          @click="onToggle"
        >{{ toggleLabel }}</button>
      </span>
    </figcaption>
  </figure>
</template>

<style scoped>
/* 说明行左侧：夜景标签与署名并排；右侧动作（进入 3D 校园 / 3D 开关）收在一组 */
.caption-line {
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-3);
  min-width: 0;
}
.caption-actions {
  display: inline-flex;
  align-items: baseline;
  gap: var(--gap-2);
  flex: none;
}

/* 对话定位提示（聊天页「在沙盘查看」跳转而来）：静态图与 3D 模式都显示 */
.campus-focus-chip {
  position: absolute;
  top: 10px;
  left: 10px;
  z-index: 9;
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 12px;
  background: var(--bg-panel);
  border: 1px solid var(--vermilion);
  border-left: 3px solid var(--vermilion);
  max-width: min(86%, 520px);
}
</style>