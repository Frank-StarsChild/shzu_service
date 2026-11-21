<script setup lang="ts">
// 场景动作卡片：材料核对（奖助学金）/ 网络报修分诊 / 沙盘定位。
// 数据全部来自后端工具核验过的 response.actions（不由模型生成）；正文仍由模型撰写。
// 事件：cite(evidenceId) 打开证据面板；进入向导/沙盘跳转由本组件使用 router。
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import type { ActionCard, ChecklistItem, PlaceMatch } from "@/api/client";

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
            <button type="button" class="btn-red btn-sm"
                    @click="router.push(`/workflows/${a.flow.flow_id}`)">进入核对向导 →</button>
            <span v-if="a.flow.historical" class="tiny muted">（{{ a.flow.name }}，仅作历史参考）</span>
          </div>
        </div>
      </template>

      <template v-else-if="a.kind === 'repair'">
        <div class="box-head act-head">
          <span class="label">{{ a.title || "网络故障分诊" }}</span>
          <span v-if="a.announcement" class="tiny"
                :class="{ 'st-ok-text': a.announcement.local, 'muted': !a.announcement.local }">
            公告核对：{{ a.announcement.local ? "库内命中" : "未查到有效公告" }}
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
              <button type="button" class="btn-sm" @click="copyDraft(a.draft)">{{ copied ? "已复制 ✓" : "复制草稿" }}</button>
            </div>
            <pre class="tiny">{{ a.draft }}</pre>
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
.st-ok { color: #0a7a3d; border-color: #0a7a3d55; background: #f2fbf6; }
.st-user { color: var(--red); border-color: var(--red); background: #fff5f5; }
.st-college { color: #6b5b00; border-color: #b09a2a66; background: #fffdf0; }
.st-web { color: #0b4f8a; border-color: #0b4f8a66; background: #f0f7ff; }
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
.dot-done { background: #0a7a3d; }
.dot-not_found { background: #999; }
.dot-partial { background: #b09a2a; }
.dot-needs_user { background: var(--red); }
.st-ok-text { color: #0a7a3d; }

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
