<script setup lang="ts">
// STAGE W9：一组件两形态（卡第 3 条允许把板块面板写进 CampusPanel）。
//  - mode === 'campus'：校区面板（stage-campus-panel）——校区名 + 「N 栋楼 · M 个学院」，
//    选中片区是五大板块所在片区（现在是中区）时上面多一排五个板块钮；学院列表来自
//    当前包 meta.colleges（zone 过滤），confirmed 为假的标「位置待确认」。
//  - mode === 'answer' 且 board 不为 null：板块面板（stage-board-panel）——板块名 +
//    办理地点（同 W5）+ 「这个板块能办的事」（api.services(board)，取回后列 name/summary
//    与最多两条示例问题，点了直接 chat.send，发出后 board 被清空、面板换回回答面板）。
import { computed, onMounted, ref, watch } from "vue";
import { useStageStore } from "@/stores/stage";
import { useChatStore } from "@/stores/chat";
import { cnNumber } from "@/stage/hud";
import { collegeEntries, type CollegeEntry } from "@/stage/collegeIndex";
import EmblemMark from "@/components/stage/EmblemMark.vue";
import { api, type ServiceEntry } from "@/api/client";

const store = useStageStore();
const chat = useChatStore();

// ---- 两种形态是否显示 ----
const isCampusForm = computed(() => store.mode === "campus");
const isBoardForm = computed(() => store.mode === "answer" && store.board !== null);

const campusName = computed(
  () => store.campuses.find((c) => c.id === store.zoneId)?.name ?? ""
);
const campusBuildings = computed(
  () => store.campuses.find((c) => c.id === store.zoneId)?.buildings ?? 0
);

type CollegeRow = CollegeEntry;

/** 学院列表：与地图标记、灯牌角标同一份数据（collegeIndex，zone 过滤 + 同楼归一行） */
const collegeRows = computed<CollegeRow[]>(() => {
  if (store.mode !== "campus") return [];
  return collegeEntries(store.meta, store.emblems, store.zoneId);
});

// ---- 五个板块：只在选中片区是 places.boards 里那些楼所在的片区时显示 ----
const boardZone = computed<string | null>(() => {
  if (!store.places || !store.meta) return null;
  const bid = Object.values(store.places.boards)[0];
  if (!bid) return null;
  return store.meta.buildings[bid]?.zone ?? null;
});

const boards = computed<string[]>(() => {
  if (store.mode !== "campus" || store.zoneId === null) return [];
  if (boardZone.value !== store.zoneId) return [];
  return Object.keys(store.places?.boards ?? {});
});

/** 点学院行：先清 board 再落楼（卡常见错误 4） */
function pickCollege(row: CollegeRow) {
  store.board = null;
  void store.showBuilding(row.buildingId);
}

function pickBoard(name: string) {
  const bid = store.places?.boards[name];
  if (!bid) return;
  store.board = name;
  void store.showBuilding(bid);
}

onMounted(() => {
  // 五个板块的显示条件要用 places.boards（它在需要时才加载，这里提前拉一次）
  void store.loadPlacesData();
});

// ---- 板块面板：服务等数据 ----
const services = ref<ServiceEntry[] | null>(null);
const svcError = ref<string>("");
const svcLoading = ref(false);

const placeZoneName = computed(() => {
  const bid = store.place?.buildingId;
  if (!bid) return "";
  const m = store.meta;
  const zoneId = m?.buildings[bid]?.zone;
  if (!zoneId) return "";
  return m?.zones?.find((z) => z.id === zoneId)?.name ?? "";
});

watch(
  () => (store.mode === "answer" ? store.board : null),
  async (board) => {
    services.value = null;
    svcError.value = "";
    svcLoading.value = false;
    if (!board) return;
    svcLoading.value = true;
    try {
      const r = await api.services(board);
      services.value = r.services ?? [];
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      svcError.value = msg || "服务清单暂时取不到。";
    } finally {
      svcLoading.value = false;
    }
  },
  { immediate: true }
);

