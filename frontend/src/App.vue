<script setup lang="ts">
import { useRoute } from "vue-router";
import { useKbMeta } from "@/composables";
import { entryIsStage } from "@/stage/entry";
import AppHeader from "@/components/AppHeader.vue";

// 顶栏（含手机菜单与主题入口）全部在 AppHeader；本文件只保留页脚与路由壳。
// 知识库版本与模型状态原在顶栏，现移到页脚（舞台在读数与问话栏状态行自持）。
const { ready } = useKbMeta();
const route = useRoute();
</script>

<template>
  <div>
    <!-- / 上 EntryView 渲染舞台时（entryIsStage）与 /stage（route.meta.stage）都由舞台自己的 AppHeader 顶替 -->
    <AppHeader v-if="!route.meta.stage && !entryIsStage" />

    <main>
      <router-view />
    </main>

    <footer v-if="!route.meta.stage && !entryIsStage">
      <div class="shell foot-inner">
        <div>
          <strong>石大智多星</strong> · 赛道一 · 揭榜命题 5（校园一站式服务智能体）<br />
          回答均给出可点开的官方出处链接；无依据时明确说"不足"，不编造。<br />
          <template v-if="ready">
            知识库 <span class="mono">{{ ready.knowledge_version }}</span> · {{ ready.knowledge_sources }} 来源 / {{ ready.knowledge_evidence }} 证据
            · 模型 {{ ready.model_configured ? ready.model_provider : "本地规则引擎（未配置 DeepSeek 密钥）" }}
          </template>
          <template v-else>连接知识服务中…</template>
        </div>
        <div style="text-align: right;">
          2025 年度 励志奖学金 办事向导为历史演示数据，已明确标注<br />
          <span class="mono">Vue 3 · FastAPI · {{ ready ? ready.knowledge_version : "" }}</span>
        </div>
      </div>
    </footer>
  </div>
</template>
