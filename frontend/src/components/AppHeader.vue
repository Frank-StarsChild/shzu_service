<script setup lang="ts">
// 全站共用顶栏：3D 舞台、普通首页、聊天、服务目录、办事向导、证据详情、异常页共用同一份按钮。
// 桌面：左「印章 + 石大智多星」，右「首页 / 校园对话 / 服务目录 / 主题」；统一 64px 高、左右 28px。
// 舞台传 stage 变体（按钮与布局同一份，底色换舞台玻璃、fixed 悬浮、随观景淡出）；
// 舞台专用操作（观景 / 普通版）在沙盘控制区，不进顶栏。
// 选中态 = 文字变色 + 2px 朱砂下划线（下划线常驻透明、字重不变 → 切换不挤动相邻按钮）。
// 选中判定：首页 = /、/classic、/stage；校园对话 = /chat*；服务目录 = /services* 与 /workflows*
// （进入向导保持「服务目录」选中）；证据、异常等来源不明的页面不点亮任何项。
// 知识库版本与模型状态不进顶栏（普通版在页脚；舞台在读数与问话栏状态行）。
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ThemeSwitch from "@/components/ThemeSwitch.vue";

const props = defineProps<{ stage?: boolean }>();

const route = useRoute();
const menuOpen = ref(false);

const NAV = [
  { key: "home", to: "/", label: "首页", testid: "app-nav-home" },
  { key: "chat", to: "/chat", label: "校园对话", testid: "app-nav-chat" },
  { key: "services", to: "/services", label: "服务目录", testid: "app-nav-services" },
] as const;

function isActive(key: "home" | "chat" | "services"): boolean {
  const p = route.path;
  if (key === "home") return p === "/" || p === "/classic" || p === "/stage";
  if (key === "chat") return p.startsWith("/chat");
  return p.startsWith("/services") || p.startsWith("/workflows");
}

// 页变体保留 .topbar 兼容类名（旧测试按它计数）；舞台变体保留 .stage-top（观景淡出选择器）
const rootClass = computed(() => [
  "app-header",
  props.stage ? "app-header--stage stage-top" : "app-header--page topbar",
]);
const rootTestid = computed(() => (props.stage ? "stage-top" : "app-top"));

watch(() => route.fullPath, () => { menuOpen.value = false; });
function closeMenu() { menuOpen.value = false; }
</script>

<template>
  <header :class="rootClass" :data-testid="rootTestid">
    <div class="app-header-inner">
      <router-link to="/" class="app-brand" aria-label="石大智多星 · 首页">
        <img src="/campus3d/ui/seal.svg" alt="" class="app-brand-seal" data-testid="app-brand-seal" width="38" height="38" />
        <span class="app-brand-text">
          <span class="app-brand-name">石大智多星</span>
          <span class="app-brand-sub">石河子大学 · 校园一站式服务</span>
        </span>
      </router-link>

      <div class="app-header-right">
        <nav class="app-nav" aria-label="主导航">
          <router-link v-for="n in NAV" :key="n.key" :to="n.to" class="app-nav-link"
                       :class="{ 'is-active': isActive(n.key) }" :data-testid="n.testid"
                       :aria-current="isActive(n.key) ? 'page' : undefined">
            {{ n.label }}
          </router-link>
        </nav>

        <div class="app-header-side">
          <ThemeSwitch class="app-theme" />
          <button class="app-menu-toggle btn-sm" type="button" :aria-expanded="menuOpen ? 'true' : 'false'"
                  aria-controls="app-menu" aria-label="打开导航" @click="menuOpen = !menuOpen">
            {{ menuOpen ? "关闭" : "菜单" }}
          </button>
        </div>
      </div>
    </div>

    <!-- 手机抽屉：顺序与桌面一致；点任意项即关闭（含当前项） -->
    <div v-if="menuOpen" id="app-menu" class="app-menu">
      <router-link v-for="n in NAV" :key="n.key" :to="n.to" class="app-menu-link"
                   :class="{ 'is-active': isActive(n.key) }" @click="closeMenu">
        {{ n.label }}
      </router-link>
    </div>
  </header>
</template>
