<script setup lang="ts">
import { ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useKbMeta } from "@/composables";

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
</script>

<template>
  <div>
    <header class="topbar">
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

    <footer>
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
.mob-drawer { border-top: 1px solid var(--line-soft); background: var(--paper); }
.mob-drawer-link {
  display: block; padding: 13px var(--gap-6); font-size: 15px; font-weight: 500;
  border-bottom: none; border-left: 4px solid transparent;
}
.mob-drawer-link.router-link-active { border-left: 4px solid var(--red); background: var(--paper-2); }
</style>
