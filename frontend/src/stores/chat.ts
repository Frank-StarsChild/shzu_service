import { defineStore } from "pinia";
import { api, ChatResponse, TurnMessage } from "@/api/client";

const SESSION_KEY = "shzu.session_id";
const SLOW_REPLY_MS = 5000;

function newRequestId(): string {
  return "req-" + (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now());
}

export type ChatTurn = {
  request_id: string;
  seq: number;
  role: "user" | "assistant";
  text: string;
  response: ChatResponse | null;
  status: "pending" | "done" | "error" | "cancelled";
  errorText?: string;
  retryable?: boolean;
  /** 追问选项轮：记住选项 id（重试时发 choice_id 而不是选项文字） */
  choiceId?: string;
};

export const useChatStore = defineStore("chat", {
  state: () => ({
    sessionId: "" as string,
    turns: [] as ChatTurn[],
    pendingRequestId: null as string | null,
    lastSubmitText: "" as string,
    sessionInvalid: false as boolean,
    busy: false,
    slowResponse: false,
  }),
  getters: {
    pendingMessage: (state) => state.slowResponse
      ? "仍在核查资料，完成后会自动显示结果…"
      : "正在检索审定资料并组织回答…",
    lastClarify(state): ChatResponse | null {
      for (let i = state.turns.length - 1; i >= 0; i--) {
        const t = state.turns[i];
        if (t.role === "assistant" && t.response?.status === "clarify") return t.response;
        if (t.role === "user") return null; // 已被回答
      }
      return null;
    },
  },
  actions: {
    async ensureSession() {
      if (this.sessionId) {
        try {
          await api.messages(this.sessionId); // 验证会话有效
          return;
        } catch (e: any) {
          if (e?.status === 410 || e?.status === 404) {
            this.sessionInvalid = true;
          } else {
            throw e;
          }
        }
      }
      // 新建（或过期后重建）
      const s = await api.createSession();
      this.sessionId = s.session_id;
      localStorage.setItem(SESSION_KEY, s.session_id);
      this.sessionInvalid = false;
    },
    async restore() {
      const savedId = localStorage.getItem(SESSION_KEY) || "";
      // A0：正在等回答时切去别的页面再回来（舞台→全部对话等重挂载场景），
      // 不要用服务器的记录覆盖本地轮次——否则 pending 那一轮被冲掉，
      // 迟到的回答无处落地。其余情况照旧从服务器恢复（刷新后要能回放）。
      if (
        this.turns.length > 0
        && savedId === this.sessionId
        && this.sessionId !== ""
        && this.turns.some((t) => t.status === "pending")
      ) {
        return;
      }
      this.sessionId = savedId;
      if (!savedId) {
        await this.ensureSession();
        return;
      }
      try {
        const r = await api.messages(savedId);
        this.turns = (r.messages || []).map((m: TurnMessage) => ({
          request_id: m.request_id, seq: m.seq, role: m.role,
          text: m.text, response: m.response ?? null,
          status: "done" as const,
        }));
      } catch (e: any) {
        this.sessionId = "";
        localStorage.removeItem(SESSION_KEY);
      }
    },
    async newSession() {
      if (this.sessionId) {
        try { await api.deleteSession(this.sessionId); } catch {}
      }
      this.turns = [];
      const s = await api.createSession();
      this.sessionId = s.session_id;
      localStorage.setItem(SESSION_KEY, s.session_id);
    },
    cancel() {
      // 前端结束等待并丢弃迟到结果（方案 4.2）
      if (this.pendingRequestId) {
        const t = this.turns.find((x) => x.request_id === this.pendingRequestId && x.status === "pending");
        if (t) t.status = "cancelled";
        this.pendingRequestId = null;
      }
      this.busy = false;
      this.slowResponse = false;
    },
    async send(text: string) {
      const msg = text.trim();
      if (!msg || this.busy) return;
      await this.ensureSession();
      const requestId = newRequestId();
      this.lastSubmitText = msg;
      this.pendingRequestId = requestId;
      this.busy = true;
      const seqUser = this.turns.length + 1;
      this.turns.push({ request_id: requestId, seq: seqUser, role: "user", text: msg, response: null, status: "done" });
      const seqAssistant = this.turns.length + 1;
      this.turns.push({ request_id: requestId, seq: seqAssistant, role: "assistant", text: "", response: null, status: "pending" });
      await this._doRequest(requestId, { session_id: this.sessionId, request_id: requestId, message: msg });
    },
    async pickChoice(choiceId: string) {
      if (this.busy) return;
      await this.ensureSession();
      const requestId = newRequestId();
      this.pendingRequestId = requestId;
      this.busy = true;
      const label = this.lastClarify?.clarify?.choices.find((c) => c.id === choiceId)?.label || choiceId;
      // 记住选项 id（choiceId）：重试时发 choice_id，后端幂等比对的是 id 而非文字
      this.turns.push({ request_id: requestId, seq: this.turns.length + 1, role: "user", text: `[选择] ${label}`, response: null, status: "done", choiceId });
      this.turns.push({ request_id: requestId, seq: this.turns.length + 1, role: "assistant", text: "", response: null, status: "pending" });
      await this._doRequest(requestId, { session_id: this.sessionId, request_id: requestId, choice_id: choiceId });
    },
    async retry(requestId: string) {
      if (this.busy) return;
      const userTurn = this.turns.find((t) => t.request_id === requestId && t.role === "user");
      if (!userTurn) return;
      // A0：追问选项轮必须用记下的选项 id 重发（choice_id）；
      // 后端存的是选项 id，从显示文字里取会把选项标签当成 id 发出去，永远 409。
      const body: { session_id: string; request_id: string; message?: string; choice_id?: string } = {
        session_id: this.sessionId, request_id: requestId,
      };
      if (userTurn.choiceId) body.choice_id = userTurn.choiceId;
      else body.message = userTurn.text;
      // 基于原 request_id 的幂等重试（方案 4.2）
      this.busy = true;
      this.pendingRequestId = requestId;
      const assistant = this.turns.find((t) => t.request_id === requestId && t.role === "assistant");
      if (assistant) assistant.status = "pending";
      await this._doRequest(requestId, body);
    },
    async _doRequest(requestId: string, body: { session_id: string; request_id: string; message?: string; choice_id?: string }) {
      const slowTimer = setTimeout(() => {
        if (this.pendingRequestId === requestId) this.slowResponse = true;
      }, SLOW_REPLY_MS);
      try {
        const resp = await api.chat(body);
        const cur = this.turns.find((t) => t.request_id === requestId && t.role === "assistant");
        if (!cur || cur.status !== "pending") return; // 已取消，丢弃迟到结果
        cur.response = resp;
        cur.text = resp.message || "";
        cur.status = "done";
        this.lastSubmitText = body.message || body.choice_id || "";
      } catch (e: any) {
        const cur = this.turns.find((t) => t.request_id === requestId && t.role === "assistant");
        if (!cur || cur.status !== "pending") return;
        cur.status = "error";
        if (e?.status === 410) {
          this.sessionInvalid = true;
          cur.errorText = "会话已过期，请新建会话后重试";
        } else {
          cur.errorText = e?.message || "请求失败，可点击重试";
        }
        cur.retryable = e?.retryable ?? true;
      } finally {
        clearTimeout(slowTimer);
        if (this.pendingRequestId === requestId) {
          this.busy = false;
          this.slowResponse = false;
          this.pendingRequestId = null;
        }
      }
    },
  },
});
