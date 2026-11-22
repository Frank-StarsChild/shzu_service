<script setup lang="ts">
// STAGE：舞台顶栏包装层。公共按钮（品牌 / 首页 / 校园对话 / 服务目录 / 主题）全部来自
// 全站共用的 AppHeader（stage 变体：同一布局与交互，底色换舞台玻璃、fixed 悬浮、随观景淡出）。
// 舞台专用操作（观景 / 普通版）在沙盘控制区（AskDock 工具行），不进顶栏；
// 原「问答」聚焦输入框的能力由舞台底部问话栏本身保留。
import AppHeader from "@/components/AppHeader.vue";
</script>

<template>
  <AppHeader stage />
</template>
