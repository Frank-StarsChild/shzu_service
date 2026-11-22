<script setup lang="ts">
import { ref, computed, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useSourceStore } from "@/stores/source";

const route = useRoute();
const router = useRouter();
const store = useSourceStore();

const evidenceId = ref(String(route.params.evidenceId));
const data = ref<any>(null);
const loading = ref(true);
const errorText = ref("");

async function load(id: string) {
  loading.value = true;
  errorText.value = "";
  data.value = null;
  const r = await store.load(id);
  if (r) { data.value = r; }
  else { errorText.value = store.failed[`current:${id}`] || "证据加载失败"; }
  loading.value = false;
}

// 主标题优先显示实际来源标题；加载中/出错时才用证据编号占位
const displayTitle = computed(() => {
  if (loading.value) return evidenceId.value;
  if (errorText.value) return "证据不可用";
  return data.value?.title || evidenceId.value;
});

onMounted(() => load(evidenceId.value));
watch(() => route.params.evidenceId, (id) => { if (id) { evidenceId.value = String(id); load(String(id)); } });
</script>

<template>
  <div class="page">
    <div class="shell">

      <!-- 页头标题行：返回在左、主要操作「查看官方原文」在右；窄屏自动换到标题下方（顺序不变）。
           主标题显示实际来源标题，证据 ID 放编号行（次要位置）。 -->
      <div class="page-head source-head">
        <div class="source-head-main">
          <button type="button" class="btn-sm source-back" @click="router.back()">← 返回</button>
          <div class="source-head-title">
            <p class="index">05 — 证据详情 · <span class="mono">{{ evidenceId }}</span></p>
            <h1 class="h1">{{ displayTitle }}</h1>
          </div>
        </div>
        <a v-if="data?.url" class="btn-red btn-sm evi-open-link" :href="data.url" target="_blank" rel="noopener noreferrer">查看官方原文 ↗</a>
      </div>

      <template v-if="loading">
        <div class="box-soft empty">加载证据…</div>
      </template>

      <template v-else-if="errorText">
        <div class="box">
          <div class="box-body">
            <h2 class="h2">证据不可用</h2>
            <p class="muted small">{{ errorText }}</p>
            <p class="tiny muted">可能原因：证据编号不存在、来源未发布，或本地知识服务未启动。</p>
            <button type="button" class="btn-sm" @click="router.push('/unavailable')">查看服务状态</button>
          </div>
        </div>
      </template>

      <template v-else-if="data">
        <div class="box">
          <div class="box-head">
            <span class="label">证据 EVIDENCE</span>
            <span v-if="data.review_state" class="tag tag-ok">{{ data.review_state }}</span>
          </div>
          <div class="box-body">
            <!-- 发布部门 / 适用时间 / 出处：易扫读的两栏网格 -->
            <div class="evi-grid">
              <div class="label k">发布方</div>
              <div>{{ data.issuer }}</div>

              <div class="label k">发布时间</div>
              <div class="mono">{{ data.published_at || "（未标注）" }}</div>

              <div class="label k">生效期</div>
              <div class="mono">
                {{ (data.effective_from || "—") + " ~ " + (data.effective_to || "长期") }}
              </div>

              <div class="label k">定位</div>
              <div class="mono">{{ data.locator || "（全文）" }}</div>

              <div class="label k">来源文档</div>
              <div class="mono">{{ data.doc_id }}</div>

              <div class="label k">知识版本</div>
              <div class="mono">{{ data.knowledge_version }}</div>

              <div class="label k">官方原文</div>
              <div><a :href="data.url" target="_blank" rel="noopener noreferrer">{{ data.url }} ↗</a></div>
            </div>
          </div>
        </div>

        <div class="box" style="margin-top: var(--gap-5);">
          <div class="box-head">
            <span class="label">原文摘录 EXCERPT（逐字）</span>
          </div>
          <div class="box-body">
            <div v-if="data.time_condition" class="tag tag-red" style="align-self: flex-start; margin-bottom: var(--gap-3);">
              时间条件 · {{ data.time_condition }}
            </div>
            <div class="evidence-excerpt">{{ data.excerpt || "（摘录为空，详见官方原文链接）" }}</div>
            <p class="tiny muted" style="margin: 0;">摘录为官方文件逐字引用，未作改写；结论解释以原文为准。</p>
          </div>
        </div>
      </template>

    </div>
  </div>
</template>

<style scoped>
/* 标题行：左返回 + 标题，右主要操作；窄屏换行到标题下方且保持可见顺序 */
.source-head {
  display: flex;
  align-items: flex-end;
  gap: var(--gap-4) var(--gap-5);
  flex-wrap: wrap;
}
.source-head-main {
  display: flex;
  align-items: flex-end;
  gap: var(--gap-3);
  min-width: 0;
  flex: 1 1 320px;
}
.source-back { flex: none; }
.source-head-title { min-width: 0; }
.evi-open-link { flex: none; }
@media (max-width: 720px) {
  .source-head { align-items: flex-start; flex-direction: column; }
  .evi-open-link { align-self: flex-end; }
}

/* 页头里的“查看官方原文”按主按钮样式，但是链接：补齐按钮的边框/内距（a 不继承 button 基样式） */
.evi-open-link {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  min-height: 30px;
  font-size: 12px;
  font-weight: 700;
  border: 1px solid var(--vermilion);
  border-bottom: 1px solid var(--vermilion);
  background: var(--vermilion);
  color: var(--on-vermilion);
  box-shadow: none;
}
.evi-open-link:hover {
  background: var(--vermilion-deep);
  border-color: var(--vermilion-deep);
  color: var(--on-vermilion);
}
</style>
