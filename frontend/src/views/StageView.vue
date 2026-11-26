<script setup lang="ts">
// STAGE W2/W3/W4：舞台页 = 整屏画布 + 界面骨架（顶栏、题字、罗盘、读数、暗角、署名）
// + 校区题签（左侧列表 + 场景里悬着的）+ 问话栏与回答面板。
// mode !== 'home' 时题字与遮罩 300ms 淡出。
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from "vue";
import StageCanvas from "@/components/stage/StageCanvas.vue";
import StageTop from "@/components/stage/StageTop.vue";
import StageHud from "@/components/stage/StageHud.vue";
import CampusRail from "@/components/stage/CampusRail.vue";
import SceneSigns from "@/components/stage/SceneSigns.vue";
import CollegeLanterns from "@/components/stage/CollegeLanterns.vue";
import ZdxStar from "@/components/stage/ZdxStar.vue";
import StageLabelDriver from "@/components/stage/StageLabelDriver.vue";
import AskDock from "@/components/stage/AskDock.vue";
import AnswerPanel from "@/components/stage/AnswerPanel.vue";
import CampusPanel from "@/components/stage/CampusPanel.vue";
import AgentTrace from "@/components/stage/AgentTrace.vue";
import CollegeDial from "@/components/stage/CollegeDial.vue";
import { STAR_TRAIL_KEY, type StarTrailState } from "@/components/stage/ZdxStar.vue";
import { useStageStore } from "@/stores/stage";
import { useChatStore } from "@/stores/chat";
import { loadPlaces, type Places } from "@/stage/packs";
import { decidePlace, EMPTY_PLACES } from "@/stage/places";
import { loadEmblems } from "@/stage/emblems";
import { createLabelBoard, LABEL_BOARD_KEY } from "@/stage/labelBoard";
import { IDLE_TRACE, queryOf, traceFromResponse } from "@/stage/trace";
import EmblemMark from "@/components/stage/EmblemMark.vue";
import "@/styles/stage.css";

const store = useStageStore();
const chat = useChatStore();

// 手动观景（用户点「观景」）与空闲自动转动共用 mode === 'tour'，用 idleTour 区分。
// 手动观景时问话栏淡出并 inert，底部留一枚「问智多星」；点它退出观景并把焦点还给输入框。
const manualTour = computed(() => store.mode === "tour" && !store.idleTour);
const askDockRef = ref<InstanceType<typeof AskDock> | null>(null);
const tourExitRef = ref<HTMLButtonElement | null>(null);
const inputFocused = ref(false);

async function exitTour(toAsk = false) {
  store.setTour(false);
  await nextTick();
  if (toAsk) askDockRef.value?.focusInput();
  else askDockRef.value?.focusTour();
}

function askFromTour() {
  void exitTour(true);
}

function onInputFocus() {
  inputFocused.value = true;
  window.clearTimeout(idleTimer); // 光标在输入框里就暂停空闲计时
  if (store.idleTour) exitIdleTour(); // 已经自动转起来：回到原输入状态
}

function onInputBlur() {
  inputFocused.value = false;
  armIdle();
}

// 进入手动观景后，焦点交给画面上可见的「退出观景」（随后 Tab 可到「问智多星」）
watch(manualTour, async (on) => {
  if (!on) return;
  await nextTick();
  tourExitRef.value?.focus({ preventScroll: true });
});

// W7：星星拖尾的共享容器（ZdxStar 写、SceneSigns 画）
provide(STAR_TRAIL_KEY, ref<StarTrailState | null>(null));

// 本次「标签分级」：两块标签共用一份避让布局（SceneSigns/CollegeLanterns 发布候选，
// StageLabelDriver 每帧算一次）
provide(LABEL_BOARD_KEY, createLabelBoard());

const heroVisible = computed(() => store.mode === "home" && !answerPanelOpen.value);
const heroStyle = computed(() => ({
  opacity: heroVisible.value ? "1" : "0",
  pointerEvents: "none" as const,
}));

