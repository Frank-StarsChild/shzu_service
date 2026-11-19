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

      <div class="hero" style="padding-top: var(--gap-6);">
        <p class="label" style="color: var(--red);">SERVICE UNAVAILABLE — 状态码 502 / LOCAL RULES FALLBACK</p>
        <h1 class="h-display">校园知识服务<br />暂时不可用。</h1>
        <p class="muted small" style="max-width: 60ch;">
          页面无法连接本地后端服务（127.0.0.1:8300）。这通常发生在：后端进程未启动、端口被占用，或知识库正在加载。
        </p>
      </div>

      <div class="grid grid-2" style="border-top: 2px solid var(--line); padding-top: var(--gap-5);">
        <div class="box">
          <div class="box-head"><span class="label">恢复路径 RECOVERY</span></div>
          <div class="box-body">
            <div class="small" style="display: flex; flex-direction: column; gap: var(--gap-3);">
              <div>
                <strong>01 — 重新检测服务</strong><br />
                <span class="muted">点击下方「重新检测」，确认本地后端 /api/v1/health/ready 是否恢复。</span>
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
          </div>
          <div class="box-body">
            <p class="small muted" style="margin: 0 0 var(--gap-3);">&gt; GET /api/v1/health/ready</p>
            <p v-if="message" class="small" :class="state === 'up' ? 'state-pass' : 'state-fail'">{{ message }}</p>
            <div style="display: flex; gap: var(--gap-3); flex-wrap: wrap;">
              <button type="button" class="btn-red" :disabled="checking" @click="check">
                {{ checking ? "检测中…" : "重新检测" }}
              </button>
              <button v-if="state === 'up'" type="button" @click="router.push('/')">回到首页 →</button>
            </div>
          </div>
        </div>
      </div>

    </div>
  </div>
</template>
