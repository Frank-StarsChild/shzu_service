<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useKbMeta } from "@/composables";
import { entryIsStage } from "@/stage/entry";
import { decideMode, readGateInput } from "@/campus3d/gate";

const { ready } = useKbMeta();
const route = useRoute();
const menuOpen = ref(false);

// 路由切换时收起移动端抽屉
watch(() => route.fullPath, () => { menuOpen.value = false; });

const navItems = [
  { to: "/", label: "首页" },
  { to: "/chat", label: "校园对话" },
  { to: "/services", label: "服务目录" },
];

// ---- STAGE W6：普通版顶栏末尾的「校园」入口 ----
// 只在设备能跑 3D（decideMode = scene）且视口不小于 1100 时显示；点击删掉 shzu.stage
// （舞台「普通版」记下的选择），去 /?stage=1 回舞台。当前页带着 ?3d=1（软件渲染环境里
// 唯一能强制 scene 的开关）时把它一并带上，否则那种环境回不了舞台。
const canStage = ref(false);
const campusTo = ref("/?stage=1");

onMounted(() => {
  const input = readGateInput();
  canStage.value = decideMode(input).mode === "scene" && window.innerWidth >= 1100;
  if (input.query3d === "1") campusTo.value = "/?stage=1&3d=1";
});

function goCampus() {
  localStorage.removeItem("shzu.stage");
}
</script>

<template>
  <div>
    <!-- STAGE W6：/ 上 EntryView 渲染舞台时（entryIsStage）与 /stage（route.meta.stage）都藏掉顶栏页脚 -->
    <header v-if="!route.meta.stage && !entryIsStage" class="topbar">
      <div class="topbar-inner">
        <router-link to="/" class="brand" style="border-bottom: none;">
          <span class="brand-mark">石</span>
          <span>
            <span class="brand-name">石大智多星</span>
            <span class="brand-sub" style="display: block;">SHZU Campus Service Agent</span>
          </span>
        </router-link>
        <nav class="nav">
          <router-link v-for="n in navItems" :key="n.to" :to="n.to">{{ n.label }}</router-link>
          <!-- STAGE W6：回舞台（设备够格才显示；点击清掉「普通版」的选择） -->
          <router-link v-if="canStage" class="nav-campus" :to="campusTo" @click="goCampus">校园</router-link>
        </nav>
        <div class="topbar-meta">
          <template v-if="ready">
            知识库 <span class="mono">{{ ready.knowledge_version }}</span> · {{ ready.knowledge_sources }} 来源 / {{ ready.knowledge_evidence }} 证据<br />
            模型 {{ ready.model_configured ? ready.model_provider : "本地规则引擎（未配置 DeepSeek 密钥）" }}
          </template>
          <template v-else>连接知识服务中…</template>
        </div>
        <button class="mob-nav-toggle btn-sm" type="button" @click="menuOpen = !menuOpen" aria-label="打开导航">
          {{ menuOpen ? "关闭" : "菜单" }}
        </button>
      </div>
      <div v-if="menuOpen" class="mob-drawer">
        <router-link v-for="n in navItems" :key="n.to" :to="n.to" class="mob-drawer-link">
          {{ n.label }}
        </router-link>
      </div>
    </header>

    <main>
      <router-view />
    </main>

    <footer v-if="!route.meta.stage && !entryIsStage">
      <div class="shell foot-inner">
        <div>
          <strong>石大智多星</strong> · 赛道一 · 揭榜命题 5（校园一站式服务智能体）<br />
          回答均给出可点开的官方出处链接；无依据时明确说"不足"，不编造。
        </div>
        <div style="text-align: right;">
          2025 年度 励志奖学金 办事向导为历史演示数据，已明确标注<br />
          <span class="mono">Vue 3 · FastAPI · {{ ready ? ready.knowledge_version : "" }}</span>
        </div>
      </div>
    </footer>
  </div>
</template>

<style scoped>
  .brand { align-items: center; }
  /* STAGE W6：「回舞台」的入口，朱红描边呼应舞台里的「普通版」按钮 */
  .nav-campus { border: 1px solid var(--red); padding: 4px 10px; color: var(--red); }
  .nav-campus:hover { background: var(--red); color: #fff; }
  .mob-drawer { border-top: 1px solid var(--line-soft); background: var(--paper); }
.mob-drawer-link {
  display: block; padding: 13px var(--gap-6); font-size: 15px; font-weight: 500;
  border-bottom: none; border-left: 4px solid transparent;
}
.mob-drawer-link.router-link-active { border-left: 4px solid var(--red); background: var(--paper-2); }
</style>