/** 点示例问题：直接发（发出后 StageView 的监听会把 board 清掉，面板换回回答面板） */
function askSample(q: string) {
  if (!q || chat.busy) return;
  void chat.send(q);
}
</script>

<template>
  <!-- 形态一：校区面板（学院列表） -->
  <div v-if="isCampusForm" class="stage-answer">
    <section class="stage-panel" data-testid="stage-campus-panel">
      <i class="stage-corner c-tl" aria-hidden="true"></i>
      <i class="stage-corner c-tr" aria-hidden="true"></i>
      <i class="stage-corner c-bl" aria-hidden="true"></i>
      <i class="stage-corner c-br" aria-hidden="true"></i>

      <header class="stage-panel-head">
        <h2 class="stage-panel-title">{{ campusName }}</h2>
        <span class="stage-panel-meta">{{ campusBuildings }} 栋楼 · {{ collegeRows.length }} 个学院</span>
      </header>

      <div class="stage-panel-scroll">
        <!-- 五个板块（只在板块楼所在的片区显示） -->
        <div v-if="boards.length" class="stage-board-row">
          <button
            v-for="b in boards"
            :key="b"
            type="button"
            class="stage-board-btn"
            :data-testid="`stage-board-${b}`"
            :class="{ 'is-active': store.board === b }"
            @click="pickBoard(b)"
          >{{ b }}</button>
        </div>

        <template v-if="collegeRows.length">
          <p class="stage-subtitle">学院</p>
          <div class="stage-colleges">
            <button
              v-for="row in collegeRows"
              :key="row.buildingId"
              type="button"
              class="stage-college"
              :class="{ 'is-active': store.place?.buildingId === row.buildingId }"
              :data-testid="`stage-college-${row.index}`"
              @click="pickCollege(row)"
            >
              <span class="stage-college-no">{{ cnNumber(row.index) }}</span>
              <span v-if="row.emblem" class="stage-college-emblem" aria-hidden="true">
                <EmblemMark :college="row.emblem" :size="24" tone="gilt" />
              </span>
              <span class="stage-college-name">{{ row.name }}<span v-if="!row.confirmed" class="stage-college-unconf">（位置待确认）</span></span>
              <span class="stage-college-bld">{{ row.buildingName }}</span>
            </button>
          </div>
        </template>
        <p v-else class="stage-panel-text">这个校区没有学院，主要是宿舍和生活设施。</p>
      </div>
    </section>
  </div>

  <!-- 形态二：板块面板 -->
  <div v-else-if="isBoardForm" class="stage-answer">
    <section class="stage-panel" data-testid="stage-board-panel">
      <i class="stage-corner c-tl" aria-hidden="true"></i>
      <i class="stage-corner c-tr" aria-hidden="true"></i>
      <i class="stage-corner c-bl" aria-hidden="true"></i>
      <i class="stage-corner c-br" aria-hidden="true"></i>

      <header class="stage-panel-head">
        <h2 class="stage-panel-title">{{ store.board }}</h2>
      </header>

      <div class="stage-panel-scroll">
        <!-- 办理地点（同 W5 的样式） -->
        <div v-if="store.place" class="stage-place" data-testid="stage-panel-place">
          <p class="stage-subtitle">办理地点</p>
          <p class="stage-place-line">
            <span class="stage-place-square" aria-hidden="true"></span>{{ store.place.name }}
          </p>
          <p v-if="placeZoneName" class="stage-place-zone">{{ placeZoneName }}</p>
        </div>

        <p class="stage-subtitle">这个板块能办的事</p>
        <div
          v-for="s in services ?? []"
          :key="s.service_id"
          class="stage-svc"
        >
          <p class="stage-svc-name">{{ s.name }}</p>
          <p class="stage-svc-summary">{{ s.summary }}</p>
          <div class="stage-svc-qs">
            <button
              v-for="q in s.sample_questions.slice(0, 2)"
              :key="q"
              type="button"
              class="stage-svc-q"
              @click="askSample(q)"
            >{{ q }}</button>
          </div>
        </div>
        <p v-if="svcLoading" class="stage-panel-text soft">正在加载服务清单…</p>
        <p v-else-if="svcError" class="stage-panel-text soft">服务清单暂时取不到，请稍后再试。</p>
        <p v-else-if="services !== null && services.length === 0" class="stage-panel-text soft">这个板块暂无登记的服务。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 沿用回答面板的 .stage-stage-answer/.stage-panel 容器（stage.css）；
   这里只写本卡新增的行样式。 */
