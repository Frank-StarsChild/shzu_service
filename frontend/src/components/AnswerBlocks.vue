<script setup lang="ts">
import type { ChatResponse, CitationRef } from "@/api/client";

const props = defineProps<{
  blocks: { kind: string; text: string; citation_ids: string[] }[];
  citations: CitationRef[];
}>();

const emit = defineEmits<{ (e: "cite", id: string): void }>();

const KIND_LABEL: Record<string, string> = {
  fact: "要点",
  office: "办理",
  step: "步骤",
  material: "材料",
  note: "提示",
};

function citeIndex(id: string): number {
  const i = props.citations.findIndex((c) => c.id === id);
  return i < 0 ? 0 : i + 1;
}

function citeOf(id: string): CitationRef | undefined {
  return props.citations.find((c) => c.id === id);
}
</script>

<template>
  <div class="blocks">
    <div v-for="(b, i) in blocks" :key="i" class="block" :class="{ 'kind-note': b.kind === 'note' }">
      <span class="no">{{ b.kind === "note" ? "※" : KIND_LABEL[b.kind] || `B${i + 1}` }}</span>
      <span class="text">
        {{ b.text }}
        <button v-for="cid in b.citation_ids" :key="cid" type="button" class="cite-sup no-print"
                :title="citeOf(cid)?.title || cid"
                @click.stop="emit('cite', cid)">
          [{{ citeIndex(cid) }}]
        </button>
      </span>
    </div>
  </div>
</template>

<style scoped>
/* 模型 reply 为多行正文：note 块按换行渲染 */
.block > span.text {
  white-space: pre-line;
}
</style>
