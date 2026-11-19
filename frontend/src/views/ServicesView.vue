<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { api, ServiceEntry } from "@/api/client";
import { useGo } from "@/composables";

const route = useRoute();
const router = useRouter();
const { ask, openWorkflow } = useGo();

const BOARD_CHIPS = ["全部", "学工", "教务", "后勤", "保卫", "图书馆"];
const board = ref<string>(typeof route.query.board === "string" ? route.query.board : "全部");
const keyword = ref<string>(typeof route.query.q === "string" ? route.query.q : "");

const services = ref<ServiceEntry[]>([]);
const loading = ref(true);
const errorText = ref("");

async function load() {
  loading.value = true;
  errorText.value = "";
  try {
    const r = await api.services(board.value === "全部" ? undefined : board.value,
                                 keyword.value.trim() || undefined);
    services.value = r.services;
  } catch (e: any) {
    errorText.value = e?.message || "服务目录加载失败";
  } finally {
    loading.value = false;
  }
}

function applyQuery() {
  const query: Record<string, string> = {};
  if (board.value !== "全部") query.board = board.value;
  if (keyword.value.trim()) query.q = keyword.value.trim();
  router.replace({ query });
  load();
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
function onKeyword() {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(applyQuery, 350);
}

const wizards = ref<{ flow_id: string; name: string; version: string; historical: boolean; steps: string[] }[]>([]);

onMounted(async () => {
  await load();
  try { wizards.value = (await api.workflows()).workflows; } catch {}
});

watch(() => route.query, (q) => {
  const b = typeof q.board === "string" ? q.board : "全部";
  const kw = typeof q.q === "string" ? q.q : "";
  if (b !== board.value) board.value = b;
  if (kw !== keyword.value) keyword.value = kw;
  load();
});
</script>

<template>
  <div class="page">
    <div class="shell">
      <div class="page-head" style="display: grid; grid-template-columns: 1fr auto; align-items: end; gap: var(--gap-5);">
        <div>
          <p class="index">03 — 服务目录</p>
          <h1 class="h1">全部服务 · 按板块浏览</h1>
        </div>
        <label class="field" style="min-width: 260px;">
          <span class="flabel"><span>关键词搜索 KEYWORD</span></span>
          <input v-model="keyword" type="text" placeholder="如：奖学金 / 报修 / 借书" @input="onKeyword" />
        </label>
      </div>

      <!-- 板块筛选 -->
      <div style="display: flex; gap: 0; flex-wrap: wrap; margin-bottom: var(--gap-5);">
        <button v-for="bchip in BOARD_CHIPS" :key="bchip" type="button"
                class="chip" :class="{ on: board === bchip }"
                @click="board = bchip; applyQuery()">
          {{ bchip }}
        </button>
      </div>

      <!-- 目录 -->
      <p v-if="errorText" class="err-text">{{ errorText }}</p>
      <div v-if="loading" class="box-soft empty">加载服务目录…</div>
      <div v-else-if="services.length === 0" class="box-soft empty">
        没有匹配的服务。试试更换板块或清空关键词。
      </div>
      <div v-else>
        <div class="svc-row head">
          <span>NO.</span><span>服务事项</span><span>板块</span><span class="col-desc">说明</span><span class="col-enter">入口</span>
        </div>
        <div v-for="(svc, i) in services" :key="svc.service_id" class="svc-row">
          <span class="svc-no">{{ String(i + 1).padStart(2, "0") }}</span>
          <span>
            <strong>{{ svc.name }}</strong>
            <div class="tiny" style="display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px;">
              <button v-for="(sq, j) in svc.sample_questions" :key="j" type="button" class="btn-sm"
                      style="padding: 2px 8px; min-height: 22px; font-size: 11px;"
                      @click="ask(sq)">{{ sq }}</button>
            </div>
          </span>
          <span><span class="tag tag-soft">{{ svc.board }}</span></span>
          <span class="col-desc small muted">{{ svc.summary }}</span>
          <span class="col-enter" style="display: flex; gap: 6px; flex-wrap: wrap;">
            <button v-if="svc.flow_id" type="button" class="btn-sm btn-red" @click="openWorkflow(svc.flow_id!)">办事向导</button>
            <button type="button" class="btn-sm" @click="ask('我想了解' + svc.name)">去提问</button>
          </span>
        </div>
      </div>

      <!-- 向导清单 -->
      <section v-if="wizards.length" style="margin-top: var(--gap-7);">
        <div class="page-head" style="margin-bottom: var(--gap-5);">
          <p class="index">04 — 办事向导</p>
          <h2 class="h1">材料核对与文书导出</h2>
        </div>
        <div class="grid grid-3">
          <div v-for="w in wizards" :key="w.flow_id" class="box">
            <div class="box-head">
              <span class="label">{{ w.version }}</span>
              <span v-if="w.historical" class="tag tag-red">历史演示</span>
            </div>
            <div class="box-body">
              <h3 class="h3">{{ w.name }}</h3>
              <button type="button" class="btn-sm" style="align-self: flex-start;" @click="openWorkflow(w.flow_id)">进入向导 →</button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.chip {
  border: 1px solid var(--line); border-right: none; background: var(--paper);
  padding: 8px 16px; font-weight: 500; min-height: 36px;
}
.chip:last-of-type { border-right: 1px solid var(--line); }
.chip.on { background: var(--ink); color: #fff; }
.chip.on:hover { background: var(--red); }
</style>
