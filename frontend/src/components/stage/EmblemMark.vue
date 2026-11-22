<script setup lang="ts">
// ALIVE A1（3.1 节）：一枚院徽。鎏金（默认）= 鎏金渐变的圆 + 蒙版抠出图形；
// 本色 = 直接显示原色图。color 为 null 的学院（继教、护理）本色时仍显示鎏金。
// 蒙版地址必须传绝对地址（emblemUrl），CSS 变量里的 url() 按样式表位置解析相对地址。
import { computed } from "vue";
import type { College } from "@/stage/emblems";
import { emblemUrl } from "@/stage/emblems";

const props = withDefaults(
  defineProps<{
    college: College;
    size: number;
    tone: "gilt" | "color";
    ring?: "none" | "gold" | "red";
  }>(),
  { ring: "none" }
);

// 本色但拿不到原色图：实际用鎏金（data-tone 如实写实际用的样子）
const actualTone = computed<"gilt" | "color">(() =>
  props.tone === "color" && props.college.color ? "color" : "gilt"
);

const style = computed(() => {
  const base: Record<string, string> = {
    width: `${props.size}px`,
    height: `${props.size}px`,
  };
  if (actualTone.value === "color") {
    base.background = `url("${emblemUrl(props.college.color as string)}") center / contain no-repeat`;
  } else {
    // 蒙版经内联 CSS 变量传入（绝对地址）；-webkit-mask / mask 两行都在样式表里
    base["--mask"] = `url("${emblemUrl(props.college.mask)}")`;
  }
  if (props.ring === "gold") {
    base.boxShadow = "0 0 0 1px var(--st-gold2)";
  } else if (props.ring === "red") {
    base.boxShadow = "0 0 0 2px var(--st-red), 0 0 22px rgba(226, 0, 26, .55)";
  }
  return base;
});
</script>

<template>
  <span
    class="emblem-mark"
    :class="`tone-${actualTone}`"
    :data-testid="`stage-emblem-${college.no}`"
    :data-tone="actualTone"
    role="img"
    :aria-label="college.name"
    :style="style"
  ></span>
</template>

<style scoped>
.emblem-mark {
  display: inline-block;
  flex: none;
  border-radius: 50%;
}
/* 鎏金：金色渐变的圆，用院徽蒙版抠出图形（纸面透明） */
.emblem-mark.tone-gilt {
  background: var(--st-gilt);
  -webkit-mask: var(--mask) center / contain no-repeat;
  mask: var(--mask) center / contain no-repeat;
}
/* 本色：原色图（圆外透明），background 由内联样式给出 */
.emblem-mark.tone-color {
  background-color: transparent;
}
</style>
