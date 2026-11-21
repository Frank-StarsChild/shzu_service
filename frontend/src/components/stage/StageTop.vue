<script setup lang="ts">
// STAGE W2：顶栏。左：印章 + 名称；右：导航（问答/服务/观景/普通版）。
// W6：问答/服务/普通版做实；W8：观景做实（静态模式、开启减少动态时不显示这一项）。
import { computed, inject } from "vue";
import { useStageStore } from "@/stores/stage";
import type { StageCtx } from "@/stage/types";

const store = useStageStore();
const ctx = inject<StageCtx>("stageCtx");

/** 观景入口只在 3D 可用且未开减少动态时显示（W8.md 第 5 条） */
const canTour = computed(
  () =>
    ctx?.gate.value.mode === "scene"
    && !(typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
);

/** 「问答」：聚焦底部问话栏的输入框（舞台内部不跳页，W6.md 第 3 条） */
function focusAsk() {
  const input = document.querySelector<HTMLInputElement>('[data-testid="stage-input"]');
  input?.focus();
}

/** 「普通版」：记住选择再去 /classic（下次打开首页走普通版，点「校园」清除） */
function preferClassic() {
  localStorage.setItem("shzu.stage", "classic");
}
</script>

<template>
  <div class="stage-top" data-testid="stage-top">
    <div class="stage-top-brand">
      <img src="/campus3d/ui/seal.svg" alt="智多星印" data-testid="stage-seal" class="stage-seal" width="38" height="38" />
      <span class="stage-top-name">石大智多星</span>
      <span class="stage-top-sub">石河子大学 · 校园一站式服务</span>
    </div>
    <nav class="stage-top-nav">
      <a data-testid="stage-nav-ask" class="stage-nav is-current" href="javascript:void(0)" @click.prevent="focusAsk">问答</a>
      <router-link data-testid="stage-nav-services" class="stage-nav" to="/services">服务</router-link>
      <a v-if="canTour" data-testid="stage-nav-tour" class="stage-nav" href="javascript:void(0)" @click.prevent="store.setTour(true)">观景</a>
      <router-link data-testid="stage-nav-classic" class="stage-nav-classic" to="/classic" @click="preferClassic">普通版</router-link>
    </nav>
  </div>
</template>

<style scoped>
.stage-top {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 64px;
  padding: 0 28px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  z-index: 4;
  background: linear-gradient(to bottom, rgba(5, 8, 13, 0.85), rgba(5, 8, 13, 0));
}
.stage-top-brand {
  display: flex;
  align-items: center;
  gap: 14px;
}
.stage-seal {
  width: 38px;
  height: 38px;
  display: block;
}
.stage-top-name {
  font-family: var(--st-song);
  font-weight: 700;
  font-size: 22px;
  letter-spacing: 0.12em;
  color: var(--st-moon);
}
.stage-top-sub {
  font-family: var(--st-song);
  font-size: 11px;
  letter-spacing: 0.34em;
  color: var(--st-moon3);
  margin-left: 2px;
}
.stage-top-nav {
  display: flex;
  align-items: baseline;
  gap: 26px;
}
.stage-nav {
  font-family: var(--st-song);
  font-size: 15px;
  letter-spacing: 0.2em;
  color: var(--st-moon2);
  text-decoration: none;
}
.stage-nav.is-current {
  color: var(--st-moon);
  border-bottom: 2px solid var(--st-red);
  padding-bottom: 3px;
}
.stage-nav-classic {
  font-family: var(--st-hei);
  font-size: 12px;
  letter-spacing: 0.2em;
  color: var(--st-moon2);
  text-decoration: none;
  border: 1px solid var(--st-gold3);
  padding: 4px 10px;
}
</style>
