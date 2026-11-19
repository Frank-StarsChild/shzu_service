<script setup lang="ts">
import { ref, computed, watch, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useWorkflowStore } from "@/stores/workflow";
import type { SlotSpec } from "@/api/client";

const route = useRoute();
const router = useRouter();
const store = useWorkflowStore();

onMounted(() => { store.loadFlow(String(route.params.flowId)); });
watch(() => route.params.flowId, (id) => { if (id) store.loadFlow(String(id)); });

const d = computed(() => store.detail);

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

function stepEvidences(stepIdx: number): string[] {
  return d.value?.steps[stepIdx]?.evidence_ids || [];
}
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

        <!-- 历史演示警示 -->
        <div v-if="d.historical" class="box" style="border-color: var(--red); border-width: 2px; margin-bottom: var(--gap-5);">
          <div class="box-head" style="border-bottom-color: var(--red);">
            <span class="label" style="color: var(--red);">历史演示提示 HISTORICAL DEMO</span>
          </div>
          <div class="box-body">
            <p class="small" style="margin: 0;">{{ d.demo_notice || "本流程基于历史年度资料构建，仅作功能演示。" }}</p>
            <label class="field" style="display: flex; gap: 10px; align-items: flex-start; margin-top: 4px;">
              <input type="checkbox" style="width: 18px; height: 18px; min-height: 0;" :checked="store.historicalConfirmed"
                     @change="store.historicalConfirmed = ($event.target as HTMLInputElement).checked" />
              <span class="small">我已了解这是 2025 年度历史案例演示，不能用于 2026 年度实际申报；2026 年度以当年正式通知为准。</span>
            </label>
          </div>
        </div>

        <div class="wiz-layout">
          <!-- 左：步骤侧栏 -->
          <aside class="wiz-steps">
            <button v-for="(s, i) in d.steps" :key="s.key" type="button" class="wiz-step"
                    :class="{ current: i === store.stepIndex }" @click="store.backToStep(i)">
              <span class="sno">{{ String(i + 1).padStart(2, "0") }}</span>
              <span>
                <strong style="display: block;">{{ s.name }}</strong>
                <span class="tiny">{{ s.desc }}</span>
              </span>
            </button>
          </aside>

          <!-- 右：主区 -->
          <section style="display: flex; flex-direction: column; gap: var(--gap-5);">

            <!-- 当前步骤说明 -->
            <div class="box">
              <div class="box-head">
                <span class="label">步骤 {{ String(store.stepIndex + 1).padStart(2, "0") }} — {{ d.steps[store.stepIndex]?.name }}</span>
                <span class="tiny">依据来源 {{ stepEvidences(store.stepIndex).length }} 条</span>
              </div>
              <div class="box-body">
                <p class="small" style="margin: 0;">{{ d.steps[store.stepIndex]?.desc }}</p>
                <div v-if="stepEvidences(store.stepIndex).length" style="display: flex; flex-wrap: wrap; gap: 6px;">
                  <button v-for="eid in stepEvidences(store.stepIndex)" :key="eid" type="button" class="btn-sm"
                          @click="router.push(`/sources/${encodeURIComponent(eid)}`)">证据 {{ eid }} ↗</button>
                </div>
              </div>
            </div>

            <!-- 表单 -->
            <div class="box">
              <div class="box-head">
                <span class="label">申请信息 FORM</span>
                <span class="tiny">带 <span style="color: var(--red);">*</span> 为必填；个人信息仅用于生成文书，演示可留空</span>
              </div>
              <div class="box-body">
                <div class="grid grid-2" style="gap: var(--gap-4);">
                  <div v-for="slot in d.slots" :key="slot.key">
                    <label class="field">
                      <span class="flabel">
                        <span>{{ slot.label }}<span v-if="slot.required" class="req"> *</span>
                          <span v-if="slot.personal" class="tiny" style="font-weight: 400; color: var(--ink-3);"> · 个人信息</span>
                        </span>
                        <span class="tiny">{{ slot.type }}</span>
                      </span>

                      <textarea v-if="slot.type === 'textarea'"
                                :value="store.inputs[slot.key] ?? ''"
                                :class="{ invalid: store.fieldErrors[slot.key] }"
                                rows="3" placeholder="（可留空）"
                                @input="setSlot(slot, ($event.target as HTMLTextAreaElement).value)"></textarea>

                      <select v-else-if="slot.type === 'choice'"
                              :value="store.inputs[slot.key] ?? ''"
                              :class="{ invalid: store.fieldErrors[slot.key] }"
                              @change="setSlot(slot, ($event.target as HTMLSelectElement).value)">
                        <option value="">请选择</option>
                        <option v-for="opt in slot.options" :key="opt" :value="opt">{{ opt }}</option>
                      </select>

                      <input v-else
                             :type="slot.type === 'number' ? 'number' : slot.type === 'tel' ? 'tel' : slot.type"
                             :value="store.inputs[slot.key] ?? ''"
                             :class="{ invalid: store.fieldErrors[slot.key] }"
                             :placeholder="slot.personal ? '（演示可留空）' : ''"
                             @input="setSlot(slot, ($event.target as HTMLInputElement).value)" />
                    </label>
                    <p v-if="slot.note" class="tiny" style="margin: 3px 0 0;">{{ slot.note }}</p>
                    <p v-if="store.fieldErrors[slot.key]" class="err-text">{{ store.fieldErrors[slot.key] }}</p>
                  </div>
                </div>
              </div>
            </div>

            <!-- 预览与导出 -->
            <div id="wiz-result" class="box">
              <div class="box-head">
                <span class="label">核对与输出 VERIFY &amp; EXPORT</span>
                <span v-if="store.previewValid" class="tag tag-ok">预览已生成</span>
              </div>
              <div class="box-body">

                <p v-if="store.lastError" class="err-text" style="margin: 0 0 8px;">{{ store.lastError }}</p>
                <p v-if="store.fieldErrors._historical" class="err-text" style="margin: 0 0 8px;">
                  {{ store.fieldErrors._historical }}
                </p>

                <div style="display: flex; gap: var(--gap-3); flex-wrap: wrap; align-items: center;">
                  <button type="button" class="btn-red" :disabled="store.previewing" @click="doPreview">
                    {{ store.previewing ? "生成中…" : store.previewValid ? "重新核对" : "核对并生成预览" }}
                  </button>
                  <button v-if="store.previewValid" type="button" :disabled="store.exporting" @click="doExport">
                    {{ store.exporting ? "导出中…" : "下载 Word 文档（.docx）" }}
                  </button>
                  <span v-if="store.lastExportName" class="tag tag-ok">已下载：{{ store.lastExportName }}</span>
                </div>

                <!-- 规则核对结果 -->
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

                  <!-- 材料清单 -->
                  <div>
                    <p class="h3" style="margin: var(--gap-2) 0 6px;">材料清单</p>
                    <table class="rules-table">
                      <thead><tr><th>材料</th><th>状态</th><th>处理方式</th></tr></thead>
                      <tbody>
                        <tr v-for="m in d.materials" :key="m.name">
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
              </div>
            </div>

            <!-- 办理时间线与联系方式 -->
            <div class="grid grid-2">
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
