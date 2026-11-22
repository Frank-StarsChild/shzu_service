<script setup lang="ts">
// STAGE W4/W5：右侧回答面板（stage-panel）+ 上方用户问话条（stage-question）+ 红色引线。
// 只显示最后一轮；W5 起：place 不为空时最上面多一节「办理地点」（引线连到楼上），
// 楼在另一个沙盘时显示「换过去」的钮。样式在 stage.css。
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useChatStore, type ChatTurn } from "@/stores/chat";
import { useStageStore } from "@/stores/stage";
import type { StageCtx } from "@/stage/types";
import type { CitationRef } from "@/api/client";
import AnswerBlocks from "@/components/AnswerBlocks.vue";
import { setFlowPreset } from "@/stores/flowDraft";

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

/** 进入向导前登记聊天里自述过的身份事实（本科/二年级等），向导首屏待确认带入 */
function enterFlow(flowId: string, presetSlots?: Record<string, any> | null, presetNote?: string | null) {
  setFlowPreset(flowId, presetSlots, presetNote);
}

// ---- 沙盘办事单：errand（学生证补办等现场办理）/ repair（网络故障）卡片 ----
const stageActions = computed(() => (resp.value?.actions ?? []).filter((a) => a.kind === "errand" || a.kind === "repair"));

const SCOPE_TEXT: Record<string, string> = {
  single: "仅我的设备",
  multi: "多台设备都断网",
  unknown: "范围未确认",
};

/** 公告核对一句：库内命中 / 官网连不上 / 未找到，分开表达不说混 */
function repairAnnounce(a: { announcement?: any }): string {
  const ann = a.announcement;
  if (!ann) return "";
  if (ann.local) return "公告核对：库内命中，覆盖情况见正文";
  if (ann.web_state === "timeout" || ann.web_state === "error") return "官网暂时连不上，公告未能核实时以自查与报修为准";
  if (ann.web_state === "lead") return "未找到直接覆盖的公告（官网有更新线索）";
  return "未找到相关公告（不代表该区域无故障）";
}

/** 拨号链接：证据里可能带多个号码（如 2057898/2057899），取第一组再留数字，
 *  连字符（0993-2058029）不是分组符——它是同一个号码的一部分。 */
function telHref(phone: string | null | undefined): string {
  if (!phone) return "";
  const first = String(phone).split(/[/;；,，\s]+/)[0] || String(phone);
  return `tel:${first.replace(/[^0-9+]/g, "")}`;
}

const repairCopied = ref(false);
async function copyRepairDraft(text: string | null | undefined) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  repairCopied.value = true;
  setTimeout(() => { repairCopied.value = false; }, 2500);
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
  // 「引号里是 packs.json 里那个包的 name」——不是校区名，也不是包 id；
  // all 等默认包在 campuses 里没有对应校区，必须查包表
  return stage.packs.find((p) => p.id === op.packId)?.name ?? op.packId;
});

/** 点「换过去」：换包，等新场景 ready 后再把那栋楼的答案态补上
 *  （W10：等待逻辑与 enterPlace 共用 store.waitPackThenShow，不另写一份） */
function goOtherPack() {
  const op = stage.otherPack;
  if (!op) return;
  const seq = stage.placeSeq;
  stage.switchPack(op.packId);
  void stage.waitPackThenShow(op.packId, op.buildingId, seq);
}

/** W10：这栋楼可以「近看」吗（在另一个非默认包上有它的片区） */
const nearPack = computed(() => stage.nearPack);

/** W11：收起/展开右侧回答。只改显示状态：会话、request_id、生成进度、已展开引用
 *  与滚动位置都在（v-show 保留 DOM）；重新展开不再向后端发同一个请求。 */
const expandBtnEl = ref<HTMLButtonElement | null>(null);
const collapseBtnEl = ref<HTMLButtonElement | null>(null);

function collapse() {
  stage.setAnswerOpen(false);
  // 焦点从已隐藏的内容移到「展开对话」，避免留在 display:none 里
  void nextTick(() => expandBtnEl.value?.focus());
}

function expand() {
  stage.setAnswerOpen(true);
  void nextTick(() => collapseBtnEl.value?.focus());
}

// ---- W5：红色引线。三个点：「办理地点」左缘往下 36px → 往左 70px → 楼的 anchor 往下 6
// 投影后再往右 30px。每帧重算；「办理地点」滚出面板可见范围时隐藏；
// W11：面板已收起或楼栋投影出界时也隐藏。----
const placeEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const leaderPoints = ref("");
const leaderEnd = ref({ x: 0, y: 0 });

