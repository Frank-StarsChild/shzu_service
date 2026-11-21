<script setup lang="ts">
// STAGE W4/W5：右侧回答面板（stage-panel）+ 上方用户问话条（stage-question）+ 红色引线。
// 只显示最后一轮；W5 起：place 不为空时最上面多一节「办理地点」（引线连到楼上），
// 楼在另一个沙盘时显示「换过去」的钮。样式在 stage.css。
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useChatStore, type ChatTurn } from "@/stores/chat";
import { useStageStore } from "@/stores/stage";
import type { StageCtx } from "@/stage/types";
import type { CitationRef } from "@/api/client";
import AnswerBlocks from "@/components/AnswerBlocks.vue";

const store = useChatStore();
const stage = useStageStore();
const ctx = inject<StageCtx>("stageCtx");

const lastAssistant = computed<ChatTurn | null>(() => {
  for (let i = store.turns.length - 1; i >= 0; i--) {
    if (store.turns[i].role === "assistant") return store.turns[i];
  }
  return null;
});

const lastUser = computed<ChatTurn | null>(() => {
  const a = lastAssistant.value;
  if (!a) return null;
  return store.turns.find((t) => t.request_id === a.request_id && t.role === "user") ?? null;
});

const resp = computed(() => lastAssistant.value?.response ?? null);

const isError = computed(() => {
  const a = lastAssistant.value;
  if (!a) return false;
  const s = a.response?.status;
  return a.status === "error" || s === "error" || s === "model_unavailable";
});

const title = computed(() => {
  const a = lastAssistant.value;
  if (!a) return "";
  if (a.status === "pending" || a.status === "cancelled") return "答";
  if (isError.value) return "这一轮没有答出来";
  switch (a.response?.status) {
    case "clarify": return "还要问你一句";
    case "insufficient": return "资料不足";
    case "out_of_scope": return "不在办事范围内";
    case "workflow": return "办事向导";
    default: return "答";
  }
});

/** answer 状态：右上「依据 N 条审定证据 · S 秒」 */
const metaText = computed(() => {
  const a = lastAssistant.value;
  if (!a || a.status !== "done" || a.response?.status !== "answer") return "";
  const n = a.response.citations.length;
  const sec = ((a.response.timing_ms ?? 0) / 1000).toFixed(1);
  return `依据 ${n} 条审定证据 · ${sec} 秒`;
});

const errorText = computed(() => {
  const a = lastAssistant.value;
  if (!a) return "";
  return a.errorText ?? a.response?.message ?? "请求失败，可点击重试";
});

const insufficientText = computed(() => {
  const a = lastAssistant.value;
  if (!a || a.status !== "done" || a.response?.status !== "insufficient") return "";
  return a.response.message ?? "现有审定资料里没有足够信息回答这个问题。";
});

const missingText = computed(() => {
  const r = resp.value;
  if (!r) return "";
  const fields = (r.unknown_fields ?? []).length > 0
    ? r.unknown_fields
    : (r.answer?.unknown_fields ?? []);
  return fields.length > 0 ? `还缺：${fields.join("；")}` : "";
});

/** 展开的公文卡（citation id） */
const openDoc = ref<string | null>(null);

function toggleDoc(id: string) {
  openDoc.value = openDoc.value === id ? null : id;
}

/** AnswerBlocks 的 cite 事件：展开对应公文卡并滚到它 */
async function onCite(cid: string) {
  const c = resp.value?.citations.find((x) => x.id === cid);
  if (!c) return;
  openDoc.value = cid;
  await nextTick();
  document.querySelector(`[data-doc-id="${cid}"]`)?.scrollIntoView({ block: "nearest" });
}

function docOf(c: CitationRef): string {
  return c.locator ? `${c.issuer} · ${c.locator}` : c.issuer;
}

function onRetry() {
  const a = lastAssistant.value;
  if (a) void store.retry(a.request_id);
}

// ---- W5：办理地点与换包 ----
const placeZoneName = computed(() => {
  const bid = stage.place?.buildingId;
  if (!bid) return "";
  const m = ctx?.meta.value;
  const zoneId = m?.buildings[bid]?.zone;
  if (!zoneId) return "";
  return m?.zones?.find((z) => z.id === zoneId)?.name ?? "";
});

