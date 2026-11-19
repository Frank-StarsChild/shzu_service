<script setup lang="ts">
import { ref, nextTick, onMounted, watch, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useChatStore } from "@/stores/chat";
import { useKbMeta } from "@/composables";
import type { CitationRef } from "@/api/client";
import AnswerBlocks from "@/components/AnswerBlocks.vue";
import EvidencePanel from "@/components/EvidencePanel.vue";

const route = useRoute();
const router = useRouter();
const store = useChatStore();
const { ready } = useKbMeta();

const input = ref("");
const activeCitation = ref<CitationRef | null>(null);
const bottomEl = ref<HTMLElement | null>(null);

const lastTiming = computed(() => {
  for (let i = store.turns.length - 1; i >= 0; i--) {
    const t = store.turns[i];
    if (t.response?.timing_ms) return t.response.timing_ms;
  }
  return null;
});

function citationById(respList: CitationRef[], id: string): CitationRef | undefined {
  return respList.find((c) => c.id === id);
}

function showCite(resp: any, id: string) {
  const c = citationById(resp?.citations || [], id);
  if (c) activeCitation.value = c;
}

async function scrollBottom() {
  await nextTick();
  bottomEl.value?.scrollIntoView({ behavior: "smooth", block: "end" });
}

async function submit() {
  const text = input.value.trim();
  if (!text || store.busy) return;
  input.value = "";
  await store.send(text);
  scrollBottom();
}

async function retry(requestId: string) {
  await store.retry(requestId);
  scrollBottom();
}

function newSession() {
  activeCitation.value = null;
  store.newSession();
}

onMounted(async () => {
  const q = route.query.q;
  await store.restore();
  if (typeof q === "string" && q.trim()) {
    router.replace({ query: {} });
    if (!store.busy) {
      await store.send(q);
    }
  }
});

watch(() => store.turns.length, () => { scrollBottom(); }, { flush: "post" });

const SAMPLES_EMPTY = [
  "国家励志奖学金要什么条件？",
  "我是本科生，一次能借几本书？",
  "补办学生证怎么办？",
];
</script>

