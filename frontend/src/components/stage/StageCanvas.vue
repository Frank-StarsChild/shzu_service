<script setup lang="ts">
// STAGE W1：整屏画布（海报 + 3D canvas），照 CampusHero 的做法再写一遍（不改它）。
// 与首页画框版的差异：fixed inset:0 占满视口、用 packs.json 的包、homeStop='home'、
// 顶边 2px 朱红进度线、海报 400ms 淡出、宽高比超过 posterAspect 时宽度取高度×posterAspect。
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import { parseMeta, type CampusMeta } from "@/campus3d/meta";
import {
  decideMode, decideIntro, readGateInput, readIntroQuery,
  type GateInput, type GateResult,
} from "@/campus3d/gate";
import { loadPackIndex, loadPackMeta, packUrl, type PackIndex } from "@/stage/packs";
import { useStageStore } from "@/stores/stage";
import { useChatStore } from "@/stores/chat";
import type { StageCtx } from "@/stage/types";
import type { CampusSceneHandle } from "@/campus3d/scene"; // 仅类型，构建时擦除

// window.__campus3d 的全局类型声明在 CampusHero.vue（同一份，v3 字段经宽松记录写入）。

const store = useStageStore();
const chat = useChatStore();

const meta = ref<CampusMeta | null>(null);
const posterSrc = ref("");
const packIndex = ref<PackIndex | null>(null);
const INTRO_KEY = "shzu.campus3d.intro";

// ---- 能力判定（规则与 CampusHero 相同；舞台不提供切换静态钮，普通版在 /classic）----
const gate = ref<GateResult>({ mode: "static", reason: "not-ready", canEnable: false });
let lastInput: GateInput | null = null;

// ---- 场景状态机：static → loading → intro/ready → error ----
const sceneStatus = ref<"static" | "loading" | "intro" | "ready" | "error">("static");
const progress = ref(0);
const canvasMounted = ref(false);
const canvasRef = ref<HTMLCanvasElement | null>(null);
let sceneHandle: CampusSceneHandle | null = null; // three 对象不进响应式
let canvasEl: HTMLCanvasElement | null = null;
let posterEl: HTMLImageElement | null = null;

// ---- W11：构图偏移。无回答或已收起 = 基线 48px；回答面板展开 = 再按面板宽度
// 加 70–110px（面板宽度 clamp(320px, 28vw, 428px) 的 22%）。窗口变化时按实时
// 视口重算，避免累计偏移；只改投影不动机位；普通版 CampusHero 不经此处恒为零。----
const FRAMING_BASE_PX = 48;
const viewportW = ref(typeof window !== "undefined" ? window.innerWidth : 0);
function onWindowResize() {
  viewportW.value = window.innerWidth;
}
const panelW = computed(() =>
  Math.min(Math.max(320, Math.round(viewportW.value * 0.28)), 428)
);
const hasAssistant = computed(() => chat.turns.some((t) => t.role === "assistant"));
const panelOpen = computed(() => hasAssistant.value && store.answerOpen);
const framingOffset = computed(() => {
  if (gate.value.mode !== "scene") return 0;
  if (!panelOpen.value) return FRAMING_BASE_PX;
  const extra = Math.min(Math.max(Math.round(panelW.value * 0.22), 70), 110);
  return FRAMING_BASE_PX + extra;
});
function applyFraming() {
  sceneHandle?.setFraming(framingOffset.value);
}
watch(framingOffset, () => applyFraming());
let introDecision: { play: boolean; reason: string } = { play: false, reason: "not-ready" };
let introFinishedEarly = false;
/** W3：换包时预置「必播开场」（卡第 3 条：playIntro 传 !reducedMotion），
 *  由下一次 initScene 消费；不然 decideIntro 的 sessionStorage 会把新包开场吞掉。 */
let pendingIntro: { play: boolean; reason: string } | null = null;

// ---- W2：向 slot 里的界面层暴露场景访问（provide/inject；不传 three 对象进响应式）----
const frameListeners = new Set<() => void>();
provide<StageCtx>("stageCtx", {
  meta,
  sceneStatus,
  gate,
  registerFrame(cb) {
    frameListeners.add(cb);
    return () => frameListeners.delete(cb);
  },
  getHandle: () => sceneHandle,
});

const wantScene = computed(
  () => gate.value.mode === "scene" && !!meta.value && !!packIndex.value
    && sceneStatus.value === "static"
);

