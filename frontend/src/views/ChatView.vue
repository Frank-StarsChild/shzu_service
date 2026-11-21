<script setup lang="ts">
import { ref, nextTick, onMounted, onBeforeUnmount, watch, computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useChatStore, type ChatTurn } from "@/stores/chat";
import { useKbMeta } from "@/composables";
import type { CitationRef, ChatResponse } from "@/api/client";
import AnswerBlocks from "@/components/AnswerBlocks.vue";
import EvidencePanel from "@/components/EvidencePanel.vue";
import ActionCards from "@/components/ActionCards.vue";

const route = useRoute();
const router = useRouter();
const store = useChatStore();
const { ready } = useKbMeta();

const input = ref("");
/** 桌面端（>1100px）右侧证据面板当前展示的出处 */
const activeCitation = ref<CitationRef | null>(null);
/** 窄屏端：在某条消息附近展开的内联出处卡（key=turnKey） */
const mobileCite = ref<{ key: string; citation: CitationRef } | null>(null);
/** 每条消息的出处清单折叠态（默认收起，正文旁角标始终可直接点） */
const citeFold = ref<Record<string, boolean>>({});
const bottomEl = ref<HTMLElement | null>(null);
const taRef = ref<HTMLTextAreaElement | null>(null);

const lastTiming = computed(() => {
  for (let i = store.turns.length - 1; i >= 0; i--) {
    const t = store.turns[i];
    if (t.response?.timing_ms) return t.response.timing_ms;
  }
  return null;
});

function turnKey(t: ChatTurn): string {
  return `${t.request_id}:${t.seq}`;
}

function citationById(resp: ChatResponse | null, id: string): CitationRef | undefined {
  return resp?.citations?.find((c) => c.id === id);
}

/** 点正文旁角标或清单项：桌面右侧面板与窄屏内联卡指向同一条出处 */
function onCite(t: ChatTurn, id: string) {
  const c = citationById(t.response, id);
  if (!c) return;
  activeCitation.value = c;
  mobileCite.value = { key: turnKey(t), citation: c };
}

function closeMobileCite() {
  mobileCite.value = null;
}

/** 纯聊天式回答：无任何引用且全部为 note 块 → 直接显示正文，不套结构卡片 */
function isPlainAnswer(resp: ChatResponse | null): boolean {
  if (!resp || resp.status !== "answer" || !resp.answer) return false;
  if ((resp.citations ?? []).length > 0) return false;
  return resp.answer.blocks.every((b) => b.kind === "note" && !(b.citation_ids ?? []).length);
}

function plainText(resp: ChatResponse): string {
  return resp.message || resp.answer?.blocks.map((b) => b.text).join("\n") || "";
}

/** 只有最新一条未被回答的追问可点选项；历史追问仅供查看（不重复发起） */
function clarifyActive(t: ChatTurn): boolean {
  const lc = store.lastClarify;
  return !!lc && lc.request_id === t.response?.request_id;
}

function toggleCiteFold(t: ChatTurn) {
  const k = turnKey(t);
  citeFold.value[k] = !citeFold.value[k];
}

// ---------- 滚动：跟底但不打扰阅读 ----------
let nearBottom = true;
function onScroll() {
  nearBottom =
    window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 140;
}

async function scrollBottom(force = false) {
  if (!force && !nearBottom) return;
  await nextTick();
  bottomEl.value?.scrollIntoView({ behavior: "smooth", block: "end" });
}

// 新增一条（用户气泡 / 助手等待占位）：在底部附近才跟随
watch(() => store.turns.length, () => { void scrollBottom(false); }, { flush: "post" });
// 助手回复到达（长度不变、内容撑高）：同样只在底部附近才跟随
watch(() => store.busy, (b, ob) => { if (ob && !b) void scrollBottom(false); }, { flush: "post" });

// ---------- 输入 ----------
function autoGrow() {
  const el = taRef.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = Math.min(el.scrollHeight, 168) + "px";
}

async function submit() {
  const text = input.value.trim();
  if (!text || store.busy) return;
  input.value = "";
  await nextTick();
  autoGrow();
  nearBottom = true; // 用户刚发消息 → 跟到底
  await store.send(text);
  await scrollBottom(true);
}