.stage .stage-board-row {
  display: flex;
  gap: 8px;
  margin: 0 0 14px;
}
.stage .stage-board-btn {
  flex: 1;
  background: var(--st-glass);
  border: 1px solid var(--st-gold3);
  border-top: 2px solid var(--st-gold);
  color: var(--st-moon);
  font-family: var(--st-song);
  font-size: 13px;
  letter-spacing: 0.18em;
  padding: 8px 0;
  cursor: pointer;
}
.stage .stage-board-btn:hover,
.stage .stage-board-btn.is-active {
  border-color: var(--st-red);
  border-top-color: var(--st-red);
  color: var(--st-moon);
}
.stage .stage-colleges {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
/* 学院行：序号一列、学院全名与楼名两行（黑体 15px / 1.4，全名换行不挤压）；
   选中/聚焦行用朱砂左侧细线强调，不只靠颜色 */
.stage .stage-college {
  display: grid;
  grid-template-columns: auto auto minmax(0, 1fr);
  column-gap: 10px;
  row-gap: 3px;
  align-items: start;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  border-bottom: 1px solid var(--st-gold3);
  border-left: 2px solid transparent;
  padding: 11px 2px 10px 6px;
  cursor: pointer;
}
.stage .stage-college:hover {
  border-left-color: var(--st-gold2);
}
.stage .stage-college.is-active {
  border-left-color: var(--st-red);
  background: var(--st-gold3);
}
.stage .stage-college:focus-visible {
  outline: 1px solid var(--st-red);
  outline-offset: -1px;
}
.stage .stage-college:hover .stage-college-name {
  color: var(--st-moon);
}
.stage .stage-college-no {
  grid-column: 1;
  grid-row: 1 / span 2;
  padding-top: 1px;
  font-family: var(--st-song);
  font-weight: 700;
  font-size: 13px;
  line-height: 1.4;
  color: var(--gold-text);
}
/* ALIVE A3：序号与名字之间的 24px 鐿金院徽（拿不到 emblems 时不渲染） */
.stage .stage-college-emblem {
  grid-column: 2;
  grid-row: 1 / span 2;
  display: flex;
  align-self: center;
}
.stage .stage-college.is-active .stage-college-no {
  color: var(--st-red);
}
.stage .stage-college-name {
  grid-column: 3;
  grid-row: 1;
  font-family: var(--st-hei);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.4;
  letter-spacing: 0;
  overflow-wrap: anywhere;
  color: var(--st-moon);
}
.stage .stage-college-unconf {
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--st-moon2);
}
.stage .stage-college-bld {
  grid-column: 3;
  grid-row: 2;
  margin-left: 0;
  font-family: var(--st-hei);
  font-size: 11.5px;
  line-height: 1.45;
  letter-spacing: 0.04em;
  overflow-wrap: anywhere;
  color: var(--st-moon2);
}
.stage .stage-svc {
  padding: 10px 0 12px;
  border-bottom: 1px solid var(--st-gold3);
}
.stage .stage-svc-name {
  margin: 0 0 4px;
  font-family: var(--st-song);
  font-size: 15px;
  color: var(--st-moon);
}
.stage .stage-svc-summary {
  margin: 0 0 8px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--st-moon2);
}
.stage .stage-svc-qs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.stage .stage-svc-q {
  background: none;
  border: 1px solid var(--st-gold3);
  color: var(--st-moon2);
  font-family: var(--st-hei);
  font-size: 12px;
  letter-spacing: 0.08em;
  padding: 5px 10px;
  cursor: pointer;
}
.stage .stage-svc-q:hover {
  border-color: var(--st-gold2);
  color: var(--st-moon);
}
</style>
