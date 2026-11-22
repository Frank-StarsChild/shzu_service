<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkflowStore } from "@/stores/workflow";
import { useChatStore } from "@/stores/chat";
import FlowPreview from "@/components/FlowPreview.vue";
import type { SlotSpec } from "@/api/client";

const route = useRoute();
const router = useRouter();
const store = useWorkflowStore();
const chat = useChatStore();

// 办事体验改造：向导页按步骤渲染（steps.slot_keys），桌面左表单右实时预览。
// - 草稿归属当前聊天会话（新会话后 id 变化 → 草稿不串）；「继续办理」经 ?draft= 恢复原会话草稿；
// - 预设卡：聊天里学生自述的事实待确认，可改值后确认或跳过（手动修改优先于预设）；
// - 页尾核对：字段一改旧核对即过期（previewValid=false），导出前必须重新核对。

/** 草稿归属会话：?draft= 指定原会话（恢复哪份就继续写哪份）；否则用当前聊天会话，
 *  直达入口（服务目录/首页）没有会话时先建一个——保证草稿首次填写就能恢复。
 *  整页重新加载后 chat store 的 sessionId 是空白（restore 只在聊天页跑过），
 *  先信任 localStorage 里上次会保存的会话（发消息时后端校验有效性），保持草稿键稳定。 */
async function loadFromRoute() {
  const draftParam = route.query.draft ? String(route.query.draft) : "";
  let sessionId = draftParam;
  if (!sessionId) {
    if (!chat.sessionId) {
      try {
        const saved = localStorage.getItem("shzu.session_id") || "";
        if (saved) chat.sessionId = saved;
      } catch { /* 无法读存储时走新建 */ }
    }
    if (!chat.sessionId) {
      try { await chat.ensureSession(); } catch { /* 会话不可用时草稿留在内存，不影响填写 */ }
    }
    sessionId = chat.sessionId || "";
  }
  store.loadFlow(String(route.params.flowId), {
    sessionId,
    draftSessionId: draftParam || undefined,
  });
}

onMounted(loadFromRoute);
watch(() => route.params.flowId, (id) => { if (id) loadFromRoute(); });

const d = computed(() => store.detail);
const currentStep = computed(() => d.value?.steps[store.stepIndex] ?? null);
const stepCount = computed(() => d.value?.steps.length ?? 0);
const isLastStep = computed(() => store.stepIndex >= stepCount.value - 1);

const isMaterialsStep = computed(() => {
  const s = currentStep.value;
  if (!s) return false;
  return s.key === "materials" || (!s.slot_keys?.length && /材料/.test(s.name));
});
const isExportStep = computed(() => {
  const s = currentStep.value;
  return !!s && (s.key === "export" || (!s.slot_keys?.length && isLastStep.value));
});

/** 本步骤槽位（steps.slot_keys 分组；旧流程无 slot_keys 时回退为全部槽位） */
const stepSlots = computed<SlotSpec[]>(() => {
  if (!d.value || !currentStep.value) return [];
  const keys = currentStep.value.slot_keys;
  if (!keys) return d.value.slots;
  const byKey = new Map(d.value.slots.map((s) => [s.key, s]));
  return keys.map((k) => byKey.get(k)).filter(Boolean) as SlotSpec[];
});

/** 成组槽位（双排名：名次 + 总人数 摆在同一组里，能看出在填哪一种排名） */
const stepGroups = computed(() => {
  const loose: SlotSpec[] = [];
  const groups: { title: string; slots: SlotSpec[] }[] = [];
  for (const s of stepSlots.value) {
    if (s.group) {
      const g = groups.find((x) => x.title === s.group);
      if (g) g.slots.push(s);
      else groups.push({ title: s.group, slots: [s] });
    } else loose.push(s);
  }
  return { loose, groups };
});

const hasForm = computed(() => stepSlots.value.length > 0);

function stepEvidences(idx: number): string[] {
  return d.value?.steps[idx]?.evidence_ids || [];
}