function updateLeader() {
  if (!stage.place || !stage.answerOpen) {
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
  if (!ap.visible) {
    // W11：楼栋投影出界（被拖到画面外）时引线失去意义，一并隐藏
    leaderPoints.value = "";
    return;
  }
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
    <!-- W11：收起后只留一个小按钮（在全站顶栏下方，不挡主题开关），点开恢复刚才那轮 -->
    <button
      v-if="!stage.answerOpen"
      ref="expandBtnEl"
      type="button"
      class="stage-answer-expand"
      data-testid="stage-answer-expand"
      aria-expanded="false"
      aria-controls="stage-answer-body"
      @click="expand"
    >展开对话</button>

    <!-- v-show 保留 DOM：滚动位置、已展开的公文卡、焦点上下文都在 -->
    <div v-show="stage.answerOpen" class="stage-answer-body" id="stage-answer-body">
      <!-- 用户的问话（面板上方一小条宣纸；与面板同一纵向布局，长问题自然换行） -->
      <p v-if="lastUser" class="stage-question" data-testid="stage-question">{{ lastUser.text }}</p>

      <section class="stage-panel" data-testid="stage-panel">
        <i class="stage-corner c-tl" aria-hidden="true"></i>
        <i class="stage-corner c-tr" aria-hidden="true"></i>
        <i class="stage-corner c-bl" aria-hidden="true"></i>
        <i class="stage-corner c-br" aria-hidden="true"></i>

        <header class="stage-panel-head">
          <h2 class="stage-panel-title">{{ title }}</h2>
          <span v-if="metaText" class="stage-panel-meta">{{ metaText }}</span>
          <!-- W11：收起回答（只改显示状态；保留会话、生成进度与引用） -->
          <button
            ref="collapseBtnEl"
            type="button"
            class="stage-panel-collapse"
            data-testid="stage-answer-collapse"
            aria-expanded="true"
            aria-controls="stage-answer-body"
            @click="collapse"
          >收起</button>
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
            @click="enterFlow(resp.workflow.flow_id, resp.workflow.preset_slots, resp.workflow.preset_note)"
          >进入向导</router-link>
        </div>

        <!-- answer / insufficient -->
        <template v-else-if="resp?.status === 'answer' || resp?.status === 'insufficient'">
          <!-- W5：办理地点（place 在本包时）/ 换过去的钮（楼在另一个沙盘时） -->
          <div v-if="stage.place" ref="placeEl" class="stage-place" data-testid="stage-panel-place">
            <p class="stage-subtitle">办理地点</p>
            <p class="stage-place-line">
              <span class="stage-place-square" aria-hidden="true"></span>{{ stage.place.name }}
              <!-- W10：楼名右边的「近看」钮（当前是默认包且楼在另一个非默认包上时） -->
              <button
                v-if="nearPack"
                type="button"
                class="stage-place-near"
                data-testid="stage-place-near"
                @click="stage.enterPlace()"
              >近看</button>
            </p>
            <p v-if="placeZoneName" class="stage-place-zone">{{ placeZoneName }}</p>
          </div>
          <button
            v-else-if="stage.otherPack"
            type="button"
            class="stage-other-pack"
            data-testid="stage-other-pack"
            @click="goOtherPack"
          >这栋楼在「{{ otherPackName }}」沙盘上，点这里换过去</button>

          <p v-if="resp.status === 'insufficient'" class="stage-panel-text">{{ insufficientText }}</p>
          <p v-if="missingText" class="stage-panel-text soft">{{ missingText }}</p>

          <!-- 沙盘办事单：errand（场景一）/ repair（场景二）卡片，先于长正文（去哪/带什么/报修入口优先） -->
          <div v-for="(a, ai) in stageActions" :key="'act' + ai" class="stage-act" :data-testid="`stage-act-${a.kind}`">
            <!-- 场景一：现场办事单（具体地点→负责部门→出发前确认；正文与官方原文在其后） -->
            <template v-if="a.kind === 'errand'">
              <p class="stage-subtitle">办事单 · 到楼办理</p>
              <p class="stage-act-place" data-testid="stage-errand-place">
                <strong class="stage-act-building">{{ a.place?.building || "地点待确认" }}</strong>
                <strong v-if="a.place?.room" class="stage-act-room">{{ a.place.room }}</strong>
                <span v-if="a.place?.campus" class="stage-act-meta">{{ a.place.campus }}校区</span>
              </p>
              <p class="stage-act-line">{{ a.dept || "以现场公示为准" }}<template v-if="a.service_scope"> · {{ a.service_scope }}</template></p>
              <p class="stage-act-line">
                <a v-if="a.phone" class="stage-act-phone" data-testid="stage-errand-phone"
                   :href="telHref(a.phone)">{{ a.phone }}</a>
                <span v-else class="stage-act-meta">电话见证据原文</span>
                <span v-if="!a.hours" class="stage-act-meta"> · 办公时间待向办公室确认</span>
              </p>
              <ul v-if="a.confirms?.length" class="stage-act-confirms" data-testid="stage-errand-confirms">
                <li v-for="(c, ci) in a.confirms" :key="ci">{{ c.text }}</li>
              </ul>
              <p v-if="a.materials_confirmed === false" class="stage-act-meta">补办材料需向办公室确认，请先电话核实后再去。</p>
            </template>

            <!-- 场景二：网络故障（已识别楼栋+范围→公告核对→下一项自查→报修入口→可复制草稿） -->
            <template v-else-if="a.kind === 'repair'">
              <p class="stage-subtitle">网络故障 · 报修</p>
              <p v-if="a.identified && (a.identified.campus || a.identified.building)" class="stage-act-line">
                {{ a.identified.building || a.identified.campus }}
                <span class="stage-act-meta"> · {{ SCOPE_TEXT[a.identified.device_scope as string] ?? "范围未确认" }}</span>
              </p>
              <p class="stage-act-line">{{ repairAnnounce(a) }}</p>
              <ol v-if="a.steps?.length" class="stage-act-steps" data-testid="stage-repair-steps">
                <li v-for="(s, si) in a.steps.slice(0, 3)" :key="si">{{ s.text }}</li>
              </ol>
              <p v-if="a.entry" class="stage-act-line">
                {{ a.entry.label }}
                <a v-if="a.entry.phone" class="stage-act-phone" data-testid="stage-repair-phone"
                   :href="telHref(a.entry.phone)">{{ a.entry.phone }}</a>
              </p>
              <button v-if="a.draft" type="button" class="stage-act-copy" data-testid="stage-repair-copy"
                      @click="copyRepairDraft(a.draft)">{{ repairCopied ? "已复制报修草稿 ✓" : "复制报修草稿" }}</button>
            </template>
          </div>

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

      <!-- W5：红色引线（连线层，fixed 全屏 svg，不设 viewBox；随面板一起收起） -->
      <svg v-if="leaderPoints" class="stage-leader" data-testid="stage-leader" aria-hidden="true">
        <polyline :points="leaderPoints" fill="none" stroke="var(--st-red)" stroke-width="1.2" />
        <rect :x="leaderEnd.x - 4" :y="leaderEnd.y - 4" width="8" height="8" fill="var(--st-red)" />
      </svg>
    </div>
  </div>
</template>

<style scoped>
/* W11：收起按钮——同「近看」小钮的小号版本，随日/夜主题令牌换色 */
.stage .stage-panel-collapse {
  flex: none;
  background: none;
  border: 1px solid var(--st-gold3);
  border-radius: 0;
  font-family: var(--st-hei);
  font-size: 11px;
  letter-spacing: 0.2em;
  color: var(--st-moon2);
  padding: 3px 10px;
  cursor: pointer;
}
.stage .stage-panel-collapse:hover {
  border-color: var(--st-gold2);
  color: var(--st-moon);
}
.stage .stage-panel-collapse:focus-visible {
  outline: 1px solid var(--st-gold2);
  outline-offset: 2px;
}
/* W10：「近看」小钮——样式同左侧校区列表里的「近看」，但是横排：
   宋体 600 12.5px、字距 0.34em、金色字、1px 金色边、内边距 3px 8px、直角。 */
.stage .stage-place-near {
  margin-left: 10px;
  padding: 3px 8px;
  background: none;
  border: 1px solid var(--st-gold);
  border-radius: 0;
  font-family: var(--st-song);
  font-weight: 600;
  font-size: 12.5px;
  letter-spacing: 0.34em;
  color: var(--st-gold);
  cursor: pointer;
  vertical-align: middle;
}
.stage .stage-place-near:hover {
  border-color: var(--st-gold2);
  color: var(--st-gold2);
}
.stage .stage-place-near:focus-visible {
  outline: 1px solid var(--st-gold2);
  outline-offset: 2px;
}

/* 沙盘办事单（errand/repair 紧凑卡）：楼名/房间/电话大字优先，随日/夜主题令牌换色 */
.stage-act {
  border: 1px solid color-mix(in srgb, var(--st-gold3) 70%, transparent);
  background: color-mix(in srgb, var(--st-moon2, transparent) 55%, transparent);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.stage-act-place {
  margin: 0;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.stage-act-building { font-family: var(--st-hei); font-size: 17px; letter-spacing: 0.04em; }
.stage-act-room {
  font-family: var(--st-song);
  font-size: 20px;
  font-weight: 700;
  color: var(--st-red);
  letter-spacing: 0.06em;
}
.stage-act-meta { font-size: 12px; color: var(--st-moon2); }
.stage-act-line {
  margin: 0;
  font-family: var(--st-song);
  font-size: 13px;
  line-height: 1.65;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: baseline;
}
.stage-act-phone {
  font-family: var(--st-hei);
  font-size: 15px;
  font-weight: 700;
  color: var(--st-red);
  text-decoration: underline;
  letter-spacing: 0.05em;
}
.stage-act-confirms,
.stage-act-steps {
  margin: 2px 0 0;
  padding: 6px 0 0 16px;
  font-family: var(--st-song);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--st-moon2);
  border-top: 1px dashed color-mix(in srgb, var(--st-gold3) 60%, transparent);
}
.stage-act-copy {
  align-self: flex-start;
  background: none;
  border: 1px solid var(--st-gold3);
  border-radius: 0;
  font-family: var(--st-hei);
  font-size: 12px;
  letter-spacing: 0.18em;
  color: var(--st-moon2);
  padding: 3px 10px;
  cursor: pointer;
}
.stage-act-copy:hover { border-color: var(--st-gold2); color: var(--st-moon); }
.stage-act-copy:focus-visible { outline: 1px solid var(--st-gold2); outline-offset: 2px; }
</style>
