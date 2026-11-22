<script setup lang="ts">
// 全站唯一的主题选择组件（AppHeader 右端，全部页面同一份）。
// - 宽屏：三段式内联（原生 button，可 Tab、可 Enter/空格触发），aria-pressed 标记当前模式，
//   当前项朱砂下划线（常驻透明下划线 + 字重不变 → 切换不动布局）。
// - 窄屏（≤780px）：收成一个固定宽紧凑按钮，点开弹出同样的三选（点外部 / Esc 收起）；
//   固定宽度保证模式文字变化（日间/夜间/跟随系统）时按钮与相邻元素不移动。
// - 切换只改 <html> 的 data-theme（store 内完成），不触碰路由 / 对话 / 表单 / 沙盘状态。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useThemeStore, type ThemeMode } from "@/stores/theme";

const theme = useThemeStore();

const OPTIONS: { value: ThemeMode; label: string; title: string }[] = [
  { value: "light", label: "日间", title: "日间：暖纸白底、墨色正文、朱砂强调" },
  { value: "dark", label: "夜间", title: "夜间：墨蓝底、月白正文、鎏金细线" },
  { value: "system", label: "跟随系统", title: "跟随系统外观自动切换日间/夜间" },
];

const currentLabel = computed(() => OPTIONS.find((o) => o.value === theme.mode)?.label ?? "跟随系统");

// 窄屏紧凑模式（与顶栏导航收进菜单的断点一致）
const narrow = ref(false);
const open = ref(false);
const root = ref<HTMLElement | null>(null);
let mq: MediaQueryList | null = null;

function onMq(e: MediaQueryListEvent) {
  narrow.value = e.matches;
  if (!e.matches) open.value = false;
}
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => {
  mq = window.matchMedia("(max-width: 780px)");
  narrow.value = mq.matches;
  mq.addEventListener("change", onMq);
  document.addEventListener("click", onDocClick);
});

onBeforeUnmount(() => {
  mq?.removeEventListener("change", onMq);
  document.removeEventListener("click", onDocClick);
});

function pick(m: ThemeMode) {
  theme.setMode(m);
  open.value = false;
}
function toggle() {
  open.value = !open.value;
}
</script>

<template>
  <!-- 宽屏：三段式内联 -->
  <div v-if="!narrow" ref="root" class="theme-switch" role="group" aria-label="界面主题" data-testid="theme-switch">
    <button
      v-for="o in OPTIONS"
      :key="o.value"
      type="button"
      class="theme-option"
      :class="{ 'is-active': theme.mode === o.value }"
      :aria-pressed="theme.mode === o.value"
      :data-testid="`theme-${o.value}`"
      :title="o.title"
      @click="theme.setMode(o.value)"
    >{{ o.label }}</button>
  </div>

  <!-- 窄屏：紧凑按钮 + 弹出选择（同一份数据与 setMode） -->
  <div v-else ref="root" class="theme-switch theme-switch--compact" data-testid="theme-switch">
    <button
      type="button"
      class="theme-option theme-compact"
      :aria-expanded="open ? 'true' : 'false'"
      aria-haspopup="true"
      :aria-label="`界面主题（当前${currentLabel}）`"
      data-testid="theme-compact"
      :title="`界面主题（当前${currentLabel}）`"
      @click="toggle"
      @keydown.escape="open = false"
    >
      <span class="theme-compact-label">{{ currentLabel }}</span>
      <span class="theme-compact-caret" aria-hidden="true">▾</span>
    </button>
    <div v-if="open" class="theme-pop" role="group" aria-label="界面主题" @keydown.escape="open = false">
      <button
        v-for="o in OPTIONS"
        :key="o.value"
        type="button"
        class="theme-option"
        :class="{ 'is-active': theme.mode === o.value }"
        :aria-pressed="theme.mode === o.value"
        :data-testid="`theme-${o.value}`"
        :title="o.title"
        @click="pick(o.value)"
      >{{ o.label }}</button>
    </div>
  </div>
</template>

<style scoped>
/* 三段式：细线外框、宋体小字；当前项朱砂下划线（字重不变，切换不动布局） */
.theme-switch {
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--line-soft);
  background: var(--bg-panel-alpha);
}

.theme-option {
  /* 覆盖全局 button 的尺寸/立体感：这是一个轻量分段控件 */
  min-height: 0;
  min-width: 0;
  padding: 4px 10px;
  border: none;
  border-radius: 0;
  border-bottom: 2px solid transparent;
  background: none;
  box-shadow: none;
  transform: none;
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.12em;
  line-height: 1.6;
  color: var(--text-2);
}

.theme-option + .theme-option {
  border-left: 1px solid var(--line-soft);
}

.theme-option:hover {
  background: var(--bg-panel-2);
  color: var(--text);
  transform: none;
  box-shadow: none;
}

.theme-option:focus-visible {
  outline: 2px solid var(--focus);
  outline-offset: -2px;
}

.theme-option.is-active {
  color: var(--link);
  border-bottom-color: var(--vermilion);
}

.theme-option.is-active:hover {
  color: var(--link);
  background: var(--bg-panel-2);
}

/* ---------- 窄屏紧凑模式 ---------- */
.theme-switch--compact {
  position: relative;
  border: 1px solid var(--line-soft);
  background: var(--bg-panel-alpha);
}

/* 固定宽度：模式文字（日间/夜间/跟随系统）变化时不改变按钮与相邻元素的位置 */
.theme-compact {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  width: 88px;
  padding: 4px 6px;
}

.theme-compact-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.theme-compact-caret {
  flex: none;
  font-size: 9px;
  line-height: 1;
  color: var(--text-3);
}

.theme-compact:hover {
  background: var(--bg-panel-2);
  color: var(--text);
}

/* 弹出三选：落在按钮下方、右对齐；仅窄屏渲染 */
.theme-pop {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  min-width: 128px;
  background: var(--bg-panel);
  border: 1px solid var(--line);
  box-shadow: var(--sh-card);
}

.theme-pop .theme-option {
  width: 100%;
  text-align: left;
  padding: 8px 12px;
  border-bottom: 1px solid var(--line-soft);
}

.theme-pop .theme-option:last-child {
  border-bottom: none;
}
</style>