// ---- 预设确认卡（聊天带入的第一人称事实：可改值再确认，或本次不带入） ----
const presetValues = ref<Record<string, any>>({});
watch(
  () => store.pendingPresetKeys,
  (keys) => {
    const next: Record<string, any> = {};
    for (const k of keys) next[k] = presetValues.value[k] ?? store.preset[k];
    presetValues.value = next;
  },
  { immediate: true }
);
function setPresetValue(key: string, v: any) {
  presetValues.value = { ...presetValues.value, [key]: v };
}
function slotOf(key: string): SlotSpec | undefined {
  return d.value?.slots.find((s) => s.key === key);
}

// ---- 实时预览的改动提示：最近变更的键传给 FlowPreview 做一次轻底色 ----
const flashKeys = ref<string[]>([]);
let lastInputs: Record<string, any> = {};
watch(
  () => store.inputs,
  (cur) => {
    const changed: string[] = [];
    for (const k of Object.keys(cur)) {
      if (String(cur[k] ?? "") !== String(lastInputs[k] ?? "")) changed.push(k);
    }
    lastInputs = { ...cur };
    if (changed.length) {
      flashKeys.value = changed;
      setTimeout(() => { flashKeys.value = []; }, 950);
    }
  },
  { deep: true }
);

/** 手机端「查看预览」折叠态（桌面始终显示右侧预览） */
const mobilePreviewOpen = ref(false);

function setSlot(slot: SlotSpec, v: any) {
  store.setField(slot.key, v === "" ? "" : v);
}