// W11：回答面板展开时题字与遮罩一起淡出给沙盘让位（回答没定位到楼时舞台仍处于
// home，题字本会继续显示）；收起后若仍在 home，题字再回来。mode 非 home 时原有规则不变。
const hasAssistant = computed(() => chat.turns.some((t) => t.role === "assistant"));
const answerPanelOpen = computed(() => hasAssistant.value && store.answerOpen);

// W3：题字跟着沙盘换（第 4.5 节）——当前包是默认包时用固定文案；
// 不是默认包时，小题写「石河子大学」，大标题写包名，说明写包的 note。
const currentPack = computed(() => store.currentPack);
const isDefaultPack = computed(() => store.packId === store.default);

// W9：answer 态且选中了板块 → 显示板块面板，回答面板让位
// （发出问题后 board 被清空，面板自然换回回答面板）
const boardPanelActive = computed(() => store.mode === "answer" && store.board !== null);

// ---- W5：回答落到哪栋楼。只对本次页面打开之后新发出的请求触发；
// restore() 恢复出的旧记录（进来时就是 done）不触发（卡常见错误第 5 条）。----
// 按需定位：只有「明确问位置 + 唯一结构化目标 + 目标在当前场景」才自动飞；
// 问候/条件/数量类一律不动镜头，其余给手动入口。
let places: Places | null = null;
let activeNewRequestId: string | null = null;
/** 发起这一轮时的视角序号：等待期间用户选楼/换校区/重置过就放弃自动定位 */
let viewMark = 0;

/** 当前沙盘可落楼的集合；场景未就绪时为 null（→ 只给手动入口） */
function sceneBuildings(): Set<string> | null {
  if (!store.sceneReady || !store.meta) return null;
  return new Set(Object.keys(store.meta.buildings));
}

function zoneNameOf(buildingId: string): string | null {
  const zoneId = store.meta?.buildings[buildingId]?.zone;
  if (!zoneId) return null;
  return store.meta?.zones?.find((z) => z.id === zoneId)?.name ?? null;
}

function packNameOf(packId: string): string | null {
  return store.packs.find((p) => p.id === packId)?.name ?? null;
}

// ---- ALIVE A5：在想的回放（读题 → 翻查 → 核证 → 作答）。
// 所有等待按 requestId 作废；新的一问、换包、离开页面都清掉。 ----
const reducedMotion = typeof window !== "undefined"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
let traceTimers: number[] = [];

function clearTraceTimers() {
  for (const t of traceTimers) window.clearTimeout(t);
  traceTimers = [];
}
function traceLater(ms: number, fn: () => void) {
  traceTimers.push(window.setTimeout(fn, ms));
}

/** 读 request_id + status（computed 依赖这两个字段，状态变化时才会重新求值） */
const lastAssistantKey = computed(() => {
  for (let i = chat.turns.length - 1; i >= 0; i--) {
    const t = chat.turns[i];
    if (t.role === "assistant") return `${t.request_id}:${t.status}`;
  }
  return "";
});

/** 这一轮用户问的原话（翻查题签用）。
 *  选项轮在 chat store 里存成「[选择] 学生证（…）」：问位置时这种文字看不到「在哪/去哪」，
 *  而原问题（如「怎么补办卡」）也未必含位置词。按后端 v1.py 的回放口径，用
 *  「上一条非选项的用户原话 + 空格 + 选项文字」——前后端一致，按需定位才能看到办事单。 */
function questionOf(requestId: string): string {
  const idx = chat.turns.findIndex((t) => t.request_id === requestId && t.role === "user");
  const user = idx >= 0 ? chat.turns[idx] : null;
  if (!user) return "";
  if (!user.choiceId) return user.text;
  const label = user.text.replace(/^\[选择\]\s*/, "");
  for (let i = idx - 1; i >= 0; i--) {
    const t = chat.turns[i];
    if (t.role === "user" && !t.choiceId && t.text) return `${t.text} ${label}`.trim();
  }
  return label;
}

