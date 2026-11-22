<script setup lang="ts">
// 场景动作卡片：材料核对（奖助学金）/ 网络报修分诊 / 沙盘定位。
// 数据全部来自后端工具核验过的 response.actions（不由模型生成）；正文仍由模型撰写。
// 事件：cite(evidenceId) 打开证据面板；进入向导/沙盘跳转由本组件使用 router。
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { ActionCard, ChecklistItem, PlaceMatch } from "@/api/client";
import { setFlowPreset } from "@/stores/flowDraft";

const props = defineProps<{ actions: ActionCard[] }>();
const emit = defineEmits<{ (e: "cite", id: string): void }>();

const router = useRouter();

// ---------- 核对清单 ----------
const CHIP: Record<ChecklistItem["state"], { label: string; cls: string }> = {
  verified: { label: "已有依据", cls: "st-ok" },
  needs_user: { label: "待您补充", cls: "st-user" },
  needs_college: { label: "待学院确认", cls: "st-college" },
  needs_web: { label: "待官网核实", cls: "st-web" },
};

// ---------- 报修草稿复制 ----------
const copied = ref(false);
async function copyDraft(text: string | null | undefined) {
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
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

const scopeText: Record<string, string> = {
  single: "仅我的设备",
  multi: "多台设备都断网",
  unknown: "范围未确认",
};

// 公告核对文案：库内命中 / 官网连不上 / 未找到公告 三种分开表达，不把连不上说成没有
function announceText(a: ActionCard): string {
  const ann = a.announcement;
  if (!ann) return "";
  if (ann.local) return "公告核对：库内命中，覆盖情况见下";
  if (ann.web_state === "timeout" || ann.web_state === "error") return "官网暂时连不上，公告未能核实时以库内与自查为准";
  if (ann.web_state === "lead") return "未找到直接覆盖的公告（官网有更新线索）";
  return "未找到相关公告（不代表该区域无故障）";
}

/** 进入向导：登记聊天里学生自述过的身份事实（本科/二年级等），向导首屏待确认带入 */
function enterFlow(flow: NonNullable<ActionCard["flow"]>) {
  setFlowPreset(flow.flow_id, flow.preset_slots, flow.preset_note);
  router.push(`/workflows/${flow.flow_id}`);
}

// errand 办事单：出发前确认事项的状态点色
const CONFIRM_DOT: Record<string, string> = {
  needs_user: "dot-needs_user",
  needs_office: "dot-partial",
  needs_college: "dot-partial",
};

// ---------- 沙盘定位 ----------
function viewSandbox(m: PlaceMatch) {
  if (!m.building_id) return;
  router.push({ path: "/", query: { focus: m.building_id } });
}
function focusable(m: PlaceMatch): boolean {
  return !!m.building_id;
}

const placeActions = computed(() => props.actions.filter((a) => a.kind === "place").slice(0, 1));
const mainActions = computed(() => props.actions.filter((a) => a.kind !== "place").slice(0, 1));
</script>

<template>
  <span v-if="actions.length">
    <!-- 主卡：核对清单 / 报修分诊 -->
    <div v-for="a in mainActions" :key="a.kind + (a.title ?? '')" class="action-card box">
      <template v-if="a.kind === 'checklist'">
        <div class="box-head act-head">
          <span class="label">{{ a.title || "材料核对" }}</span>
          <span class="tag" v-if="a.flow?.historical" style="background: var(--paper-3); color: var(--ink);">历史演示向导</span>
        </div>
        <div class="box-body">
          <p v-if="a.year != null" class="tiny muted" style="margin: 0 0 2px;">
            奖项：{{ a.award }} <span class="mono">{{ a.year }} 年度</span>
          </p>
          <p v-if="a.year_note" class="tiny" style="margin: 0 0 10px; white-space: pre-line;">{{ a.year_note }}</p>
          <ul class="ck-list">
            <li v-for="(it, i) in a.items" :key="i" class="ck-item">
              <span class="ck-chip" :class="CHIP[it.state]?.cls">{{ CHIP[it.state]?.label ?? "" }}</span>
              <div class="ck-text">
                <strong class="small">{{ it.label }}</strong>
                <span v-if="it.detail" class="tiny muted" style="display:block;">{{ it.detail }}</span>
                <div v-if="it.evidence_ids?.length" class="ck-refs">
                  <button v-for="eid in it.evidence_ids.slice(0, 3)" :key="eid" type="button"
                          class="ref-mini" :title="`查看证据 ${eid}`" @click="emit('cite', eid)">{{ eid }}</button>
                </div>
              </div>
            </li>
          </ul>
          <div v-if="a.entry" class="act-entry">
            <span class="small"><strong>官方入口</strong>：{{ a.entry.label }}
              <template v-if="a.entry.person">（{{ a.entry.person }}）</template>
            </span>
            <a v-if="a.entry.phone" class="mono" :href="`tel:${a.entry.phone.replace(/[^0-9+]/g, '')}`">{{ a.entry.phone }}</a>
            <div v-if="a.entry.evidence_ids?.length" class="ck-refs">
              <button v-for="eid in a.entry.evidence_ids.slice(0, 3)" :key="eid" type="button"
                      class="ref-mini" @click="emit('cite', eid)">{{ eid }}</button>
            </div>
          </div>
          <div v-if="a.flow" class="act-actions">
            <button type="button" class="btn-red btn-sm" data-testid="flow-enter"
                    @click="enterFlow(a.flow)">进入核对向导 →</button>
            <span v-if="a.flow.historical" class="tiny muted">（{{ a.flow.name }}，仅作历史参考）</span>
          </div>
        </div>
      </template>

      <template v-else-if="a.kind === 'repair'">
        <div class="box-head act-head">
          <span class="label">{{ a.title || "网络故障分类" }}</span>
          <span v-if="a.announcement" class="tiny" :class="a.announcement.local ? 'st-ok-text' : 'muted'">
            {{ announceText(a) }}
          </span>
        </div>
        <div class="box-body">
          <div v-if="a.identified && (a.identified.campus || a.identified.building)" class="act-tags">
            <span v-if="a.identified.campus" class="tag tag-soft">{{ a.identified.campus }}</span>
            <span v-if="a.identified.building" class="tag tag-soft">{{ a.identified.building }}</span>
            <span class="tag tag-soft">{{ scopeText[a.identified.device_scope as string] ?? "范围未确认" }}</span>
          </div>
          <ul v-if="a.checks?.length" class="ck-list tiny">
            <li v-for="(c, i) in a.checks" :key="i" class="ck-check">
              <span class="ck-dot" :class="`dot-${c.state}`"></span>
              <span class="muted">{{ c.label }}<template v-if="c.note"> —— {{ c.note }}</template></span>
            </li>
          </ul>
          <ol v-if="a.steps?.length" class="small" style="padding-left: 20px; margin: 8px 0; display:flex; flex-direction:column; gap:6px;">
            <li v-for="(s, i) in a.steps" :key="i">
              {{ s.text }}
              <button v-for="eid in (s.evidence_ids ?? []).slice(0, 2)" :key="eid" type="button"
                      class="ref-mini" @click="emit('cite', eid)">{{ eid }}</button>
            </li>
          </ol>
          <div v-if="a.entry" class="act-entry">
            <span class="small"><strong>官方报修入口</strong>：{{ a.entry.label }}</span>
            <a v-if="a.entry.phone" class="mono" :href="`tel:${a.entry.phone.replace(/[^0-9+]/g, '')}`">{{ a.entry.phone }}</a>
            <div v-if="a.entry.evidence_ids?.length" class="ck-refs">
              <button v-for="eid in a.entry.evidence_ids.slice(0, 3)" :key="eid" type="button"
                      class="ref-mini" @click="emit('cite', eid)">{{ eid }}</button>
            </div>
          </div>
          <div v-if="a.draft" class="act-draft">
            <div class="act-draft-head">
              <span class="label">报修草稿（未提交到任何系统）</span>
              <button type="button" class="btn-sm" data-testid="repair-copy" @click="copyDraft(a.draft)">
                {{ copied ? "已复制报修草稿 ✓" : "复制报修草稿" }}
              </button>
            </div>
            <pre class="tiny">{{ a.draft }}</pre>
          </div>
        </div>
      </template>

      <!-- 现场办事单：地点/部门/电话/待确认事项都来自证据（不写死前端） -->
      <template v-else-if="a.kind === 'errand'">
        <div class="box-head act-head">
          <span class="label">{{ a.title || "现场办事单" }}</span>
          <span class="tag tag-soft">到楼办理</span>
        </div>
        <div class="box-body errand-body" data-testid="errand-card">
          <!-- ① 具体地点：房间号 + 楼名放大字号，一眼能看清去哪 -->
          <div class="errand-block errand-place">
            <span class="label">具体地点</span>
            <p class="errand-loc">
              <strong>{{ a.place?.building || "地点待确认" }}</strong>
              <strong v-if="a.place?.room" class="errand-room" data-testid="errand-room">{{ a.place.room }}</strong>
            </p>
            <div class="errand-place-meta">
              <span v-if="a.place?.campus" class="tiny muted">{{ a.place.campus }}校区</span>
              <button v-if="a.place?.building_id" type="button" class="btn-sm" data-testid="errand-sandbox"
                      @click="router.push({ path: '/', query: { focus: a.place!.building_id! } })">在沙盘查看</button>
              <button v-if="a.place?.evidence_id" type="button" class="ref-mini"
                      :title="`查看证据 ${a.place.evidence_id}`"
                      @click="emit('cite', a.place!.evidence_id!)">{{ a.place.evidence_id }}</button>
            </div>
          </div>

          <!-- ② 负责部门 -->
          <div class="errand-block">
            <span class="label">负责部门</span>
            <p class="small errand-strong">{{ a.dept || "以现场公示为准" }}
              <span v-if="a.service_scope" class="muted">· {{ a.service_scope }}</span>
            </p>
          </div>

          <!-- ③ 电话 / 办公时间（从证据取值，没有就如实说待确认） -->
          <div class="errand-block">
            <span class="label">电话 / 办公时间</span>
            <p class="small" style="margin: 4px 0 0; display: flex; gap: 12px; flex-wrap: wrap; align-items: baseline;">
              <a v-if="a.phone" class="errand-phone mono" data-testid="errand-phone"
                 :href="`tel:${a.phone.replace(/[^0-9+]/g, '')}`">{{ a.phone }}</a>
              <span v-else class="muted">电话未在证据中登记 → 去电前先看下方「出发前确认」</span>
              <span v-if="a.hours">办公时间：{{ a.hours }}</span>
              <span v-else class="tiny muted">办公时间待向办公室确认</span>
            </p>
          </div>

          <!-- ④ 出发前确认事项（库内没依据的部分如实标注，不臆造） -->
          <div class="errand-block errand-confirms" data-testid="errand-confirms">
            <span class="label">出发前确认事项</span>
            <ul v-if="a.confirms?.length" class="ck-list tiny" style="margin-top: 4px;">
              <li v-for="(c, i) in a.confirms" :key="i" class="ck-check">
                <span class="ck-dot" :class="CONFIRM_DOT[c.state] || 'dot-not_found'"></span>
                <span class="muted">{{ c.text }}</span>
              </li>
            </ul>
            <p v-if="a.materials_confirmed === false" class="tiny" style="margin: 6px 0 0; color: var(--warn);">
              补办材料需向办公室确认，请先电话核实后再去，避免白跑。
            </p>
          </div>
        </div>
      </template>
    </div>

    <!-- 地点卡：在沙盘查看 -->
    <div v-for="a in placeActions" :key="'place'" class="place-card">
      <template v-if="a.matches?.length">
        <span class="tiny muted" style="align-self:flex-start;">{{ a.ambiguous ? "匹配到多个地点，点击查看对应建筑：" : "地点：" }}</span>
        <span v-for="(m, i) in a.matches" :key="i" class="place-chip">
          <span>
            <strong class="small">{{ m.label }}</strong>
            <span class="tiny muted"> · {{ m.category }}<template v-if="m.building_id"> · 沙盘已登记</template></span>
          </span>
          <button v-if="focusable(m)" type="button" class="btn-sm place-btn" @click="viewSandbox(m)">在沙盘查看</button>
        </span>
      </template>
      <p v-if="a.fallback_text" class="tiny muted" style="margin:0; white-space: pre-line;">{{ a.fallback_text }}</p>
    </div>
  </span>
</template>

<style scoped>
.action-card { margin-top: 10px; }
.act-head { justify-content: space-between; gap: 8px; }

.ck-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ck-item { display: flex; gap: 10px; align-items: flex-start; }
  .ck-chip {
  flex: 0 0 auto; min-width: 72px; text-align: center;
  font-size: 12px; padding: 2px 8px; border: 1px solid var(--line-soft);
}
/* 状态色走全站主题令牌：日夜各自的可读文字/底色对 */
.st-ok { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, transparent); background: var(--ok-bg); }
.st-user { color: var(--err); border-color: color-mix(in srgb, var(--err) 45%, transparent); background: var(--err-bg); }
.st-college { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); background: var(--warn-bg); }
.st-web { color: var(--info); border-color: color-mix(in srgb, var(--info) 45%, transparent); background: var(--info-bg); }
.ck-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }

