<script setup lang="ts">
// STAGE W2/W3/W4：舞台页 = 整屏画布 + 界面骨架（顶栏、题字、罗盘、读数、暗角、署名）
// + 校区题签（左侧列表 + 场景里悬着的）+ 问话栏与回答面板。
// mode !== 'home' 时题字与遮罩 300ms 淡出。
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import StageCanvas from "@/components/stage/StageCanvas.vue";
import StageTop from "@/components/stage/StageTop.vue";
import StageHud from "@/components/stage/StageHud.vue";
import CampusRail from "@/components/stage/CampusRail.vue";
import SceneSigns from "@/components/stage/SceneSigns.vue";
import ZdxStar from "@/components/stage/ZdxStar.vue";
import AskDock from "@/components/stage/AskDock.vue";
import AnswerPanel from "@/components/stage/AnswerPanel.vue";
import CampusPanel from "@/components/stage/CampusPanel.vue";
import { STAR_TRAIL_KEY, type StarTrailState } from "@/components/stage/ZdxStar.vue";
import { useStageStore } from "@/stores/stage";
import { useChatStore } from "@/stores/chat";
import { loadPlaces, type Places } from "@/stage/packs";
import { resolvePlace, EMPTY_PLACES } from "@/stage/places";
import "@/styles/stage.css";
import { provide, ref } from "vue";

const store = useStageStore();
const chat = useChatStore();

// W7：星星拖尾的共享容器（ZdxStar 写、SceneSigns 画）
provide(STAR_TRAIL_KEY, ref<StarTrailState | null>(null));

const heroVisible = computed(() => store.mode === "home");
const heroStyle = computed(() => ({
  opacity: heroVisible.value ? "1" : "0",
  pointerEvents: "none" as const,
}));

// W9：answer 态且选中了板块 → 显示板块面板，回答面板让位
// （发出问题后 board 被清空，面板自然换回回答面板）
const boardPanelActive = computed(() => store.mode === "answer" && store.board !== null);

// ---- W5：回答落到哪栋楼。只对本次页面打开之后新发出的请求触发；
// restore() 恢复出的旧记录（进来时就是 done）不触发（卡常见错误第 5 条）。----
let places: Places | null = null;
let activeNewRequestId: string | null = null;

/** 读 request_id + status（computed 依赖这两个字段，状态变化时才会重新求值） */
const lastAssistantKey = computed(() => {
  for (let i = chat.turns.length - 1; i >= 0; i--) {
    const t = chat.turns[i];
    if (t.role === "assistant") return `${t.request_id}:${t.status}`;
  }
  return "";
});

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
    // 开始新的一问：复位（上一问的楼不能还红着）
    activeNewRequestId = turn.request_id;
    void store.showAnswer(null);
  } else if (turn.status === "done" && turn.request_id === activeNewRequestId) {
    activeNewRequestId = null;
    const response = turn.response;
    void store.showAnswer(response ? resolvePlace(response, places ?? EMPTY_PLACES) : null);
  }
});

onMounted(async () => {
  // W8：舞台页锁住页面滚动（滚轮留给沙盘缩放）；离开时恢复。Esc 退出观景。
  document.body.style.overflow = "hidden";
  window.addEventListener("keydown", onKeyDown);
  places = await loadPlaces().catch(() => null);
});

/** W8：Esc 退出观景 */
function onKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && store.mode === "tour") store.setTour(false);
}

// W6：离开舞台（去 /chat、/services、/workflows 或「普通版」）时把舞台状态归位。
// stage store 是全局的，SPA 往返回来后 StageView 重新挂裁：不复位的话，加载期间
// applyStageMode 会按残留的 answer/campus 态把镜头重新飞走（W6 验证第 7 条专门盯这个）。
// 镜头、片区、图钉部由 StageCanvas 监听状态驱动，重新挂裁后自然回到首页机位；
// 对话记录在 chat store 里，面板回来仍是那轮回答。
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKeyDown);
  document.body.style.overflow = "";
  store.goHome();
});
</script>

<template>
  <StageCanvas>
    <!-- 暗角（1 层；不接收鼠标） -->
    <div class="stage-vignette" aria-hidden="true"></div>

    <!-- 题字底下的遮罩（只在首页状态显示；W3：非 home 时跟着题字一起淡出） -->
    <div class="stage-hero-mask" aria-hidden="true" :style="heroStyle"></div>

    <!-- 题字（home 状态显示；W3：非 home 时 300ms 淡出，回 home 淡入） -->
    <section class="stage-hero" data-testid="stage-hero" :style="heroStyle">
      <p class="stage-hero-kicker">校园就是界面</p>
      <h1 class="stage-hero-title">校园办事，<br />问一次就清楚。</h1>
      <p class="stage-hero-desc">
        依据学校官方发布的资料作答，每条回答都附出处，并在校园里指给你看：去哪栋楼。
      </p>
    </section>

    <!-- 校区列表（左）与场景题签（悬在校区上方），智多星（W7） -->
    <CampusRail />
    <SceneSigns />
    <ZdxStar />

    <StageTop />
    <StageHud />

    <!-- 问话栏、回答面板与校区/板块面板（W9） -->
    <AskDock />
    <AnswerPanel v-if="!boardPanelActive" />
    <CampusPanel />

    <!-- W8：观景时的退出钮（界面其余零件都淡去，只剩它） -->
    <button
      v-if="store.mode === 'tour'"
      type="button"
      class="stage-tour-exit"
      data-testid="stage-tour-exit"
      @click="store.setTour(false)"
    >退出观景</button>

    <p class="stage-caption tiny" data-testid="stage-caption">
      校园示意模型，依据公开资料复原，非测绘成果；办事地点以学校官方通知为准。底图数据 © OpenStreetMap contributors
    </p>
  </StageCanvas>
</template>
