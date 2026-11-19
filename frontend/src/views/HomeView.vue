<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useKbMeta, useGo } from "@/composables";
import { api } from "@/api/client";
import CampusHero from "@/components/CampusHero.vue";

const router = useRouter();
const { ready } = useKbMeta();
const { ask, openWorkflow } = useGo();

const q = ref("");

// 校园沙盘联动状态（PLAN 4.4）：HomeView 是唯一来源。
// activeSource 记录谁触发的：tile（板块按钮）| marker（编号标记）| canvas（3D 画布）。
// 只有来源是 tile 时镜头才移动（S6 起）；标记/楼跟随镜头，镜头一动会从鼠标下移开。
const activeBoard = ref<string | null>(null);
const activeSource = ref<"tile" | "marker" | "canvas" | null>(null);

function enterFromTile(board: string) {
  activeBoard.value = board;
  activeSource.value = "tile";
}
function enterFromMarker(board: string) {
  activeBoard.value = board;
  activeSource.value = "marker";
}
function enterFromCanvas(board: string) {
  activeBoard.value = board;
  activeSource.value = "canvas"; // 画布来源：只高亮，不动镜头（PLAN 4.4）
}
function clearActive() {
  activeBoard.value = null;
  activeSource.value = null;
}

const boards = [
  { no: "01", id: "学工", name: "学工 · 资助", desc: "奖助学金、困难认定、学生证补办" },
  { no: "02", id: "教务", name: "教务 · 学籍", desc: "请假、缓考、成绩单、场所借用" },
  { no: "03", id: "后勤", name: "后勤 · 生活", desc: "宿舍报修、餐厅、会务场地" },
  { no: "04", id: "保卫", name: "保卫 · 出行", desc: "校门出入、电动自行车、值班电话" },
  { no: "05", id: "图书馆", name: "图书馆", desc: "借阅、续借、赔偿、校外访问" },
];

const wizardList = ref<{ flow_id: string; name: string; version: string; historical: boolean; steps: string[] }[]>([]);
const wizardError = ref("");

onMounted(async () => {
  try {
    const r = await api.workflows();
    wizardList.value = r.workflows;
  } catch {
    wizardError.value = "向导清单加载失败，可直接在服务目录中重试";
  }
});

function submit() {
  const text = q.value.trim();
  if (!text) return;
  ask(text);
}

const samples = [
  "国家励志奖学金有多少钱，要什么条件？",
  "我是本科生，一次能借几本书？",
  "宿舍水管坏了怎么报修？",
  "借教室要提前几天申请？",
  "电动自行车怎么办校园通行牌？",
];
</script>

<template>
  <div class="page">
    <div class="shell">

      <!-- Hero：大标题 + 大输入框 -->
      <section class="hero">
        <div>
          <p class="label">SHIHEZI UNIVERSITY · ONE-STOP SERVICE AGENT</p>
          <h1 class="h-display">校园办事，<br />问一次就清楚。</h1>
        </div>
        <div class="hero-grid-bg">
          <div class="hero-left">
            <p class="muted small" style="max-width: 56ch;">
              基于学校官方发布资料（604 页文件、逐条审定证据）回答校园服务问题。每条回答都附官方出处，
              可以点开核验；资料不足时明确说"不足"，不编造答案。
            </p>
            <form class="composer" @submit.prevent="submit">
              <input v-model="q" type="text" placeholder="输入问题，例如：国家励志奖学金要什么条件？" aria-label="输入问题" />
              <button type="submit" :disabled="!q.trim()">提问</button>
            </form>
            <div style="display: flex; flex-wrap: wrap; gap: var(--gap-2);">
              <button v-for="s in samples" :key="s" type="button" class="btn-sm" @click="ask(s)">{{ s }}</button>
            </div>
          </div>
          <div class="hero-right">
            <p class="label">HOW IT WORKS</p>
            <div class="small" style="display: flex; flex-direction: column; gap: var(--gap-3);">
              <div>
                <strong>一问一答</strong><br />
                <span class="muted">问题→澄清→基于证据的回答，附原文出处与页码/章节定位。</span>
              </div>
              <div>
                <strong>办事向导</strong><br />
                <span class="muted">逐项核对资格规则、生成材料清单与申请表，导出 Word 文档。</span>
              </div>
              <div>
                <strong>证据可查</strong><br />
                <span class="muted">每个结论对应一条已审定的官方证据，链接直达来源页面。</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 五板块 -->
      <section>
        <div class="page-head" style="margin-bottom: var(--gap-5);">
          <p class="index">01 — 服务板块</p>
          <h2 class="h1">五大板块 · {{ ready ? ready.knowledge_evidence + " 条审定证据" : "加载中…" }}</h2>
        </div>
        <CampusHero :active-board="activeBoard" :active-source="activeSource"
                    @marker-enter="enterFromMarker" @marker-leave="clearActive"
                    @canvas-enter="enterFromCanvas" @canvas-leave="clearActive">
          <div class="boards">
            <button v-for="b in boards" :key="b.id" type="button" class="board-tile"
                    :data-board="b.id"
                    :class="{ 'is-active': activeBoard === b.id && activeSource !== 'tile' }"
                    @mouseenter="enterFromTile(b.id)" @mouseleave="clearActive"
                    @focus="enterFromTile(b.id)" @blur="clearActive"
                    @click="router.push({ path: '/services', query: { board: b.id } })">
              <span class="no">{{ b.no }}</span>
              <strong>{{ b.name }}</strong>
              <span class="tiny">{{ b.desc }}</span>
            </button>
          </div>
        </CampusHero>
      </section>

      <!-- 办事向导 -->
      <section style="margin-top: var(--gap-7);">
        <div class="page-head" style="margin-bottom: var(--gap-5);">
          <p class="index">02 — 办事向导</p>
          <h2 class="h1">表单 → 规则核对 → 文书导出</h2>
        </div>
        <p v-if="wizardError" class="err-text">{{ wizardError }}</p>
        <div v-if="wizardList.length" class="grid grid-3">
          <div v-for="w in wizardList" :key="w.flow_id" class="box">
            <div class="box-head">
              <span class="label">{{ w.version }}</span>
              <span v-if="w.historical" class="tag tag-red">历史演示</span>
            </div>
            <div class="box-body">
              <h3 class="h3">{{ w.name }}</h3>
              <ol class="small muted" style="padding-left: 20px; margin: 0; display: flex; flex-direction: column; gap: 4px;">
                <li v-for="(s, i) in w.steps" :key="i">{{ s }}</li>
              </ol>
              <button type="button" class="btn-red btn-sm" style="align-self: flex-start;" @click="openWorkflow(w.flow_id)">
                进入向导 →
              </button>
            </div>
          </div>
        </div>
        <div v-else class="box-soft empty">正在向导清单…</div>
      </section>

    </div>
  </div>
</template>
