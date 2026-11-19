<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
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

onMounted(() => load(evidenceId.value));
watch(() => route.params.evidenceId, (id) => { if (id) { evidenceId.value = String(id); load(String(id)); } });
</script>

<template>
  <div class="page">
    <div class="shell">

      <div class="page-head" style="display: grid; grid-template-columns: 1fr auto; align-items: end; gap: var(--gap-5);">
        <div>
          <p class="index">05 — 证据详情</p>
          <h1 class="h1">{{ evidenceId }}</h1>
        </div>
        <div style="display: flex; gap: var(--gap-3);">
          <button type="button" class="btn-sm" @click="router.back()">← 返回</button>
        </div>
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
            <div class="evi-grid">
              <div class="label k">标题</div>
              <div><h2 class="h2">{{ data.title }}</h2></div>

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