async function initScene() {
  if (!wantScene.value || !meta.value || !packIndex.value) return;
  const m = meta.value;
  const pack = packIndex.value.packs.find((p) => p.id === (store.packId || packIndex.value!.default));
  if (!pack) return;
  sceneStatus.value = "loading";
  progress.value = 0;
  touchHook({ status: "loading" });

  introDecision = pendingIntro ?? decideIntro({
    queryIntro: readIntroQuery(),
    played: sessionStorage.getItem(INTRO_KEY) === "1",
    reducedMotion: lastInput?.reducedMotion === true,
    hasClip: true,
  });
  pendingIntro = null;
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
    if (!canvasEl) return;
    const handle = await createCampusScene(canvasEl, m, {
      glbUrl: packUrl(pack.glb) + `?v=${m.version}`,
      reducedMotion: lastInput?.reducedMotion === true,
      playIntro: introDecision.play,
      homeStop: "home",
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
    applyFraming(); // W11：创建后立刻按当前面板状态应用构图偏移
    handle.onFrame(() => {
      // 停靠点写回 store（比例尺/罗盘等界面读响应式状态，而不是窗口上的调试钩子）
      const stop = (window as unknown as { __campus3d?: { stop?: string } }).__campus3d?.stop;
      if (typeof stop === "string") store.setSceneStop(stop);
      for (const cb of frameListeners) cb();
    });
    if (introDecision.play && !introFinishedEarly) {
      sceneStatus.value = "intro";
      touchHook({ status: "intro", intro: "playing" });
      handle.startIntro();
      fadeInCanvas();
    } else {
      sceneStatus.value = "ready";
      touchHook({
        status: "ready",
        intro: introFinishedEarly ? "done" : "skipped",
      });
      fadeOutPoster();
      // W3：加载期间点过校区的话，就绪后补上镜头与片区
      // W8：就绪后允许拖动旋转；加载期间点过观景的话补上
      if (gate.value.mode === "scene") handle.setOrbit(true);
      if (store.mode === "tour") {
        handle.setTour(true);
      } else if (store.mode !== "home") {
        applyStageMode();
      }
    }
  } catch {
    if (!canvasEl || (sceneStatus.value !== "loading" && sceneStatus.value !== "intro")) return;
    sceneHandle = null;
    sceneStatus.value = "error";
    touchHook({ status: "error", intro: "skipped" });
    removeCanvas();
    showPoster();
  }
}

/** N4 同款：开场结束（片段播完 + 镜头到位）→ ready，并记住本标签页已播过。 */
function finalizeIntro() {
  introFinishedEarly = true;
  if (sceneStatus.value === "loading") return;
  if (sceneStatus.value !== "intro") return;
  sceneStatus.value = "ready";
  sessionStorage.setItem(INTRO_KEY, "1");
  touchHook({ status: "ready", intro: "done" });
  fadeOutPoster();
  // W3：开场期间点过校区的话，就绪后补上镜头与片区
  // W8：开场结束同样允许拖动旋转；开场期间点过观景的话补上
  if (gate.value.mode === "scene") sceneHandle?.setOrbit(true);
  if (store.mode === "tour") {
    sceneHandle?.setTour(true);
  } else if (store.mode !== "home") {
    applyStageMode();
  }
}

function fadeInCanvas() {
  // 开场动画期间画布已可见（海报在下层）；淡出海报让 3D 自然接管
  fadeOutPoster();
}

function fadeOutPoster() {
  if (!posterEl) return;
  posterEl.style.transition = "opacity 400ms";
  posterEl.style.opacity = "0";
}

function showPoster() {
  if (!posterEl) return;
  posterEl.style.transition = "";
  posterEl.style.opacity = "1";
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
  touchHook({ status: nextStatus, intro: "skipped", zone: null });
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
  showPoster();
  void initScene();
}

watch(wantScene, (w) => { if (w) void initScene(); });
watch([() => meta.value, sceneStatus], () => { if (wantScene.value) void initScene(); });

// ---- W3：舞台状态驱动换包（store.packId 变化）。旧场景必须先释放（STAGE 12.1：不释放显存翻倍）
// 先记在前面：packId 的 watch 要先于 mode 的 watch 注册，换包那一下 mode 也变，
// 后者需要旧场景已拆完才不会把镜头改到新包的机位上。----
watch(() => store.packId, async (id, old) => {
  if (!id || id === old) return;
  const idx = packIndex.value;
  if (!idx) return;
  const pack = idx.packs.find((p) => p.id === id);
  if (!pack) return;
  // 换包必重播一遍开场（减少动态除外）；先释放旧场景再换海报与元数据
  pendingIntro = { play: lastInput?.reducedMotion !== true, reason: "pack-switch" };
  if (sceneHandle || canvasMounted.value) teardownScene("static");
  meta.value = null; // 换包期间 wantScene 不成立，杜绝「旧 meta 配新 glb」的竞态
  posterSrc.value = packUrl(pack.posterDesktop);
  showPoster();
  try {
    meta.value = await loadPackMeta(idx, id);
    touchHook({ hotspotCount: meta.value.hotspots.length });
    if (gate.value.mode === "scene") void initScene();
  } catch {
    meta.value = null;
    sceneStatus.value = "error";
    touchHook({ status: "error" });
  }
});

// ---- W3：mode / zoneId 变化 → 片区显隐与镜头（只在就绪后应用；加载期间点的等就绪补上）----
// W8：进观景调 scene.setTour(true)；退出调 setTour(false)（镜头回到观景前的机位，
// 不再另触 applyStageMode——恢复的模式当时就在那个机位上）。
watch([() => store.mode, () => store.zoneId, () => store.collegeNo], ([m], [prevM]) => {
  touchHook({ mode: store.mode, college: store.collegeNo });
  if (m === "tour") {
    if (sceneStatus.value === "ready" && gate.value.mode === "scene") {
      sceneHandle?.setTour(true);
    }
    return;
  }
  if (prevM === "tour") {
    sceneHandle?.setTour(false);
    return;
  }
  applyStageMode();
});

// W5：把当前包元数据同步给 store（showAnswer 取楼名用）
watch(meta, (m) => store.setMeta(m), { immediate: true });

// ALIVE A5：回放阶段进调试钩子（e2e 与自查读它）
watch(() => store.trace.phase, (p) => touchHook({ phase: p }), { immediate: true });

// W10：把场景就绪状态同步给 store（enterPlace / otherPack 的等待逻辑用）
watch(sceneStatus, (s) => store.setSceneReady(s === "ready"), { immediate: true });

// W11：「重置视角」——把镜头飞回当前状态的推荐机位（全景/校区/楼栋），
// 不动校区选择、高亮与对话；观景中不理会（按钮此刻也看不到）。
watch(() => store.resetViewSeq, () => {
  if (sceneStatus.value !== "ready" || store.mode === "tour") return;
  applyStageMode();
});

function applyStageMode() {
  if (!sceneHandle || sceneStatus.value !== "ready") return;
  if (store.mode === "tour") return; // W8：观景由 setTour 控制，不动片区与镜头
  if (store.mode === "home") {
    sceneHandle.setZone(null);
    sceneHandle.setShell(null);
    sceneHandle.setPin(null);
    sceneHandle.goTo("home");
  } else if (store.mode === "campus" && store.zoneId) {
    sceneHandle.setZone(store.zoneId);
    sceneHandle.setShell(null);
    sceneHandle.setPin(null);
    // W3：片区没有 stop 的（单片区校区沙盘）退回 overview
    const stop = campusStop(store.zoneId);
    if (stop) sceneHandle.goTo(stop);
  } else if (store.mode === "answer" && store.place) {
    // W5：回答落到楼上——外壳优先，没有外壳的楼用图钉；镜头去这栋楼的近景机位
    const m = meta.value;
    if (!m) return;
    sceneHandle.setZone(null);
    const bid = store.place.buildingId;
    if ((m.shells ?? []).includes(bid)) {
      sceneHandle.setShell(bid);
      sceneHandle.setPin(null);
    } else {
      sceneHandle.setShell(null);
      sceneHandle.setPin(bid);
    }
    const pose = m.focus?.[bid];
    if (pose) sceneHandle.goTo(pose, { name: `focus:${bid}` });
  }
}

function campusStop(zoneId: string): string {
  // packs.json v3 的 campuses 不再有 stop：校区镜头停靠看当前包 meta.zones[].stop
  // （all 上五个主校区有 by/bq/zq/nq/dq；单片区沙盘没有 → overview，STAGE 5.3）
  const z = meta.value?.zones?.find((x) => x.id === zoneId);
  return z?.stop ?? "overview";
}

function touchHook(patch: Record<string, unknown>) {
  const hook = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  if (hook) Object.assign(hook, patch);
}

// 宽高比：窗口宽高比超过 posterAspect 时宽度取高度×posterAspect，水平居中（4.1 节）
const frameStyle = computed(() => ({
  "--poster-aspect": String(meta.value?.pack?.posterAspect ?? 2.4),
}));

onMounted(async () => {
  // 钩子先建好（字段与 CampusHero 一致，另加 v3 的 pack/shellNodes/zoneNodes 等）
  (window as unknown as { __campus3d?: unknown }).__campus3d = {
    mode: store.mode,
    reason: "not-ready",
    status: "static",
    intro: "none",
    introReason: "not-ready",
    hotspotCount: 0,
    buildingCount: 0,
    activeBoard: null,
    hoveredBoard: null,
    focusedBuilding: null,
    pack: "",
    shellNodes: 0,
    zoneNodes: 0,
    zone: null,
    shell: null,
    pin: null,
    azimuth: 0,
    tour: false,
    stop: "home",
    moving: false,
    lanterns: 0,
    college: null,
    phase: "idle",
    threads: 0,
    frames: 0,
    drawCalls: 0,
    triangles: 0,
    geometries: 0,
    textures: 0,
    highlightMaterials: 0,
    camera: { position: [0, 0, 0], target: [0, 0, 0], fov: 30 },
    projectPoint: () => ({ x: 0, y: 0, visible: false }),
  };

  lastInput = readGateInput();
  gate.value = decideMode(lastInput);
  touchHook({ reason: gate.value.reason });
  window.addEventListener("resize", onWindowResize);

  // W5：测试入口（只给 e2e 用，和 W2 的 debugGoTo 一样做完也留着）
  const hookForDebug = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
  if (hookForDebug) {
    hookForDebug.debugShowAnswer = (bid: string) => {
      void store.showAnswer(bid);
    };
  }

  try {
    const idx = await loadPackIndex();
    packIndex.value = idx;
    const pack = idx.packs.find((p) => p.id === (store.packId || idx.default));
    if (pack) {
      posterSrc.value = packUrl(pack.posterDesktop);
      const resp = await fetch(packUrl(pack.meta));
      if (!resp.ok || !(resp.headers.get("content-type") || "").includes("json")) {
        throw new Error(`元数据加载失败：${packUrl(pack.meta)}`);
      }
      meta.value = parseMeta(await resp.json());
      touchHook({ hotspotCount: meta.value.hotspots.length });
    }
  } catch {
    meta.value = null;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", onWindowResize);
  if (sceneHandle || canvasMounted.value) {
    sceneHandle?.dispose();
    sceneHandle = null;
    removeCanvas();
  }
});
</script>

<template>
  <div class="stage" data-testid="stage" :data-mode="store.mode" :class="{ 'is-tour': store.mode === 'tour' }" :style="frameStyle">
    <img ref="posterEl" data-testid="stage-poster" class="stage-poster"
         :src="posterSrc" alt="石河子大学校园沙盘（示意）" />
    <canvas v-if="canvasMounted" ref="canvasRef" data-testid="stage-canvas"
            class="stage-canvas" :class="{ 'is-ready': sceneStatus === 'ready' }"></canvas>
    <div v-if="sceneStatus === 'loading'" class="stage-progress" data-testid="stage-progress"
         :style="{ width: `${Math.round(progress * 100)}%` }"></div>
    <div v-if="sceneStatus === 'error'" class="stage-error">
      <span class="tiny">3D 加载失败，已显示静态图</span>
      <button type="button" class="btn-sm" data-testid="stage-retry" @click="retryScene">重试</button>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  background: var(--st-ink, #05080d);
  overflow: hidden;
}
/* 宽高比超过 posterAspect 时：宽度取 高度×posterAspect，水平居中（4.1 节） */
.stage-poster,
.stage-canvas {
  position: absolute;
  left: 50%;
  width: min(100vw, calc(100vh * var(--poster-aspect, 2.4)));
  height: 100%;
  transform: translateX(-50%);
  object-fit: cover;
  object-position: 50% 50%;
}
.stage-canvas { display: block; }
.stage-progress {
  position: absolute;
  top: 0;
  left: 0;
  height: 2px;
  background: var(--st-red, #e2001a);
  transition: width 120ms;
  z-index: 4;
}
.stage-error {
  position: absolute;
  left: 24px;
  bottom: 24px;
  display: flex;
  gap: 10px;
  align-items: center;
  color: var(--st-moon, #e8edf3);
  z-index: 4;
}
</style>