/** 镜头停下 1.2 秒后回到 idle（requestId 已变就作废） */
function idleAfterCamera(requestId: string) {
  const check = () => {
    if (store.trace.requestId !== requestId) return;
    const hook = (window as unknown as { __campus3d?: { moving?: boolean } }).__campus3d;
    if (hook?.moving === false) {
      traceLater(1200, () => {
        if (store.trace.requestId === requestId) store.setTrace({ ...IDLE_TRACE });
      });
      return;
    }
    traceLater(120, check);
  };
  traceLater(120, check);
}

watch(lastAssistantKey, () => {
  let turn: (typeof chat.turns)[number] | null = null;
  for (let i = chat.turns.length - 1; i >= 0; i--) {
    if (chat.turns[i].role === "assistant") {
      turn = chat.turns[i];
      break;
    }
  }
  if (!turn) return;
  if (turn.status === "pending") {
    // 开始新的一问：重新展开面板并清掉本轮的旧关联；
    // 不动 pack/mode/zone/已选楼/镜头（从楼栋视角发问不再先飞回全景）。
    clearTraceTimers();
    activeNewRequestId = turn.request_id;
    viewMark = store.viewSeq;
    stageAutoOpen();
    store.beginTurn(turn.request_id);
    const rid = turn.request_id;
    store.setTrace({ ...IDLE_TRACE, phase: "read", requestId: rid });
    if (reducedMotion) {
      store.setTrace({ phase: "search", query: queryOf(questionOf(rid)) });
    } else {
      traceLater(400, () => {
        if (store.trace.requestId !== rid || store.trace.phase !== "read") return;
        store.setTrace({ phase: "search", query: queryOf(questionOf(rid)) });
      });
    }
    return;
  }
  if (turn.status !== "done" || turn.request_id !== activeNewRequestId) return;

  activeNewRequestId = null;
  const rid = turn.request_id;
  const response = turn.response;
  const failed = !response || response.status === "error" || response.status === "model_unavailable";
  if (failed) {
    store.setTrace({ phase: "error" });
    traceLater(1500, () => {
      if (store.trace.requestId === rid) store.setTrace({ ...IDLE_TRACE });
    });
    // 失败也不动镜头：保留用户正在看的校区与楼，只清本轮办理地点关联
    store.setAnswerLink(rid, null);
    store.setPlaceOffer(null);
    return;
  }

  const decision = decidePlace({
    question: questionOf(rid),
    response,
    places: places ?? EMPTY_PLACES,
    inScene: sceneBuildings(),
    contextOf: zoneNameOf,
    packNameOf,
  });
  // 等待期间用户已经选楼/换校区/重置视角：不把人拉回来，转成手动入口
  const action = decision.action === "auto" && viewMark !== store.viewSeq
    ? "offer"
    : decision.action;
  const target = action === "auto" ? decision.candidates[0]?.buildingId ?? null : null;

  if (action === "offer") {
    store.setPlaceOffer({ requestId: rid, candidates: decision.candidates, text: decision.text });
  } else {
    store.setPlaceOffer(null);
  }
  store.setAnswerLink(rid, action === "auto" ? target : null);
  console.log("[locate]", JSON.stringify({
    reason: decision.reason, action, target, viewMark, viewSeq: store.viewSeq,
    candidates: decision.candidates.map((c) => c.buildingId),
  }));

  const { hits, evidence } = traceFromResponse(response, places ?? EMPTY_PLACES, store.meta);
  const withBuilding = hits.filter((h) => h.buildingId !== null).length;

  const settle = async () => {
    if (action === "auto" && target) {
      // 镜头已经在这栋楼：只关联本轮答案，不重复飞
      const already = store.mode === "answer" && store.place?.buildingId === target;
      if (!already) await store.showAnswer(target);
    }
    idleAfterCamera(rid);
  };

  if (withBuilding > 0 && !reducedMotion) {
    store.setTrace({ phase: "verify", hits, evidence });
    const wait = 450 + 90 * (withBuilding - 1);
    traceLater(wait, () => {
      if (store.trace.requestId !== rid || store.trace.phase !== "verify") return;
      store.setTrace({ phase: "answer" });
      void settle();
    });
  } else {
    store.setTrace({ phase: "answer", hits, evidence });
    void settle();
  }
}, { flush: "sync" });