/** Enter 发送；Shift+Enter 换行；中文输入法组字期间 Enter 只确认候选词 */
function onKeydown(e: KeyboardEvent) {
  if (e.key !== "Enter" || e.shiftKey) return;
  if (e.isComposing || e.keyCode === 229) return;
  e.preventDefault();
  void submit();
}

async function sendSample(s: string) {
  if (store.busy || !s.trim()) return;
  nearBottom = true;
  await store.send(s);
  await scrollBottom(true);
}

async function retry(requestId: string) {
  nearBottom = true;
  await store.retry(requestId);
  await scrollBottom(true);
}

function newSession() {
  activeCitation.value = null;
  mobileCite.value = null;
  citeFold.value = {};
  store.newSession();
}

onMounted(async () => {
  window.addEventListener("scroll", onScroll, { passive: true });
  const q = route.query.q;
  await store.restore();
  await scrollBottom(true);
  if (typeof q === "string" && q.trim()) {
    router.replace({ query: {} });
    if (!store.busy) {
      await store.send(q);
      await scrollBottom(true);
    }
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("scroll", onScroll);
});

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
      <!-- 左：消息时间线 + 输入 -->
      <section class="chat-main">
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
              <button v-for="s in SAMPLES_EMPTY" :key="s" type="button" class="btn-sm" @click="sendSample(s)">{{ s }}</button>
            </div>
          </div>
        </div>

        <!-- 时间线：用户气泡靠聊天列右边，助手正文与操作在左 -->
        <div v-else class="timeline">
          <div v-for="t in store.turns" :key="t.request_id + t.role + t.seq"
               class="turn" :class="t.role === 'user' ? 'turn-user' : 'turn-agent'">

            <!-- 用户消息：气泡靠右（聊天列内），文字仍左对齐 -->
            <div v-if="t.role === 'user'" class="user-row">
              <span class="sr-only">用户提问</span>
              <div class="user-bubble">{{ t.text }}</div>
            </div>

            <!-- 助手消息 -->
            <div v-else class="turn-body agent-body">
              <!-- 等待 -->
              <template v-if="t.status === 'pending'">
                <div class="pending-line">
                  <span class="pending-block"></span><span class="pending-block d1"></span><span class="pending-block d2"></span>
                  <span class="muted small">正在检索审定资料并组织回答…</span>
                </div>
                <button type="button" class="btn-sm no-print" @click="store.cancel()">不再等待</button>
              </template>

              <!-- 已取消 -->
              <template v-else-if="t.status === 'cancelled'">
                <div class="box-fill box-body" style="border: 1px solid var(--line-soft); padding: var(--gap-3);">
                  <span class="muted small">已取消本轮回答。</span>
                </div>
              </template>

              <!-- 网络层失败（超时/断网等） -->
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

              <!-- 完成：按接口 status 渲染，每种只显示它实际需要的部分 -->
              <template v-else-if="t.response">
                <!-- answer：纯对话（无引用/全 note 块）→ 干净显示正文 -->
                <p v-if="isPlainAnswer(t.response)" class="agent-plain">{{ plainText(t.response) }}</p>

                <!-- answer：带要点/引用结构 -->
                <template v-else-if="t.response.status === 'answer' && t.response.answer">
                  <AnswerBlocks :blocks="t.response.answer.blocks" :citations="t.response.citations"
                                @cite="(id) => onCite(t, id)" />
                  <div v-if="t.response.citations.length" class="cite-fold">
                    <button type="button" class="cite-fold-head" @click="toggleCiteFold(t)">
                      <span class="mono">出处 ({{ t.response.citations.length }})</span>
                      <span class="tiny muted">{{ citeFold[turnKey(t)] ? "收起 ▲" : "展开 ▼" }}</span>
                    </button>
                    <div v-if="citeFold[turnKey(t)]" class="cite-list">
                      <button v-for="(c, i) in t.response.citations" :key="c.id" type="button" class="cite-item"
                              :class="{ active: activeCitation?.id === c.id }" @click="onCite(t, c.id)">
                        <span class="cite-id">[{{ i + 1 }}] {{ c.id }}</span>
                        <span>
                          <span class="small">{{ c.title }}</span><br />
                          <span class="tiny">{{ c.issuer }}<template v-if="c.locator"> · {{ c.locator }}</template></span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <ActionCards v-if="t.response.actions?.length" :actions="t.response.actions"
                               @cite="(id) => onCite(t, id)" />
                </template>

                <!-- clarify：显示本轮追问与选项；进行中/旧追问不可再点 -->
                <div v-else-if="t.response.status === 'clarify' && t.response.clarify" class="clarify-box">
                  <div class="clarify-q">{{ t.response.clarify.question }}</div>
                  <div class="clarify-opts">
                    <button v-for="opt in t.response.clarify.choices" :key="opt.id" type="button"
                            :disabled="store.busy || !clarifyActive(t)"
                            :title="clarifyActive(t) ? '' : '该追问已回答，选项仅供查看'"
                            @click="store.pickChoice(opt.id)">{{ opt.label }}</button>
                  </div>
                  <p v-if="!t.response.clarify.choices.length && t.response.clarify.input_hint" class="tiny muted" style="margin: 6px 0 0;">
                    {{ t.response.clarify.input_hint }}
                  </p>
                  <p v-if="!clarifyActive(t)" class="tiny muted" style="margin: 6px 0 0;">该追问已回答，选项仅供查看。</p>
                  <ActionCards v-if="t.response.actions?.length" :actions="t.response.actions"
                               @cite="(id) => onCite(t, id)" />
                </div>

                <!-- insufficient：正文为模型 reply；有出处才展示出处 -->
                <div v-else-if="t.response.status === 'insufficient'" class="box-fill" style="padding: var(--gap-4);">
                  <span class="tag tag-soft">资料不足</span>
                  <p class="small" style="margin: 6px 0 0; white-space: pre-line;">{{ t.response.message }}</p>
                  <p v-if="t.response.unknown_fields && t.response.unknown_fields.length" class="tiny muted" style="margin: 6px 0 0;">
                    待获取：{{ t.response.unknown_fields.join("；") }}
                  </p>
                  <div v-if="t.response.citations && t.response.citations.length" class="cite-fold">
                    <button type="button" class="cite-fold-head" @click="toggleCiteFold(t)">
                      <span class="mono">参考出处 ({{ t.response.citations.length }})</span>
                      <span class="tiny muted">{{ citeFold[turnKey(t)] ? "收起 ▲" : "展开 ▼" }}</span>
                    </button>
                    <div v-if="citeFold[turnKey(t)]" class="cite-list">
                      <button v-for="(c, i) in t.response.citations" :key="c.id" type="button" class="cite-item"
                              :class="{ active: activeCitation?.id === c.id }" @click="onCite(t, c.id)">
                        <span class="cite-id">[{{ i + 1 }}] {{ c.id }}</span>
                        <span>
                          <span class="small">{{ c.title }}</span><br />
                          <span class="tiny">参考来源 · {{ c.issuer }}<template v-if="c.time_condition"> · {{ c.time_condition }}</template></span>
                        </span>
                      </button>
                    </div>
                  </div>
                  <ActionCards v-if="t.response.actions?.length" :actions="t.response.actions"
                               @cite="(id) => onCite(t, id)" />
                </div>

                <!-- error / model_unavailable：技术错误状态（模型不可用/超时/输出未过校验） -->
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

                <!-- out_of_scope：正文为模型 reply，不替换成前端固定文案 -->
                <div v-else-if="t.response.status === 'out_of_scope'" class="box-fill" style="padding: var(--gap-4);">
                  <span class="tag tag-soft">超出范围</span>
                  <p class="small" style="margin: 6px 0 0; white-space: pre-line;">{{ t.response.message }}</p>
                  <div v-if="t.response.citations && t.response.citations.length" class="cite-fold" style="margin-top: 8px;">
                    <button type="button" class="cite-fold-head" @click="toggleCiteFold(t)">
                      <span class="mono">参考出处 ({{ t.response.citations.length }})</span>
                      <span class="tiny muted">{{ citeFold[turnKey(t)] ? "收起 ▲" : "展开 ▼" }}</span>
                    </button>
                  </div>
                </div>

                <!-- workflow：事项名 + 模型摘要 + 进入向导（历史演示保留标记） -->
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

                <!-- 兜底：历史记录无结构时显示存档文本 -->
                <div v-else class="muted small" style="white-space: pre-line;">{{ t.response.message || t.text }}</div>

                <!-- 窄屏：出处在本条消息附近展开（可关闭，关闭后继续看这条消息） -->
                <div v-if="mobileCite && mobileCite.key === turnKey(t)" class="mobile-cite">
                  <div class="mobile-cite-head">
                    <span class="mono tiny">出处 {{ mobileCite.citation.id }}</span>
                    <button type="button" class="btn-sm" @click="closeMobileCite">关闭</button>
                  </div>
                  <EvidencePanel :citation="mobileCite.citation" />
                </div>
              </template>
            </div>
          </div>
        </div>

        <!-- 输入区：多行输入，Enter 发送 / Shift+Enter 换行 -->
        <div style="margin-top: var(--gap-4);">
          <form class="composer" @submit.prevent="submit">
            <textarea ref="taRef" v-model="input" rows="1"
                      placeholder="继续提问…（Enter 发送，Shift+Enter 换行）" aria-label="输入问题"
                      @keydown="onKeydown" @input="autoGrow"></textarea>
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

      <!-- 右：证据面板（窄屏隐藏，改用消息附近内联卡） -->
      <aside class="chat-aside">
        <EvidencePanel :citation="activeCitation" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* ---------- 本页消息行布局（覆盖全局 .turn 的 88px 角色栏双栏） ----------
   用户气泡靠聊天列右边；助手正文与操作在左。角色标识仅保留给读屏。 */
.timeline .turn {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 0;
  border-bottom: 1px solid var(--line-soft);
}
.timeline .turn:last-child { border-bottom: none; }

.user-row {
  display: flex;
  justify-content: flex-end; /* 气泡靠聊天列右边（列宽内，不进证据栏） */
  min-width: 0;
}
.user-bubble {
  max-width: min(72%, 560px); /* 随内容变宽，上限不顶满整列 */
  min-width: 0;
  padding: 10px 14px;
  background: var(--paper-2);
  border: 1px solid var(--line-soft);
  border-right: 3px solid var(--red);
  color: var(--ink);
  font-size: 15px;
  line-height: 1.65;
  white-space: pre-wrap;          /* 保留用户输入的换行 */
  overflow-wrap: anywhere;        /* 长句/无空格长串可折行 */
  word-break: break-word;
}

.agent-body { max-width: 100%; }
.agent-plain {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  white-space: pre-line;
  overflow-wrap: anywhere;
}

/* 角色标识：视觉隐藏、读屏可读（替代原 STUDENT/AGENT 固定栏） */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

/* 出处清单折叠（默认收起：正文旁角标已可直接点开出处） */
.cite-fold { border: 1px solid var(--line-soft); }
.cite-fold-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  width: 100%;
  padding: 8px 12px;
  background: none;
  border: none;
  text-align: left;
  min-height: 0;
}
.cite-fold-head:hover { background: var(--paper-2); }

/* 多行输入框（替换原单行 input） */
.composer textarea {
  border: none;
  min-height: 48px;
  max-height: 168px;
  font-size: 15px;
  line-height: 1.5;
  font-family: inherit;
  padding: 12px 14px;
  resize: none;
  overflow-y: auto;
}
.composer textarea:focus-visible { outline: none; }

/* 窄屏：出处改为本条消息附近的内联卡；右侧 aside 不再占位 */
.mobile-cite { display: none; }
.chat-aside { display: block; }
@media (max-width: 1100px) {
  .chat-aside { display: none; }
  .mobile-cite {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin-top: 8px;
    width: 100%;
  }
  .mobile-cite-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
}
@media (max-width: 720px) {
  .user-bubble { max-width: 88%; }
  .timeline .turn { padding: 10px 0; }
}

/* 等待动画（沿用原样式，搬进 scoped） */
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
