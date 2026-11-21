<script setup lang="ts">
// STAGE W6：/ 的薄壳。挂载时判一次 decideEntry，stage 为真渲染舞台，否则渲染普通版。
// 两个视图都 defineAsyncComponent 分包：普通版的用户不下载舞台的代码（stage-entry 第 6 条）。
// 舞台时给 <html> 加 is-stage，App.vue 的顶栏页脚靠 entryIsStage 与 route.meta.stage
// 一起决定显隐；离开 / 时本组件卸载，把 class 与标记复位（W6 常见错误 3）。
//
// 同一路由内 query 变化（如普通版 /?3d=1 上点「校园」去 /?stage=1）不会重建本组件，
// 需要重判；设备/视口/偏好的其余变化不实时切换（W6.md 第 5 条），下次进入首页再判。
import { defineAsyncComponent, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { decideEntry, entryIsStage, type EntryInput, type EntryResult } from "@/stage/entry";
import { decideMode, readGateInput } from "@/campus3d/gate";

const StageView = defineAsyncComponent(() => import("@/views/StageView.vue"));
const HomeView = defineAsyncComponent(() => import("@/views/HomeView.vue"));

/** 读浏览器构造 EntryInput（判定仍由 decideEntry 纯函数完成，同 gate.ts 的分工） */
function readEntryInput(): EntryInput {
  const params = new URLSearchParams(window.location.search);
  const qs = params.get("stage");
  return {
    mode: decideMode(readGateInput()).mode,
    viewportWidth: window.innerWidth,
    queryStage: qs === "1" ? "1" : qs === "0" ? "0" : null,
    prefer: localStorage.getItem("shzu.stage") === "classic" ? "classic" : null,
  };
}

function applyEntry(e: EntryResult) {
  document.documentElement.classList.toggle("is-stage", e.stage);
  entryIsStage.value = e.stage;
}

const entry = ref<EntryResult>(decideEntry(readEntryInput()));
applyEntry(entry.value);

const route = useRoute();
watch(() => route.fullPath, () => {
  // URL 变了：重读 ?stage= 与 shzu.stage（点击「校园」会先删掉 shzu.stage 再导航）
  entry.value = decideEntry(readEntryInput());
  applyEntry(entry.value);
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove("is-stage");
  entryIsStage.value = false;
});
</script>

<template>
  <StageView v-if="entry.stage" />
  <HomeView v-else />
</template>