<template>
  <div class="page shell" style="padding-top: var(--gap-5);">
    <!-- 页头 -->
    <div class="page-head" style="display: grid; grid-template-columns: 1fr auto; align-items: end;">
      <div>
        <p class="index">02 — 校园对话</p>
        <h1 class="h1">问答 · 每条结论都有出处</h1>
      </div>
      <div style="display: flex; gap: var(--gap-3); align-items: center;">
        <button type="button" class="btn-sm" @click="newSession">新建会话</button>
      </div>
    </div>

    <div class="chat-layout">
      <!-- 左：时间线 + 输入 -->
      <section>
        <div class="status-strip tiny">
          <span>会话 <span class="mono">{{ store.sessionId ? store.sessionId.slice(0, 18) : "…" }}</span></span>
          <span v-if="ready">知识库 {{ ready.knowledge_version }}</span>
          <span v-if="lastTiming != null">最近回答 {{ lastTiming }} ms</span>
          <span v-if="store.busy">正在回答…</span>
        </div>

        <!-- 空态 -->
        <div v-if="store.turns.length === 0" class="box-soft">
          <div class="box-head"><span class="label">开始提问</span></div>
          <div class="box-body">
            <p class="muted small">支持自然的中文提问，也可以点下面的例子直接开始。涉及"哪一年/哪个学期"的问题请说明时间，
              带时间条件的回答会在要点前提示适用期。</p>
            <div style="display: flex; flex-wrap: wrap; gap: var(--gap-2);">
              <button v-for="s in SAMPLES_EMPTY" :key="s" type="button" class="btn-sm" @click="store.send(s)">{{ s }}</button>
            </div>
          </div>
        </div>

        <!-- 时间线 -->
        <div v-else class="timeline">
          <div v-for="t in store.turns" :key="t.request_id + t.role + t.seq"
               class="turn" :class="{ user: t.role === 'user' }">
            <div class="who">{{ t.role === "user" ? "STUDENT" : "AGENT" }}</div>
            <div class="turn-body">
              <!-- 用户消息 -->
              <div v-if="t.role === 'user'">{{ t.text }}</div>

              <!-- 助手：等待 -->
              <template v-else-if="t.status === 'pending'">
                <div class="pending-line">
                  <span class="pending-block"></span><span class="pending-block d1"></span><span class="pending-block d2"></span>
                  <span class="muted small">正在检索审定资料并组织回答…</span>
                </div>
                <button type="button" class="btn-sm no-print" @click="store.cancel()">不再等待</button>
              </template>

              <!-- 助手：取消 -->
              <template v-else-if="t.status === 'cancelled'">
                <div class="box-fill box-body" style="border: 1px solid var(--line-soft); padding: var(--gap-3);">
                  <span class="muted small">已取消本轮回答。</span>
                </div>
              </template>

              <!-- 助手：错误 -->
              <template v-else-if="t.status === 'error'">
                <div class="box" style="border-color: var(--red);">
                  <div class="box-body">
                    <span class="err-text">{{ t.errorText }}</span>
                    <div>
                      <button type="button" class="btn-sm" @click="retry(t.request_id)">重试</button>
                      <button v-if="store.sessionInvalid" type="button" class="btn-sm btn-red" style="margin-left: 8px;" @click="newSession">新建会话</button>
                    </div>
                  </div>
                </div>
              </template>

              <!-- 助手：完成，按 status 渲染 -->
              <template v-else-if="t.response">
                <!-- answer：正文为后端校验后的模型 reply（blocks），引用角标由后端按 ID 填充 -->
                <template v-if="t.response.status === 'answer' && t.response.answer">
                  <AnswerBlocks :blocks="t.response.answer.blocks" :citations="t.response.citations"
                                @cite="(id) => showCite(t.response, id)" />
                  <div class="cite-list">
                    <button v-for="(c, i) in t.response.citations" :key="c.id" type="button" class="cite-item"
                            :class="{ active: activeCitation?.id === c.id }" @click="showCite(t.response, c.id)">
                      <span class="cite-id">[{{ i + 1 }}] {{ c.id }}</span>
                      <span>
                        <span class="small">{{ c.title }}</span><br />
                        <span class="tiny">{{ c.issuer }}<template v-if="c.locator"> · {{ c.locator }}</template></span>
                      </span>
                    </button>
                  </div>
                </template>

                <!-- clarify：追问问题与选项均由模型当轮生成 -->
                <div v-else-if="t.response.status === 'clarify' && t.response.clarify" class="clarify-box">
                  <div class="clarify-q">{{ t.response.clarify.question }}</div>
                  <div class="clarify-opts">
                    <button v-for="opt in t.response.clarify.choices" :key="opt.id" type="button"
                            @click="store.pickChoice(opt.id)">{{ opt.label }}</button>
                  </div>
                  <p v-if="!t.response.clarify.choices.length && t.response.clarify.input_hint" class="tiny muted" style="margin: 6px 0 0;">
                    {{ t.response.clarify.input_hint }}
                  </p>
                </div>

                <!-- insufficient：正文为模型 reply（不再按原因码在前端覆盖文案） -->
                <div v-else-if="t.response.status === 'insufficient'" class="box-fill" style="padding: var(--gap-4);">
                  <span class="tag tag-soft">资料不足</span>
                  <p class="small" style="margin: 6px 0 0; white-space: pre-line;">{{ t.response.message }}</p>
                  <p v-if="t.response.unknown_fields && t.response.unknown_fields.length" class="tiny muted" style="margin: 6px 0 0;">
                    待获取：{{ t.response.unknown_fields.join("；") }}
                  </p>
                  <div v-if="t.response.citations && t.response.citations.length" class="cite-list">
                    <button v-for="(c, i) in t.response.citations" :key="c.id" type="button" class="cite-item"
                            :class="{ active: activeCitation?.id === c.id }" @click="showCite(t.response, c.id)">
                      <span class="cite-id">[{{ i + 1 }}] {{ c.id }}</span>
                      <span>
                        <span class="small">{{ c.title }}</span><br />
                        <span class="tiny">参考来源 · {{ c.issuer }}<template v-if="c.time_condition"> · {{ c.time_condition }}</template></span>
                      </span>
                    </button>
                  </div>
                </div>

                <!-- error：技术错误状态（模型不可用/超时/输出未过校验），显示失败与重试入口；
                     model_unavailable 为旧记录兼容 -->
                <div v-else-if="t.response.status === 'error' || t.response.status === 'model_unavailable'" class="box" style="border-color: var(--red);">
                  <div class="box-head" style="border-bottom-color: var(--red);">
                    <span class="label">本轮未能生成回复</span>
                    <span class="tag tag-red">技术错误</span>
                  </div>
                  <div class="box-body">
                    <p class="small" style="margin: 0;">{{ t.response.message }}</p>
                    <p v-if="t.response.reason_code" class="tiny muted" style="margin: 6px 0 0;">错误码：{{ t.response.reason_code }}</p>
                    <button type="button" class="btn-red btn-sm" style="align-self: flex-start;"
                            @click="retry(t.request_id)">重试这条对话</button>
                  </div>
                </div>

                <!-- out_of_scope：正文为模型 reply -->
                <div v-else-if="t.response.status === 'out_of_scope'" class="box-fill" style="padding: var(--gap-4);">
                  <span class="tag tag-soft">超出范围</span>
                  <p class="small" style="margin: 6px 0 0; white-space: pre-line;">{{ t.response.message }}</p>
                </div>

                <!-- workflow：向导摘要为模型 reply（不再替换固定文案） -->
                <div v-else-if="t.response.status === 'workflow' && t.response.workflow" class="box">
                  <div class="box-head">
                    <span class="label">办事向导</span>
                    <span v-if="t.response.workflow.historical" class="tag tag-red">历史演示</span>
                  </div>
                  <div class="box-body">
                    <h3 class="h3">{{ t.response.workflow.name }}</h3>
                    <p class="muted small" style="margin: 0; white-space: pre-line;">{{ t.response.workflow.summary }}</p>
                    <button type="button" class="btn-red btn-sm" style="align-self: flex-start;"
                            @click="router.push(`/workflows/${t.response!.workflow!.flow_id}`)">进入向导 →</button>
                  </div>
                </div>

                <!-- 兜底：历史记录无 message 时显示存档文本 -->
                <div v-else class="muted small">{{ t.response.message || t.text }}</div>
              </template>
            </div>
          </div>
        </div>

        <!-- 输入区 -->
        <div style="margin-top: var(--gap-4);">
          <form class="composer" @submit.prevent="submit">
            <input v-model="input" type="text" :disabled="store.busy"
                   placeholder="继续提问…（Enter 发送）" aria-label="输入问题" />
            <button type="submit" :disabled="store.busy || !input.trim()">发送</button>
          </form>
          <button v-if="store.busy" type="button" class="btn-sm no-print" style="margin-top: 8px;"
                  @click="store.cancel()">取消当前回答</button>
          <p class="tiny" style="margin-top: 8px;">
            回答由官方审定资料生成；未采集的信息会明确标注"不足"，不使用推测填充。
          </p>
        </div>
        <div ref="bottomEl"></div>
      </section>

      <!-- 右：证据面板 -->
      <aside>
        <EvidencePanel :citation="activeCitation" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.pending-line { display: flex; align-items: center; gap: 6px; }
.pending-block {
  width: 10px; height: 10px; background: var(--ink); display: inline-block;
  animation: pb 900ms steps(3, end) infinite;
}
.pending-block.d1 { background: var(--red); animation-delay: 300ms; }
.pending-block.d2 { background: var(--ink-3); animation-delay: 600ms; }
@keyframes pb {
  0% { opacity: 0.15; } 50% { opacity: 1; } 100% { opacity: 0.15; }
}
</style>