/** W11：用户主动发问（新问题/选追问项/重试）→ 重新展开回答面板；
 *  后台返回结果时不动它（用户已经收起的话保持收起） */
function stageAutoOpen() {
  if (!store.answerOpen) store.setAnswerOpen(true);
}

onMounted(async () => {
  // W8：舞台页锁住页面滚动（滚轮留给沙盘缩放）；离开时恢复。Esc 退出观景。
  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", onKeyDown);
  // ALIVE A9：空闲转动——监听挂在 window 上（挂着画布会漏掉界面上的移动）
  for (const ev of IDLE_EVENTS) window.addEventListener(ev, onIdleInput, { passive: true });
  armIdle();
  places = await loadPlaces().catch(() => null);
  // ALIVE A1： 拉 24 学院院徽清单。失败保持 null（后面的卡看到 null 一律不画院徽），
  // 舞台照常工作，只在控制台留一条警告。
  try {
    store.emblems = await loadEmblems();
  } catch (e) {
    console.warn("[stage] emblems.json 加载失败，院徽不渲染", e);
  }
});

// A1 自查：?emblems=1 时左上角临时排出两行院徽（锿金/本色），对照 emblems-contact.jpg
// （响应式：emblems 异步载入后才亮出来；不带参数永不渲染）
const emblemSheet = computed(
  () => new URLSearchParams(location.search).get("emblems") === "1" && !!store.emblems
);

/** W8：Esc 退出观景；空闲自动转动也退回原界面 */
function onKeyDown(e: KeyboardEvent) {
  if (e.key !== "Escape" || store.mode !== "tour") return;
  if (store.idleTour) {
    store.idleTour = false;
    store.setTour(false);
    return;
  }
  void exitTour();
}

// ---- ALIVE A9：空闲转动。首页 N 秒（默认 30，网址 idle=<秒> 可调）没有任何输入 →
// 以每秒 1 度绕转；之后任何输入就退出、回首页机位并重新计时。减少动态不做。 ----
const IDLE_DEFAULT_S = 30;
const idleSeconds = (() => {
  const raw = Number(new URLSearchParams(location.search).get("idle") ?? "");
  return Number.isFinite(raw) && raw > 0 ? raw : IDLE_DEFAULT_S;
})();
let idleTimer = 0;
let lastInputAt = 0;

function waitingAnswer(): boolean {
  return chat.turns.some((t) => t.role === "assistant" && t.status === "pending");
}

function canIdle(): boolean {
  return store.mode === "home"
    && !waitingAnswer()
    && !store.dialOpen
    && !inputFocused.value
    && !reducedMotion
    && !store.idleTour;
}

function exitIdleTour() {
  if (!store.idleTour) return;
  store.idleTour = false;
  store.setTour(false);
}

function armIdle() {
  window.clearTimeout(idleTimer);
  if (!canIdle()) return;
  idleTimer = window.setTimeout(() => {
    if (!canIdle()) return;
    store.idleTour = true;
    store.setTour(true, 1); // 每秒 1 度
  }, idleSeconds * 1000);
}

function onIdleInput() {
  if (store.idleTour) {
    exitIdleTour();
    lastInputAt = performance.now();
    armIdle();
    return;
  }
  const now = performance.now();
  if (now - lastInputAt < 250) return;
  lastInputAt = now;
  armIdle();
}

const IDLE_EVENTS = ["pointerdown", "pointermove", "wheel", "keydown", "touchstart"] as const;

// 状态变化（进出回答、开合罗盘、离开首页、输入框聚焦）时重新评估计时
watch(
  () => [store.mode, store.dialOpen, waitingAnswer(), inputFocused.value],
  () => armIdle()
);

