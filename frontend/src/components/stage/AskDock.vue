<script setup lang="ts">
// STAGE W4：底部问话栏。直接用现有 useChatStore（send/pickChoice/retry/cancel/restore/
// newSession/turns/busy），不用 useGo().ask()——那会跳到 /chat。
// 顶栏统一后，舞台专用操作「观景 / 普通版」放在问话栏上方的工具行（沙盘控制区）：
// 观景仍只在 3D 可用且未开减少动态时显示；普通版记入偏好后去 /classic。
import { computed, inject, onMounted, ref } from "vue";
import { useChatStore } from "@/stores/chat";
import { useStageStore } from "@/stores/stage";
import { useKbMeta } from "@/composables";
import type { StageCtx } from "@/stage/types";

const store = useChatStore();
const stageStore = useStageStore();
const { ready } = useKbMeta();
const text = ref("");
const ctx = inject<StageCtx>("stageCtx");

/** 观景入口只在 3D 可用且未开减少动态时显示（原顶栏行为不变） */
const canTour = computed(
  () =>
    ctx?.gate.value.mode === "scene"
    && !(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
);

/** W11：重置视角只在 3D 可用时显示（静态海报没有镜头可重） */
const canReset = computed(() => ctx?.gate.value.mode === "scene");

/** 「普通版」：记住选择再去 /classic（下次打开首页走普通版，点「进入 3D 校园」清除） */
function preferClassic() {
  localStorage.setItem("shzu.stage", "classic");
}

const EXAMPLES = [
  "学生证丢了去哪补办？",
  "国家励志奖学金要什么条件？",
  "宿舍水管坏了怎么报修？",
  "借教室要提前几天申请？",
];

const statusText = computed(() => {
  if (store.busy) return "正在翻查审定资料…";
  if (ready.value) {
    return `智多星在线 · 知识库 ${ready.value.knowledge_evidence} 条审定证据`;
  }
  return "正在连接知识服务…";
});

function ask(msg?: string) {
  const value = (msg ?? text.value).trim();
  if (!value || store.busy) return;
  void store.send(value);
  text.value = "";
}

onMounted(() => {
  void store.restore();
});
</script>

<template>
  <div class="stage-dock" data-testid="stage-dock">
    <!-- 沙盘控制区：观景 / 重置视角 / 普通版（随问话栏在观景模式下一起淡出） -->
    <div class="stage-tools">
      <button
        v-if="canTour"
        type="button"
        class="stage-tool"
        data-testid="stage-tool-tour"
        @click="stageStore.setTour(true)"
      >观景</button>
      <button
        v-if="canReset"
        type="button"
        class="stage-tool"
        data-testid="stage-tool-reset"
        @click="stageStore.requestResetView()"
      >重置视角</button>
      <router-link
        class="stage-tool"
        data-testid="stage-tool-classic"
        to="/classic"
        @click="preferClassic"
      >普通版</router-link>
    </div>
    <p class="stage-status" data-testid="stage-status">
      <span class="stage-status-dot" aria-hidden="true"></span>{{ statusText }}
      <button
        v-if="store.busy"
        type="button"
        class="stage-cancel"
        data-testid="stage-cancel"
        @click="store.cancel()"
      >不等了</button>
    </p>
    <div v-if="store.turns.length === 0" class="stage-examples">
      <button
        v-for="q in EXAMPLES"
        :key="q"
        type="button"
        class="stage-example"
        @click="ask(q)"
      >{{ q }}</button>
    </div>
    <form class="stage-input-row" @submit.prevent="ask()">
      <input
        v-model="text"
        class="stage-input"
        data-testid="stage-input"
        type="text"
        autocomplete="off"
        placeholder="想办什么事？例如：学生证丢了去哪补办"
      />
      <button class="stage-ask" data-testid="stage-ask" type="submit">问</button>
    </form>
  </div>
</template>

<style scoped>
/* 问话栏（4.2）：底部居中、距底 30px、宽 min(800px, 100vw − 640px)。
   底色从上到下略微变暗是 4.5 节允许的渐变之一；上下两道压边、问字钮按下下沉 1px。 */
.stage .stage-dock {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  bottom: 30px;
  width: min(800px, calc(100vw - 640px));
  z-index: 4;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
/* 沙盘控制区（顶栏统一后自顶栏迁来）：右对齐的小题签式按钮，随问话栏淡出 */
.stage .stage-tools {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin: 0;
}
.stage .stage-tool {
  background: none;
  border: 1px solid var(--st-gold3);
  color: var(--st-moon2);
  font-family: var(--st-hei);
  font-size: 12px;
  letter-spacing: 0.2em;
  padding: 4px 12px;
  text-decoration: none;
  cursor: pointer;
  min-height: 0;
  min-width: 0;
  box-shadow: none;
  transform: none;
}
.stage .stage-tool:hover {
  border-color: var(--st-gold2);
  color: var(--st-moon);
  background: none;
  box-shadow: none;
  transform: none;
}
.stage .stage-tool:focus-visible {
  outline: 1px solid var(--st-gold2);
  outline-offset: 2px;
}
.stage .stage-status {
  margin: 0 0 -1px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--st-gold);
}
.stage .stage-status-dot {
  width: 7px;
  height: 7px;
  background: var(--st-gold);
  transform: rotate(45deg);
  flex: none;
}
.stage .stage-cancel {
  background: none;
  border: none;
  padding: 0 2px;
  font-family: var(--st-hei);
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--st-moon3);
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}
.stage .stage-cancel:hover {
  color: var(--st-moon2);
}
.stage .stage-examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
  margin: 0;
}
.stage .stage-example {
  background: none;
  border: 1px solid var(--st-gold3);
  color: var(--st-moon2);
  font-family: var(--st-hei);
  font-size: 12px;
  letter-spacing: 0.08em;
  padding: 5px 12px;
  cursor: pointer;
}
.stage .stage-example:hover {
  border-color: var(--st-gold2);
  color: var(--st-moon);
}
.stage .stage-input-row {
  display: flex;
  align-items: stretch;
  background: linear-gradient(to bottom, var(--stage-dock-1), var(--stage-dock-2));
  border-top: 1px solid var(--st-gold2);
  border-bottom: 3px double var(--st-gold3);
  border-left: 1px solid var(--st-gold3);
  border-right: 1px solid var(--st-gold3);
}
.stage .stage-input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: var(--st-moon);
  font-family: var(--st-hei);
  font-size: 16px;
  padding: 13px 16px;
}
.stage .stage-input::placeholder {
  color: var(--st-moon3);
}
.stage .stage-ask {
  width: 64px;
  flex: none;
  background: var(--st-red);
  border: 1px solid var(--st-red);
  color: var(--on-vermilion);
  font-family: var(--st-song);
  font-weight: 900;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.stage .stage-ask:hover { color: var(--on-vermilion); }
.stage .stage-ask:active {
  transform: translateY(1px);
}
</style>