const otherPackName = computed(() => {
  const op = stage.otherPack;
  if (!op) return "";
  return stage.campuses.find((c) => c.pack === op.packId)?.name ?? op.packId;
});

/** 点「换过去」：换包，等新场景 ready 后再把那栋楼的答案态补上 */
function goOtherPack() {
  const op = stage.otherPack;
  if (!op) return;
  const bid = op.buildingId;
  void stage.switchPack(op.packId);
  const stop = watch(
    () => ctx?.sceneStatus.value,
    (s) => {
      if (s === "ready") {
        stop();
        void stage.showAnswer(bid);
      }
    }
  );
}

// ---- W5：红色引线。三个点：「办理地点」左缘往下 36px → 往左 70px → 楼的 anchor 往下 6
// 投影后再往右 30px。每帧重算；「办理地点」滚出面板可见范围时隐藏。----
const placeEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const leaderPoints = ref("");
const leaderEnd = ref({ x: 0, y: 0 });

function updateLeader() {
  if (!stage.place) {
    leaderPoints.value = "";
    return;
  }
  const handle = ctx?.getHandle();
  const anchor = ctx?.meta.value?.buildings[stage.place.buildingId]?.anchor;
  if (!handle || !anchor || !placeEl.value || !scrollEl.value) {
    leaderPoints.value = "";
    return;
  }
  const pr = placeEl.value.getBoundingClientRect();
  const sr = scrollEl.value.getBoundingClientRect();
  if (pr.bottom < sr.top || pr.top > sr.bottom) {
    leaderPoints.value = "";
    return;
  }
  const x1 = pr.left;
  const y1 = pr.top + 36;
  const x2 = x1 - 70;
  const y2 = y1;
  const ap = handle.project([anchor[0], anchor[1] - 6, anchor[2]]);
  const x3 = ap.x + 30;
  const y3 = ap.y;
  leaderEnd.value = { x: x3, y: y3 };
  leaderPoints.value = `${x1},${y1} ${x2},${y2} ${x3},${y3}`;
}

let offFrame: (() => void) | null = null;

onMounted(() => {
  offFrame = ctx?.registerFrame(updateLeader) ?? null;
  updateLeader();
});

onBeforeUnmount(() => {
  offFrame?.();
});
</script>