async function doPreview() {
  const ok = await store.preview();
  if (ok) {
    document.getElementById("wiz-result")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function doExport() {
  await store.exportDoc();
}

const MATERIAL_STATUS: Record<string, string> = {
  generated: "已生成",
  to_prepare: "待准备",
  conditional: "按条件",
  no_action: "无需办理",
};
const RULE_STATE: Record<string, string> = {
  pass: "通过",
  fail: "不通过",
  unknown: "待核对",
};
/** 材料步骤/导出步骤共用的材料表（材料 → 状态 → 下一步动作） */
const materials = computed(() => d.value?.materials ?? []);
</script>

<template>
  <div class="page">
    <div class="shell">

      <template v-if="store.loadingFlow">
        <div class="box-soft empty">加载向导…</div>
      </template>

      <template v-else-if="!d">
        <div class="box">
          <div class="box-body">
            <h1 class="h2">向导加载失败</h1>
            <p class="muted small">{{ store.lastError || "该向导不存在或已下线。" }}</p>
            <button type="button" class="btn-sm" @click="router.push('/services')">返回服务目录</button>
          </div>
        </div>
      </template>

      <template v-else>
        <!-- 页头 -->
        <div class="page-head" style="display: grid; grid-template-columns: 1fr auto; align-items: end; gap: var(--gap-5);">
          <div>
            <p class="index">04 — 办事向导</p>
            <h1 class="h1">{{ d.name }}</h1>
          </div>
          <div style="display: flex; gap: var(--gap-2); flex-wrap: wrap; justify-content: flex-end;">
            <span class="tag tag-soft">版本 {{ d.version }}</span>
            <span v-if="d.historical" class="tag tag-red">历史演示数据</span>
          </div>
        </div>

        <!-- 历史演示警示（步骤 1 的年度确认） -->
        <div v-if="d.historical" class="box" style="border-color: var(--red); border-width: 2px; margin-bottom: var(--gap-5);" data-testid="historical-notice">
          <div class="box-head" style="border-bottom-color: var(--red);">
            <span class="label" style="color: var(--red);">历史演示提示 HISTORICAL DEMO</span>
          </div>
          <div class="box-body">
            <p class="small" style="margin: 0;">{{ d.demo_notice || "本流程基于历史年度资料构建，仅作功能演示。" }}</p>
            <label class="field" style="display: flex; gap: 10px; align-items: flex-start; margin-top: 4px;">
              <input type="checkbox" style="width: 18px; height: 18px; min-height: 0;" :checked="store.historicalConfirmed"
                     data-testid="historical-check"
                     @change="store.setHistoricalConfirmed(($event.target as HTMLInputElement).checked)" />
              <span class="small">我已了解这是 2025 年度历史案例演示，不能用于 2026 年度实际申报；2026 年度以当年正式通知为准。</span>
            </label>
          </div>
        </div>

        <div class="wiz-layout">
          <!-- 左：步骤侧栏（当前/已完成/待填写同时用文字区分，不只用颜色） -->
          <aside class="wiz-steps">
            <button v-for="(s, i) in d.steps" :key="s.key" type="button" class="wiz-step"
                    :data-testid="`wiz-step-${i}`"
                    :class="{ current: i === store.stepIndex, done: i < store.stepIndex }" @click="store.backToStep(i)">
              <span class="sno">{{ String(i + 1).padStart(2, "0") }}</span>
              <span>
                <strong style="display: block;">{{ s.name }}</strong>
                <span class="tiny">{{ s.desc }}</span>
                <span class="tiny wiz-state" :class="i === store.stepIndex ? 'st-cur' : (i < store.stepIndex ? 'st-done' : 'st-todo')">
                  {{ i === store.stepIndex ? "当前步骤" : (i < store.stepIndex ? "已完成 ✓" : "待填写") }}
                </span>
              </span>
            </button>
          </aside>

          <!-- 右：主区（桌面：左表单 + 右实时预览；窄屏：预览折叠成按钮） -->
          <section class="wiz-main">

            <!-- 预设确认卡：聊天里说过的信息，待确认带入 -->
            <div v-if="store.pendingPresetKeys.length" class="box wiz-preset" data-testid="preset-card">
              <div class="box-head">
                <span class="label">来自对话的信息 BRING-IN</span>
              </div>
              <div class="box-body">
                <p class="small" style="margin: 0 0 10px;">你在对话里提到过：<q class="wiz-preset-q">{{ store.presetNote || "自己身份的信息" }}</q>。已帮你带到对应填写项，可先修改再确认。</p>
                <div class="grid grid-2" style="gap: var(--gap-4);">
                  <label v-for="k in store.pendingPresetKeys" :key="k" class="field">
                    <span class="flabel"><span>{{ slotOf(k)?.label || k }}</span></span>
                    <select v-if="slotOf(k)?.type === 'choice'"
                            :value="presetValues[k] ?? ''"
                            :data-testid="`preset-${k}`"
                            @change="setPresetValue(k, ($event.target as HTMLSelectElement).value)">
                      <option value="">请选择</option>
                      <option v-for="opt in slotOf(k)!.options" :key="opt" :value="opt">{{ opt }}</option>
                    </select>
                    <input v-else
                           :value="presetValues[k] ?? ''"
                           :data-testid="`preset-${k}`"
                           @input="setPresetValue(k, ($event.target as HTMLInputElement).value)" />
                  </label>
                </div>
                <div style="display: flex; gap: 10px; margin-top: 12px; flex-wrap: wrap; align-items: center;">
                  <button type="button" class="btn-red btn-sm" data-testid="preset-confirm"
                          @click="store.confirmPreset(presetValues)">确认并继续</button>
                  <button type="button" class="btn-sm" data-testid="preset-skip"
                          @click="store.skipPreset()">本次不带入</button>
                  <span class="tiny muted">确认后可在左侧对应步骤里继续修改。</span>
                </div>
              </div>
            </div>

            <div class="wiz-cols">
              <div class="wiz-colform">

                <!-- 当前步骤说明 -->
                <div class="box">
                  <div class="box-head">
                    <span class="label">步骤 {{ String(store.stepIndex + 1).padStart(2, "0") }} — {{ currentStep?.name }}</span>
                    <span class="tiny">依据来源 {{ stepEvidences(store.stepIndex).length }} 条</span>
                  </div>
                  <div class="box-body">
                    <p class="small" style="margin: 0;">{{ currentStep?.desc }}</p>
                    <div v-if="stepEvidences(store.stepIndex).length" style="display: flex; flex-wrap: wrap; gap: 6px;">
                      <button v-for="eid in stepEvidences(store.stepIndex)" :key="eid" type="button" class="btn-sm"
                              @click="router.push(`/sources/${encodeURIComponent(eid)}`)">证据 {{ eid }} ↗</button>
                    </div>
                  </div>
                </div>

                <!-- 表单步骤：只渲染本步骤的槽位 -->
                <div v-if="hasForm" class="box" data-testid="wiz-form">
                  <div class="box-head">
                    <span class="label">本步骤填写 FIELDS</span>
                    <span class="tiny">带 <span style="color: var(--red);">*</span> 为必填；个人信息仅用于生成文书，演示可留空</span>
                  </div>
                  <div class="box-body">
                    <div class="grid grid-2" style="gap: var(--gap-4);">
                      <div v-for="slot in stepGroups.loose" :key="slot.key">
                        <label class="field">
                          <span class="flabel">
                            <span>{{ slot.label }}<span v-if="slot.required" class="req"> *</span>
                              <span v-if="slot.personal" class="tiny" style="font-weight: 400; color: var(--ink-3);"> · 个人信息</span>
                            </span>
                          </span>

                          <textarea v-if="slot.type === 'textarea'"
                                    :value="store.inputs[slot.key] ?? ''"
                                    :data-testid="`slot-${slot.key}`"
                                    :class="{ invalid: store.fieldErrors[slot.key] }"
                                    rows="3" placeholder="（可留空）"
                                    @input="setSlot(slot, ($event.target as HTMLTextAreaElement).value)"></textarea>

                          <select v-else-if="slot.type === 'choice'"
                                  :value="store.inputs[slot.key] ?? ''"
                                  :data-testid="`slot-${slot.key}`"
                                  :class="{ invalid: store.fieldErrors[slot.key] }"
                                  @change="setSlot(slot, ($event.target as HTMLSelectElement).value)">
                            <option value="">请选择</option>
                            <option v-for="opt in slot.options" :key="opt" :value="opt">{{ opt }}</option>
                          </select>

                          <input v-else
                                 :type="slot.type"
                                 :value="store.inputs[slot.key] ?? ''"
                                 :data-testid="`slot-${slot.key}`"
                                 :class="{ invalid: store.fieldErrors[slot.key] }"
                                 :placeholder="slot.personal ? '（演示可留空）' : ''"
                                 @input="setSlot(slot, ($event.target as HTMLInputElement).value)" />
                        </label>
                        <p v-if="slot.note" class="tiny" style="margin: 3px 0 0;">{{ slot.note }}</p>
                        <p v-if="store.fieldErrors[slot.key]" class="err-text">{{ store.fieldErrors[slot.key] }}</p>
                      </div>
                    </div>

                    <!-- 成组槽位：双排名（名次 + 总人数同一行，能看出在填哪一种排名） -->
                    <fieldset v-for="g in stepGroups.groups" :key="g.title" class="wiz-rank">
                      <legend class="small"><strong>{{ g.title }}</strong></legend>
                      <div class="wiz-rank-row">
                        <template v-for="slot in g.slots" :key="slot.key">
                          <label class="field wiz-rank-field">
                            <span class="flabel">
                              <span>{{ /名次/.test(slot.label) ? "名次" : /总人数/.test(slot.label) ? "总人数" : slot.label }}
                                <span v-if="slot.required" class="req"> *</span>
                              </span>
                            </span>
                            <input :type="slot.type" :value="store.inputs[slot.key] ?? ''"
                                   :data-testid="`slot-${slot.key}`"
                                   :class="{ invalid: store.fieldErrors[slot.key] }"
                                   :placeholder="slot.personal ? '（演示可留空）' : ''"
                                   @input="setSlot(slot, ($event.target as HTMLInputElement).value)" />
                          </label>
                          <p v-if="store.fieldErrors[slot.key]" class="err-text" style="flex-basis: 100%; margin: -6px 0 0;">{{ store.fieldErrors[slot.key] }}</p>
                        </template>
                      </div>
                    </fieldset>

                    <!-- 步骤导航 -->
                    <div class="wiz-nav no-print">
                      <button type="button" class="btn-sm" :disabled="store.stepIndex === 0"
                              data-testid="wiz-prev" @click="store.prevStep()">← 上一步</button>
                      <button v-if="!isLastStep" type="button" class="btn-red btn-sm"
                              data-testid="wiz-next" @click="store.nextStep()">下一步：{{ d.steps[store.stepIndex + 1]?.name }} →</button>
                      <span v-else class="tiny muted">最后一步：核对并生成预览。</span>
                    </div>
                  </div>
                </div>

                <!-- 材料清单步骤：每项写清下一步动作 -->
                <div v-else-if="isMaterialsStep" class="box" data-testid="wiz-materials">
                  <div class="box-head">
                    <span class="label">材料清单 MATERIALS</span>
                    <span class="tiny">按核对结果生成，逐项给出下一步动作</span>
                  </div>
                  <div class="box-body">
                    <table v-if="materials.length" class="rules-table">
                      <thead><tr><th>材料</th><th>状态</th><th>下一步动作</th></tr></thead>
                      <tbody>
                        <tr v-for="m in materials" :key="m.name">
                          <td class="small">{{ m.name }}</td>
                          <td><span class="tag tag-soft">{{ MATERIAL_STATUS[m.status] || m.status }}</span></td>
                          <td class="small">{{ m.submit_or_keep }}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p v-else class="muted small" style="margin: 0;">本流程未登记材料清单，以「核对并生成预览」的结果为准。</p>
                    <div class="wiz-nav no-print">
                      <button type="button" class="btn-sm" :disabled="store.stepIndex === 0" @click="store.prevStep()">← 上一步</button>
                      <button v-if="!isLastStep" type="button" class="btn-red btn-sm" @click="store.nextStep()">下一步：{{ d.steps[store.stepIndex + 1]?.name }} →</button>
                    </div>
                  </div>
                </div>

                <!-- 预览与导出（最后一步） -->
                <div v-else-if="isExportStep" id="wiz-result" class="box" data-testid="wiz-export">
                  <div class="box-head">
                    <span class="label">核对与输出 VERIFY &amp; EXPORT</span>
                    <span v-if="store.previewValid" class="tag tag-ok">预览已生成</span>
                    <span v-else-if="store.ruleResultsStale" class="tag" style="border-color: var(--warn); color: var(--warn);">核对已过期</span>
                  </div>
                  <div class="box-body">

                    <!-- 字段已修改：旧核对过期，导出的不再是这份内容 -->
                    <p v-if="store.ruleResultsStale" class="warn-text" data-testid="preview-stale" style="margin: 0 0 8px;">
                      字段已修改，之前的核对结果已过期。请重新核对后再下载，导出的文书才会是你现在看到的内容。
                    </p>

                    <p v-if="store.lastError" class="err-text" style="margin: 0 0 8px;">{{ store.lastError }}</p>
                    <p v-if="store.fieldErrors._historical" class="err-text" style="margin: 0 0 8px;">
                      {{ store.fieldErrors._historical }}
                    </p>

                    <div class="no-print" style="display: flex; gap: var(--gap-3); flex-wrap: wrap; align-items: center;">
                      <button type="button" class="btn-red" :disabled="store.previewing" @click="doPreview">
                        {{ store.previewing ? "生成中…" : store.previewValid ? "重新核对" : "核对并生成预览" }}
                      </button>
                      <button v-if="store.previewValid" type="button" :disabled="store.exporting" data-testid="wiz-export-btn" @click="doExport">
                        {{ store.exporting ? "导出中…" : "下载 Word 文档（.docx）" }}
                      </button>
                      <span v-if="store.lastExportName" class="tag tag-ok" data-testid="exported-name">已下载：{{ store.lastExportName }}</span>
                    </div>

                    <!-- 规则核对结果（三态） -->
                    <template v-if="store.ruleResults.length">
                      <div>
                        <p class="h3" style="margin: var(--gap-2) 0 6px;">资格规则核对（三态结果）</p>
                        <table class="rules-table">
                          <thead>
                            <tr><th>核对项</th><th>结果</th><th>说明</th><th>依据</th></tr>
                          </thead>
                          <tbody>
                            <tr v-for="r in store.ruleResults" :key="r.rule_id">
                              <td><strong>{{ r.name }}</strong><div class="tiny mono">{{ r.rule_id }}</div></td>
                              <td><span :class="'state-' + r.state">{{ RULE_STATE[r.state] || r.state }}</span></td>
                              <td class="small">{{ r.explain }}</td>
                              <td>
                                <button v-for="eid in r.evidence_ids" :key="eid" type="button" class="btn-sm"
                                        style="padding: 2px 8px; min-height: 22px; font-size: 11px; margin: 1px 2px 1px 0;"
                                        @click="router.push(`/sources/${encodeURIComponent(eid)}`)">{{ eid }}</button>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <!-- 材料清单（核对结果版本，含下一步动作） -->
                      <div v-if="materials.length">
                        <p class="h3" style="margin: var(--gap-2) 0 6px;">材料清单与下一步动作</p>
                        <table class="rules-table">
                          <thead><tr><th>材料</th><th>状态</th><th>下一步动作</th></tr></thead>
                          <tbody>
                            <tr v-for="m in materials" :key="m.name">
                              <td class="small">{{ m.name }}</td>
                              <td><span class="tag tag-soft">{{ MATERIAL_STATUS[m.status] || m.status }}</span></td>
                              <td class="small muted">{{ m.submit_or_keep }}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>

                      <p v-if="store.previewValid && store.missingPersonal.length" class="tiny muted" style="margin: 0;">
                        以下个人信息留空，文书对应栏目将保留空白以便线下填写：{{ store.missingPersonal.join("；") }}
                      </p>
                    </template>

                    <p v-if="!store.ruleResults.length" class="muted small" style="margin: 8px 0 0;">
                      填写完成后点击「核对并生成预览」，系统将逐项核对资格规则、给出三态结果（通过/不通过/待核），
                      并生成材料清单与可下载文书。字段修改后需重新预览再导出。
                    </p>

                    <div class="wiz-nav no-print" style="margin-top: 12px;">
                      <button type="button" class="btn-sm" :disabled="store.stepIndex === 0" @click="store.prevStep()">← 上一步</button>
                      <span class="tiny muted">上面填写项都有问题可从左侧步骤栏直接跳回修改。</span>
                    </div>
                  </div>
                </div>

                <!-- 无槽位的说明型步骤（如请假条「生成文书」） -->
                <div v-else class="box">
                  <div class="box-head">
                    <span class="label">步骤 {{ String(store.stepIndex + 1).padStart(2, "0") }} — {{ currentStep?.name }}</span>
                  </div>
                  <div class="box-body">
                    <p class="small" style="margin: 0;">{{ currentStep?.desc }}</p>
                    <p v-if="isLastStep" class="muted small" style="margin: 8px 0 0;">到这一步说明信息已就绪：回到「核对与输出」生成文书。</p>
                    <div class="wiz-nav no-print">
                      <button type="button" class="btn-sm" :disabled="store.stepIndex === 0" @click="store.prevStep()">← 上一步</button>
                      <button v-if="!isLastStep" type="button" class="btn-red btn-sm" @click="store.nextStep()">下一步：{{ d.steps[store.stepIndex + 1]?.name }} →</button>
                    </div>
                  </div>
                </div>

              </div>

              <!-- 右：实时预览（桌面 sticky；手机折叠按钮） -->
              <div class="wiz-preview">
                <div class="wiz-preview-toggle no-print">
                  <button type="button" class="btn-sm" data-testid="mobile-preview-toggle"
                          :aria-expanded="mobilePreviewOpen ? 'true' : 'false'"
                          @click="mobilePreviewOpen = !mobilePreviewOpen">
                    {{ mobilePreviewOpen ? "收起预览 ▲" : "查看预览（随填写更新） ▼" }}
                  </button>
                </div>
                <div class="wiz-preview-body" :class="{ 'is-open': mobilePreviewOpen }">
                  <FlowPreview :detail="d" :inputs="store.inputs" :historical="d.historical" :flash-keys="flashKeys" />
                </div>
              </div>
            </div>

            <!-- 办理时间线与联系方式 -->
            <div class="grid grid-2" style="margin-top: var(--gap-5);">
              <div v-if="d.timeline?.length" class="box">
                <div class="box-head"><span class="label">办理流转 TIMELINE</span></div>
                <div class="box-body">
                  <table class="data-table">
                    <tbody>
                      <tr v-for="(tl, i) in d.timeline" :key="i">
                        <td style="width: 88px;"><span class="tag tag-soft">{{ tl.owner }}</span></td>
                        <td class="small">{{ tl.action }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              <div v-if="d.contact" class="box">
                <div class="box-head"><span class="label">咨询 CONTACT</span></div>
                <div class="box-body small">
                  <div v-if="d.contact.person">经办人：{{ d.contact.person }}</div>
                  <div v-if="d.contact.phone">电话：<span class="mono">{{ d.contact.phone }}</span></div>
                  <div v-if="d.contact.email">邮箱：<span class="mono">{{ d.contact.email }}</span></div>
                </div>
              </div>
            </div>

          </section>
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
/* 步骤状态文字：非当前步骤下的最后一行小字（当前步骤在反色填充上，用高对比变体） */
.wiz-state { display: block; margin-top: 2px; font-weight: 700; letter-spacing: 0.08em; }
.wiz-state.st-todo { color: var(--text-3); }
.wiz-state.st-done { color: var(--ok); }
.wiz-state.st-cur { color: var(--on-ink-accent); }

/* 主区两栏：左表单 + 右实时预览（<1080px 折叠成「查看预览」按钮） */
.wiz-main { display: flex; flex-direction: column; gap: var(--gap-5); min-width: 0; }
.wiz-cols { display: grid; grid-template-columns: minmax(0, 1fr) 336px; gap: var(--gap-5); align-items: start; }
.wiz-preview { display: flex; flex-direction: column; gap: 8px; }
.wiz-preview-toggle { display: none; }

/* 预设确认卡：来自聊天的事实待确认 */
.wiz-preset { border-color: var(--link); border-width: 2px; }
.wiz-preset .box-head { border-bottom-color: color-mix(in srgb, var(--link) 40%, transparent); }
.wiz-preset-q { color: var(--text-2); }

/* 双排名组：同一组的名次与总人数并排 */
.wiz-rank { border: 1px solid var(--line-soft); margin: var(--gap-4) 0 0; padding: 10px 14px 12px; }
.wiz-rank legend { padding: 0 6px; color: var(--text); }
.wiz-rank-row { display: flex; gap: var(--gap-4); flex-wrap: wrap; }
.wiz-rank-field { flex: 1 1 120px; }

/* 步骤导航 */
.wiz-nav { display: flex; gap: var(--gap-3); margin-top: var(--gap-5); align-items: center; flex-wrap: wrap; }

.warn-text {
  color: var(--warn);
  border: 1px solid color-mix(in srgb, var(--warn) 55%, transparent);
  background: var(--warn-bg, color-mix(in srgb, var(--warn) 10%, transparent));
  padding: 8px 12px;
  font-size: 13px;
}

@media (max-width: 1080px) {
  .wiz-cols { grid-template-columns: minmax(0, 1fr); }
  .wiz-preview-toggle { display: block; }
  .wiz-preview-body { display: none; }
  .wiz-preview-body.is-open { display: block; }
  .wiz-preview-body.is-open :deep(.fprev) { position: static; }
}
</style>
