<script setup lang="ts">
import { watch, ref } from "vue";
import type { CitationRef } from "@/api/client";
import { useSourceStore } from "@/stores/source";

const props = defineProps<{
  citation: CitationRef | null;
}>();

const sourceStore = useSourceStore();
const detail = ref<any>(null);
const loading = ref(false);

watch(() => props.citation?.id, async (id) => {
  if (!id || !props.citation) { detail.value = null; return; }
  loading.value = true;
  detail.value = await sourceStore.load(id);
  loading.value = false;
}, { immediate: true });
</script>

<template>
  <div>
    <div v-if="!citation" class="box-soft empty">
      点击回答中的引用角标 [1]，在这里查看官方原文摘录与来源。
    </div>
    <div v-else-if="loading" class="box-soft empty">加载证据…</div>
    <div v-else class="evidence-panel">
      <div class="box">
        <div class="box-head">
          <span class="label">证据 EVIDENCE</span>
          <span class="cite-id">{{ citation.id }}</span>
        </div>
        <div class="box-body">
          <h3 class="h3">{{ citation.title }}</h3>
          <div class="tiny" style="display: flex; flex-direction: column; gap: 2px;">
            <span>发布方：{{ citation.issuer }}</span>
            <span v-if="citation.published_at">发布：{{ citation.published_at }}</span>
            <span v-if="citation.locator">定位：{{ citation.locator }}</span>
          </div>
          <div v-if="citation.time_condition" class="tag tag-red" style="align-self: flex-start;">
            时间条件 · {{ citation.time_condition }}
          </div>
          <div class="evidence-excerpt">{{ (detail?.excerpt ?? citation.excerpt) || "（摘录详见来源页面）" }}</div>
          <a :href="citation.url" target="_blank" rel="noopener noreferrer">
            查看官方原文 ↗<span class="tiny">（链接由服务端按来源白名单生成）</span>
          </a>
          <div v-if="detail && detail.knowledge_version" class="tiny">
            知识版本 {{ detail.knowledge_version }}
            <template v-if="detail.effective_from"> · 生效自 {{ detail.effective_from }}</template>
            <template v-if="detail.effective_to"> · 至 {{ detail.effective_to }}</template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