.ck-refs { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
.ref-mini {
  font-family: var(--mono, monospace); font-size: 11px;
  padding: 1px 6px; border: 1px dashed var(--line-soft);
  background: var(--paper-2); cursor: pointer;
}
.ref-mini:hover { border-color: var(--red); color: var(--red); }

.act-entry {
  border: 1px solid var(--line-soft); background: var(--paper-2);
  padding: 8px 12px; margin-top: 10px;
  display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline;
}
.act-actions { margin-top: 10px; display: flex; gap: 10px; align-items: center; }

  .ck-check { display: flex; gap: 8px; align-items: baseline; }
  .ck-dot { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 50%; display: inline-block; position: relative; top: -1px; }
  .dot-done { background: var(--ok); }
  .dot-not_found { background: var(--text-3); }
  .dot-partial { background: var(--warn); }
  .dot-needs_user { background: var(--err); }
  .st-ok-text { color: var(--ok); }

.act-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }

.act-draft { border: 1px solid var(--line-soft); margin-top: 10px; }
.act-draft-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 6px 12px; border-bottom: 1px solid var(--line-soft); background: var(--paper-2);
}
.act-draft pre {
  margin: 0; padding: 10px 12px; font-size: 12px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word;
}

/* errand 办事单：地点/房间大字优先，其次部门、电话，最后待确认 */
.errand-body { display: flex; flex-direction: column; gap: 12px; }
.errand-block { display: flex; flex-direction: column; gap: 4px; }
.errand-block > .label { font-size: 11px; }
.errand-place { border: 1px solid var(--line-soft); background: var(--paper-2); padding: 10px 12px; }
.errand-loc { margin: 0; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.errand-loc strong:first-child { font-size: 19px; letter-spacing: 0.02em; }
.errand-room { font-size: 22px !important; color: var(--red); font-family: var(--mono, monospace); }
.errand-place-meta { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 2px; }
.errand-strong { margin: 2px 0 0; font-weight: 700; }
.errand-phone { font-size: 16px; font-weight: 700; color: var(--red); text-decoration: underline; }
.errand-confirms { border-top: 1px dashed var(--line-soft); padding-top: 10px; }

.place-card {
  margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
}
.place-chip {
  display: inline-flex; gap: 10px; align-items: center;
  border: 1px solid var(--line-soft); background: var(--paper);
  padding: 4px 6px 4px 12px;
}
.place-btn { white-space: nowrap; }

@media (max-width: 720px) {
  .ck-chip { min-width: 64px; font-size: 11px; }
}
</style>
