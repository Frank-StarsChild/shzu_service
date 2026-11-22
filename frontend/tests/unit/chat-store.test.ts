// A0 验证：stores/chat.ts 的「重试选项带 choice_id」与「等回答时切页不丢回答」。
// vitest 环境是 node：localStorage 自己 stub；@/api/client 用假 api。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// 可编程的假 api 状态（vi.hoisted 让 vi.mock 的 factory 能引用）
const fake = vi.hoisted(() => {
  const storageMap = new Map<string, string>();
  return {
    chatCalls: [] as Array<Record<string, unknown>>,
    /** 下一次 api.chat 抛 500（retryable）；只消费一次 */
    failNextChat: false,
    /** api.chat 挂起（不 resolve）：测「切页不丢回答」用 */
    hangChat: false,
    hangReleasers: [] as Array<() => void>,
    /** api.chat 的正常返回内容 */
    chatResult: null as any,
    storage: {
      getItem: (k: string) => (storageMap.has(k) ? storageMap.get(k)! : null),
      setItem: (k: string, v: string) => void storageMap.set(k, String(v)),
      removeItem: (k: string) => void storageMap.delete(k),
      clear: () => storageMap.clear(),
      key: () => null,
      length: 0,
    } as Storage,
  };
});

vi.stubGlobal("localStorage", fake.storage);

vi.mock("@/api/client", () => ({
  api: {
    messages: vi.fn(async () => ({ messages: [] })),
    createSession: vi.fn(async () => ({ session_id: "sess-a0-test", expires_at: "2099-01-01T00:00:00Z" })),
    deleteSession: vi.fn(async () => ({})),
    chat: vi.fn(async (body: Record<string, unknown>) => {
      fake.chatCalls.push(body);
      if (fake.failNextChat) {
        fake.failNextChat = false;
        const err: any = new Error("模型服务暂时不可用（测试模拟 500）");
        err.status = 500;
        err.retryable = true;
        err.code = "model_error";
        throw err;
      }
      if (fake.hangChat) {
        return new Promise<any>((resolve) => { fake.hangReleasers.push(resolve); });
      }
      return fake.chatResult;
    }),
  },
}));

const CLARIFY_RESPONSE = {
  status: "clarify" as const,
  session_id: "sess-a0-test",
  request_id: "req-clarify",
  trace_id: "t",
  knowledge_version: "kb-a0",
  clarify: { question: "你是本科生还是研究生？", choices: [{ id: "undergraduate", label: "本科生" }] },
  citations: [],
  unknown_fields: [],
};

beforeEach(() => {
  setActivePinia(createPinia());
  fake.chatCalls.length = 0;
  fake.failNextChat = false;
  fake.hangChat = false;
  fake.hangReleasers.length = 0;
  fake.storage.clear();
  fake.chatResult = null;
});

describe("A0 · chat store 重试选项与切页恢复", () => {
  it("5 追问选项轮出错后重试：第二次请求发 choice_id 而不是选项文字", async () => {
    const { useChatStore } = await import("@/stores/chat");
    const store = useChatStore();
    // 先有一轮澄清（lastClarify 从这里取选项标签显示）
    store.turns.push({
      request_id: "req-clarify", seq: 1, role: "assistant", text: "",
      response: CLARIFY_RESPONSE as any, status: "done",
    });
    await store.ensureSession();
    fake.chatResult = {
      status: "answer", session_id: "sess-a0-test", request_id: "x", trace_id: "t",
      knowledge_version: "kb-a0", citations: [], unknown_fields: [],
      answer: { blocks: [], unknown_fields: [] }, message: "好的",
    };
    fake.failNextChat = true; // 第一次 500（retryable）
    await store.pickChoice("undergraduate");
    // 第一次调用带上 choice_id
    expect(fake.chatCalls[0].choice_id).toBe("undergraduate");
    // 这一轮进入了 error 态，可重试
    const errorTurn = store.turns.find((t) => t.status === "error");
    expect(errorTurn).toBeTruthy();
    expect(errorTurn!.retryable).toBe(true);
    // 重试：第二次请求体里 choice_id 还是选项 id，且没有 message 字段
    await store.retry(errorTurn!.request_id);
    expect(fake.chatCalls.length).toBe(2);
    expect(fake.chatCalls[1].choice_id).toBe("undergraduate");
    expect("message" in fake.chatCalls[1]).toBe(false);
    // 重试成功：error 轮恢复为 done
    const doneTurn = store.turns.find((t) => t.request_id === errorTurn!.request_id && t.role === "assistant");
    expect(doneTurn!.status).toBe("done");
  });

  it("5b 普通消息轮重试：仍按原文重发 message（不误带 choice_id）", async () => {
    const { useChatStore } = await import("@/stores/chat");
    const store = useChatStore();
    await store.ensureSession();
    fake.chatResult = {
      status: "answer", session_id: "sess-a0-test", request_id: "x", trace_id: "t",
      knowledge_version: "kb-a0", citations: [], unknown_fields: [],
      answer: { blocks: [], unknown_fields: [] }, message: "好的",
    };
    fake.failNextChat = true;
    await store.send("学生证丢了怎么办");
    const errorTurn = store.turns.find((t) => t.status === "error");
    expect(errorTurn).toBeTruthy();
    await store.retry(errorTurn!.request_id);
    expect(fake.chatCalls[1].message).toBe("学生证丢了怎么办");
    expect("choice_id" in fake.chatCalls[1]).toBe(false);
  });

  it("6 等回答时切页再回来：restore 不覆盖、pending 轮次还在", async () => {
    const { useChatStore } = await import("@/stores/chat");
    const store = useChatStore();
    await store.ensureSession();
    fake.hangChat = true; // api.chat 一直不返回
    const pendingSend = store.send("学生证丢了");
    await new Promise((r) => setTimeout(r, 50)); // 等 turns 里出现 pending
    expect(store.turns.some((t) => t.status === "pending")).toBe(true);
    expect(store.turns.find((t) => t.role === "user")?.text).toBe("学生证丢了");
    const turnsBefore = JSON.parse(JSON.stringify(store.turns));
    // 切页重挂载触发 restore()：不得用服务器的记录（这里返回空列表）覆盖本地轮次
    await store.restore();
    expect(store.turns.length).toBe(turnsBefore.length);
    expect(store.turns.some((t) => t.status === "pending")).toBe(true);
    expect(store.turns.find((t) => t.role === "user")?.text).toBe("学生证丢了");
    // 收尾：释放挂起的请求，避免泄漏
    fake.hangChat = false;
    fake.chatResult = {
      status: "answer", session_id: "sess-a0-test", request_id: "x", trace_id: "t",
      knowledge_version: "kb-a0", citations: [], unknown_fields: [],
      answer: { blocks: [], unknown_fields: [] }, message: "好的",
    };
    fake.hangReleasers.splice(0).forEach((resolve) => resolve(fake.chatResult));
    await pendingSend;
  });

  it("6b 没有等待中的轮次：restore 照旧用服务器记录覆盖（刷新后能恢复）", async () => {
    const { useChatStore } = await import("@/stores/chat");
    const store = useChatStore();
    await store.ensureSession();
    fake.storage.setItem("shzu.session_id", "sess-a0-test");
    // 本地没有 pending → restore 走服务器记录（messages 返回空 → turns 清空）
    store.turns.push({
      request_id: "old", seq: 1, role: "assistant", text: "旧", response: null, status: "done",
    });
    await store.restore();
    expect(store.turns.length).toBe(0);
  });
});
