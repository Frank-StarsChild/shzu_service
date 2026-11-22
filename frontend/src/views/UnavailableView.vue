<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { api } from "@/api/client";

const router = useRouter();
const checking = ref(false);
const state = ref<"unknown" | "up" | "down">("unknown");
const message = ref("");

async function check() {
  checking.value = true;
  message.value = "";
  try {
    const r = await api.ready();
    state.value = "up";
    message.value = `知识服务正常 · 知识库 ${r.knowledge_version} · ${r.knowledge_sources} 来源 / ${r.knowledge_evidence} 条证据`;
  } catch (e: any) {
    state.value = "down";
    message.value = e?.message || "仍无法连接后端服务（127.0.0.1:8300）";
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="shell">

      <!-- 页头：沿用普通页面页头；首屏给出实际错误、重试与可返回的入口 -->
      <div class="page-head">
        <p class="index">— 服务状态 · <span class="mono">HTTP 502 / LOCAL RULES FALLBACK</span></p>
        <h1 class="h1">校园知识服务暂时不可用</h1>
        <p class="muted small" style="max-width: 60ch;">
          页面无法连接本地后端服务（127.0.0.1:8300）。这通常发生在：后端进程未启动、端口被占用，或知识库正在加载。
        </p>
        <div style="display: flex; gap: var(--gap-3); flex-wrap: wrap; margin-top: var(--gap-2);">
          <span v-if="state === 'up'" class="tag tag-ok">服务已恢复</span>
          <span v-else-if="state === 'down'" class="tag tag-red">服务不可用</span>
          <span v-else class="tag tag-soft">状态未检测</span>
        </div>
      </div>

      <!-- 首屏动作：重新检测 + 回到首页 -->
      <div class="box" style="margin-bottom: var(--gap-5);">
        <div class="box-head">
          <span class="label">恢复操作 RECOVERY</span>
        </div>
        <div class="box-body">
          <p v-if="message" class="small" :class="state === 'up' ? 'state-pass' : 'state-fail'">{{ message }}</p>
          <p v-else class="muted small">点击「重新检测」，确认本地后端 /api/v1/health/ready 是否恢复。</p>
          <div style="display: flex; gap: var(--gap-3); flex-wrap: wrap; align-items: center;">
            <button type="button" class="btn-red" :disabled="checking" @click="check">
              {{ checking ? "检测中…" : "重新检测" }}
            </button>
            <button type="button" @click="router.push('/')">回到首页 →</button>
          </div>
        </div>
      </div>

      <!-- 次级区域：技术细节与恢复路径（保留诊断和恢复功能） -->
      <div class="grid grid-2">
        <div class="box">
          <div class="box-head"><span class="label">恢复路径 RECOVERY</span></div>
          <div class="box-body">
            <div class="small" style="display: flex; flex-direction: column; gap: var(--gap-3);">
              <div>
                <strong>01 — 重新检测服务</strong><br />
                <span class="muted">点击上方「重新检测」，确认本地后端 /api/v1/health/ready 是否恢复。</span>
              </div>
              <div>
                <strong>02 — 重启演示环境</strong><br />
                <span class="muted">关闭旧窗口后，双击项目根目录的 start.bat，脚本会依次启动后端（8300）与前端（5180）。</span>
              </div>
              <div>
                <strong>03 — 端口被占用时</strong><br />
                <span class="muted">若 8300 / 5180 被其他程序占用，先结束对应进程再重新运行 start.bat。</span>
              </div>
            </div>
          </div>
        </div>

        <div class="box">
          <div class="box-head">
            <span class="label">健康检查 HEALTH</span>
            <span v-if="state === 'up'" class="tag tag-ok">服务正常</span>
            <span v-else-if="state === 'down'" class="tag tag-red">不可用</span>
            <span v-else class="tag tag-soft">未检测</span>
          </div>
          <div class="box-body">
            <p class="small muted mono" style="margin: 0 0 var(--gap-3);">&gt; GET /api/v1/health/ready</p>
            <p v-if="message" class="small" :class="state === 'up' ? 'state-pass' : 'state-fail'">{{ message }}</p>
            <p v-else class="muted small">尚未检测。点击「重新检测」获取当前服务状态。</p>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