// W6：离开舞台（去 /chat、/services、/workflows 或「普通版」）时把舞台状态归位。
// stage store 是全局的，SPA 往返回来后 StageView 重新挂裁：不复位的话，加载期间
// applyStageMode 会按残留的 answer/campus 态把镜头重新飞走（W6 验证第 7 条专门盯这个）。
// 镜头、片区、图钉部由 StageCanvas 监听状态驱动，重新挂裁后自然回到首页机位；
// 对话记录在 chat store 里，面板回来仍是那轮回答。
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  for (const ev of IDLE_EVENTS) window.removeEventListener(ev, onIdleInput);
  window.clearTimeout(idleTimer);
  document.body.style.overflow = "";
  clearTraceTimers();
  store.goHome();
});
</script>

<template>
  <StageCanvas>
    <!-- 暗角（1 层；不接收鼠标） -->
    <div class="stage-vignette" aria-hidden="true"></div>

    <!-- 题字底下的遮罩（只在首页状态显示；W3：非 home 时跟着题字一起淡出） -->
    <div class="stage-hero-mask" aria-hidden="true" :style="heroStyle"></div>

    <!-- 题字（home 状态显示；W3：非 home 时 300ms 淡出，回 home 淡入；题字随包换） -->
    <section class="stage-hero" data-testid="stage-hero" :style="heroStyle">
      <template v-if="isDefaultPack">
        <p class="stage-hero-kicker">校园就是界面</p>
        <h1 class="stage-hero-title">校园办事，<br />问一次就清楚。</h1>
        <p class="stage-hero-desc">
          依据学校官方发布的资料作答，每条回答都附出处，并在校园里指给你看：去哪栋楼。
        </p>
      </template>
      <template v-else-if="currentPack">
        <p class="stage-hero-kicker">石河子大学</p>
        <h1 class="stage-hero-title">{{ currentPack.name }}</h1>
        <p class="stage-hero-desc">{{ currentPack.note }}</p>
      </template>
    </section>

    <!-- 校区列表（左）与场景题签（悬在校区上方），学院灯牌（A2），智多星（W7） -->
    <CampusRail />
    <SceneSigns />
    <CollegeLanterns />
    <StageLabelDriver />
    <ZdxStar />
    <AgentTrace />

    <StageTop />
    <StageHud />

    <!-- 问话栏、回答面板与校区/板块面板（W9） -->
    <AskDock
      ref="askDockRef"
      @input-focus="onInputFocus"
      @input-blur="onInputBlur"
    />
    <AnswerPanel v-if="!boardPanelActive" />
    <CampusPanel />
    <CollegeDial />

    <!-- W8：观景时的退出钮（界面其余零件都淡去，只剩它） -->
    <button
      v-if="manualTour"
      ref="tourExitRef"
      type="button"
      class="stage-tour-exit"
      data-testid="stage-tour-exit"
      @click="exitTour()"
    >退出观景</button>
    <!-- 手动观景时底部留一枚入口（排在退出钮之后：Tab 从退出钮往后就是它） -->
    <button
      v-if="manualTour"
      type="button"
      class="stage-tour-ask"
      data-testid="stage-tour-ask"
      @click="askFromTour"
    >问智多星</button>

    <p class="stage-caption tiny" data-testid="stage-caption">
      当前场景为夜景示意；校园示意模型，依据公开资料复原，非测绘成果；办事地点以学校官方通知为准。底图数据 © OpenStreetMap contributors
    </p>

    <!-- A1 自查排版：?emblems=1 时左上角两行各 24 枚（锿金/本色），仅开发自查用 -->
    <div v-if="emblemSheet" class="stage-emblem-sheet" data-testid="stage-emblem-sheet">
      <div class="stage-emblem-row">
        <EmblemMark v-for="c in store.emblems?.colleges ?? []" :key="'g' + c.no"
                    :college="c" :size="40" tone="gilt" />
      </div>
      <div class="stage-emblem-row">
        <EmblemMark v-for="c in store.emblems?.colleges ?? []" :key="'c' + c.no"
                    :college="c" :size="40" tone="color" />
      </div>
    </div>
  </StageCanvas>
</template>
