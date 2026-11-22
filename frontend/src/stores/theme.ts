// 全站主题状态：日间 / 夜间 / 跟随系统。
// - 实际生效的主题写在 document.documentElement 的 data-theme 上，并同步 color-scheme；
//   swiss.css / stage.css 的令牌都挂在 data-theme 上（theme.css）。
// - 首次默认跟随系统；手动选择持久化到 localStorage（shzu.theme）。
//   存储值无效（未知串/空）一律回退跟随系统；存储不可用（隐私模式等）只本次访问内生效。
// - 系统主题变化只在 mode === 'system' 时改变 applied（手动选择不被动覆盖）。
// - 切换主题只改 <html> 的属性，不触碰路由 / 对话 / 表单 / 沙盘状态。
// - index.html 里有同款预置脚本，在挂载前写入 data-theme，防止夜间刷新先闪白；
//   本 store 的 init() 会重新求值并幂等地再写一次。
import { computed, ref, watch } from "vue";
import { defineStore } from "pinia";

export type ThemeMode = "light" | "dark" | "system";
export type AppliedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "shzu.theme";

/** 纯函数：解析 localStorage 的原始值；无效值（含 null/空/未知串）回退 system */
export function parseStoredTheme(raw: string | null | undefined): ThemeMode {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

/** 纯函数：由模式 + 系统外观求实际生效主题 */
export function resolveApplied(mode: ThemeMode, systemDark: boolean): AppliedTheme {
  if (mode === "system") return systemDark ? "dark" : "light";
  return mode;
}

function readStored(): ThemeMode {
  try {
    return parseStoredTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "system"; // 存储不可用
  }
}

function persist(mode: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    /* 存储不可用：只在本次访问内生效，不报错 */
  }
}

export const useThemeStore = defineStore("theme", () => {
  const mode = ref<ThemeMode>("system");
  const systemDark = ref(false);
  const applied = computed(() => resolveApplied(mode.value, systemDark.value));

  let started = false;
  let mq: MediaQueryList | null = null;

  /** 把生效主题写到 <html>（data-theme + color-scheme + 底色兜底） */
  function apply(): void {
    if (typeof document === "undefined") return;
    const t = applied.value;
    const root = document.documentElement;
    root.setAttribute("data-theme", t);
    root.style.colorScheme = t;
    // 与 index.html 预置脚本同源的底色兜底（夜间滚动越界时不闪白；打印由 print 样式覆盖）
    root.style.background = t === "dark" ? "#0c1420" : "#f6f3ea";
  }

  // applied 变化（含跟随系统时系统外观变化）→ 应用；手动模式下系统变化不触发重算
  watch(applied, () => apply());

  /** 手动选择主题：立即生效并持久化 */
  function setMode(next: ThemeMode): void {
    mode.value = next;
    persist(next);
    apply();
  }

  /** 应用启动时调用一次（main.ts）：读存储、监听系统外观、首次应用 */
  function init(): void {
    if (started) return;
    started = true;
    if (typeof window === "undefined") return;
    mode.value = readStored();
    if (typeof window.matchMedia === "function") {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      systemDark.value = mq.matches;
      const onChange = (e: MediaQueryListEvent) => {
        // 系统外观变化：跟随系统时 applied 重算并应用；手动选择不受影响
        systemDark.value = e.matches;
      };
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", onChange);
      else if (typeof (mq as MediaQueryList & { addListener?: (f: (e: MediaQueryListEvent) => void) => void }).addListener === "function") {
        (mq as MediaQueryList & { addListener: (f: (e: MediaQueryListEvent) => void) => void }).addListener(onChange); // 旧 Safari
      }
    }
    apply();
  }

  return { mode, systemDark, applied, setMode, init };
});
