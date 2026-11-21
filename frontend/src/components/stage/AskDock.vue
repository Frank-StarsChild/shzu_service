<script setup lang="ts">
// STAGE W4：底部问话栏。直接用现有 useChatStore（send/pickChoice/retry/cancel/restore/
// newSession/turns/busy），不用 useGo().ask()——那会跳到 /chat。
import { computed, onMounted, ref } from "vue";
import { useChatStore } from "@/stores/chat";
import { useKbMeta } from "@/composables";

const store = useChatStore();
const { ready } = useKbMeta();
const text = ref("");

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
  background: linear-gradient(to bottom, rgba(10, 14, 20, 0.92), rgba(7, 10, 15, 0.97));
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
  color: #fff;
  font-family: var(--st-song);
  font-weight: 900;
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
}
.stage .stage-ask:active {
  transform: translateY(1px);
}
</style>