<template>
  <div v-if="lastAssistant" class="stage-answer">
    <!-- 用户的问话（面板上方一小条宣纸） -->
    <p v-if="lastUser" class="stage-question" data-testid="stage-question">{{ lastUser.text }}</p>

    <section class="stage-panel" data-testid="stage-panel">
      <i class="stage-corner c-tl" aria-hidden="true"></i>
      <i class="stage-corner c-tr" aria-hidden="true"></i>
      <i class="stage-corner c-bl" aria-hidden="true"></i>
      <i class="stage-corner c-br" aria-hidden="true"></i>

      <header class="stage-panel-head">
        <h2 class="stage-panel-title">{{ title }}</h2>
        <span v-if="metaText" class="stage-panel-meta">{{ metaText }}</span>
      </header>

      <div ref="scrollEl" class="stage-panel-scroll">
        <!-- pending -->
        <p v-if="lastAssistant.status === 'pending'" class="stage-panel-text">正在翻查审定资料…</p>

        <!-- cancelled -->
        <p v-else-if="lastAssistant.status === 'cancelled'" class="stage-panel-text">这一轮已经取消。</p>

        <!-- error -->
        <div v-else-if="isError" class="stage-panel-block">
          <p class="stage-panel-text">{{ errorText }}</p>
          <button type="button" class="stage-btn" data-testid="stage-retry" @click="onRetry">再试一次</button>
        </div>

        <!-- clarify -->
        <div v-else-if="resp?.status === 'clarify'" class="stage-panel-block">
          <p class="stage-panel-text">{{ resp.clarify?.question }}</p>
          <div v-if="resp.clarify?.choices?.length" class="stage-choices">
            <button
              v-for="c in resp.clarify.choices"
              :key="c.id"
              type="button"
              class="stage-choice"
              @click="store.pickChoice(c.id)"
            >{{ c.label }}</button>
          </div>
          <p v-else-if="resp.clarify?.input_hint" class="stage-panel-text soft">{{ resp.clarify.input_hint }}</p>
        </div>

        <!-- out_of_scope -->
        <p v-else-if="resp?.status === 'out_of_scope'" class="stage-panel-text">{{ resp.message }}</p>

        <!-- workflow -->
        <div v-else-if="resp?.status === 'workflow' && resp.workflow" class="stage-panel-block">
          <p class="stage-panel-title-line">
            {{ resp.workflow.name }}
            <span v-if="resp.workflow.historical" class="stage-tag">历史演示</span>
          </p>
          <p class="stage-panel-text">{{ resp.workflow.summary }}</p>
          <router-link
            class="stage-btn"
            :to="`/workflows/${resp.workflow.flow_id}`"
            data-testid="stage-workflow-enter"
          >进入向导</router-link>
        </div>

        <!-- answer / insufficient -->
        <template v-else-if="resp?.status === 'answer' || resp?.status === 'insufficient'">
          <!-- W5：办理地点（place 在本包时）/ 换过去的钮（楼在另一个沙盘时） -->
          <div v-if="stage.place" ref="placeEl" class="stage-place" data-testid="stage-panel-place">
            <p class="stage-subtitle">办理地点</p>
            <p class="stage-place-line">
              <span class="stage-place-square" aria-hidden="true"></span>{{ stage.place.name }}
            </p>
            <p v-if="placeZoneName" class="stage-place-zone">{{ placeZoneName }}</p>
          </div>
          <button
            v-else-if="stage.otherPack"
            type="button"
            class="stage-other-pack"
            data-testid="stage-other-pack"
            @click="goOtherPack"
          >这栋楼在{{ otherPackName }}，点这里换过去</button>

          <p v-if="resp.status === 'insufficient'" class="stage-panel-text">{{ insufficientText }}</p>
          <p v-if="missingText" class="stage-panel-text soft">{{ missingText }}</p>

          <template v-if="resp.status === 'answer' && resp.answer">
            <p class="stage-subtitle">回答</p>
            <AnswerBlocks
              :blocks="resp.answer.blocks"
              :citations="resp.citations"
              @cite="onCite"
            />
          </template>

          <template v-if="resp.citations.length > 0">
            <p class="stage-subtitle">官方出处</p>
            <div class="stage-docs">
              <article
                v-for="(c, i) in resp.citations"
                :key="c.id"
                class="stage-doc"
                :class="{ 'is-open': openDoc === c.id }"
                :data-testid="`stage-doc-${i + 1}`"
                :data-doc-id="c.id"
                @click="toggleDoc(c.id)"
              >
                <img
                  class="stage-doc-stamp"
                  src="/campus3d/ui/stamp.svg"
                  alt="已审定"
                  width="50"
                  height="50"
                />
                <h3 class="stage-doc-title">{{ c.title }}</h3>
                <p class="stage-doc-sub">{{ docOf(c) }}</p>
                <p v-if="c.time_condition" class="stage-doc-time">{{ c.time_condition }}</p>
                <div v-if="openDoc === c.id" class="stage-doc-extra">
                  <p v-if="c.excerpt" class="stage-doc-excerpt">{{ c.excerpt }}</p>
                  <router-link
                    class="stage-doc-link"
                    :to="`/sources/${encodeURIComponent(c.id)}`"
                    @click.stop
                  >看原文</router-link>
                </div>
              </article>
            </div>
          </template>
        </template>

        <!-- done 但没有可展示的正文（兜底） -->
        <p v-else-if="lastAssistant.status === 'done'" class="stage-panel-text">{{ lastAssistant.text }}</p>
      </div>

      <footer class="stage-panel-foot">
        <span class="stage-panel-note">回答依据官方审定资料生成；没有采集到的信息会写明不足。</span>
        <span class="stage-panel-links">
          <router-link class="stage-link" to="/chat">全部对话</router-link>
          <button type="button" class="stage-link" data-testid="stage-restart" @click="store.newSession()">重新开始</button>
        </span>
      </footer>
    </section>

    <!-- W5：红色引线（连线层，fixed 全屏 svg，不设 viewBox） -->
    <svg v-if="leaderPoints" class="stage-leader" data-testid="stage-leader" aria-hidden="true">
      <polyline :points="leaderPoints" fill="none" stroke="var(--st-red)" stroke-width="1.2" />
      <rect :x="leaderEnd.x - 4" :y="leaderEnd.y - 4" width="8" height="8" fill="var(--st-red)" />
    </svg>
  </div>
</template>
