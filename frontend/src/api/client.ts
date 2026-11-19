// apiClient：fetch + AbortController + 统一错误（方案 4.2）
// Vite 代理 /api → 8300；生产同域。
export type ApiError = {
  code: string;
  message: string;
  retryable: boolean;
  trace_id?: string;
  field_errors?: Record<string, string>;
  status: number;
};

export class RequestError extends Error implements ApiError {
  code: string;
  retryable: boolean;
  trace_id?: string;
  field_errors?: Record<string, string>;
  status: number;
  constructor(e: ApiError) {
    super(e.message);
    this.code = e.code;
    this.retryable = e.retryable;
    this.trace_id = e.trace_id;
    this.field_errors = e.field_errors;
    this.status = e.status;
  }
}

const BASE = "";
const DEFAULT_TIMEOUT_MS = 20000;

async function request<T>(
  path: string,
  init: RequestInit & { signal?: AbortSignal } = {},
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // 合并调用方 signal（页面取消）
  if (init.signal) {
    init.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  }
  try {
    const resp = await fetch(BASE + path, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    if (resp.status === 204) return undefined as T;
    const text = await resp.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (!resp.ok) {
      const detail = data?.detail ?? data?.error;
      if (detail && typeof detail === "object") {
        throw new RequestError({
          code: detail.code ?? "http_error",
          message: detail.message ?? `HTTP ${resp.status}`,
          retryable: detail.retryable ?? resp.status >= 500,
          trace_id: detail.trace_id,
          field_errors: detail.field_errors,
          status: resp.status,
        });
      }
      throw new RequestError({
        code: `http_${resp.status}`,
        message: (typeof detail === "string" && detail) || `HTTP ${resp.status}`,
        retryable: resp.status >= 500,
        status: resp.status,
      });
    }
    return data as T;
  } finally {
    clearTimeout(timer);
  }
}

async function download(path: string, body: any, fallbackName: string, signal?: AbortSignal) {
  const ctrl = new AbortController();
  if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const resp = await fetch(BASE + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      const text = await resp.text();
      let detail: any = null;
      try {
        detail = JSON.parse(text)?.detail;
      } catch {}
      throw new RequestError({
        code: detail?.code ?? `http_${resp.status}`,
        message: detail?.message ?? `导出失败 HTTP ${resp.status}`,
        retryable: resp.status >= 500,
        field_errors: detail?.field_errors,
        status: resp.status,
      });
    }
    const blob = await resp.blob();
    // 从 Content-Disposition 解析文件名（含中文 RFC5987）
    let filename = fallbackName;
    const cd = resp.headers.get("content-disposition") || "";
    const mStar = cd.match(/filename\*=(?:UTF-8'')?([^;]+)/i);
    const mPlain = cd.match(/filename="?([^";]+)"?/i);
    if (mStar) {
      try { filename = decodeURIComponent(mStar[1].replace(/"/g, "")); } catch {}
    } else if (mPlain) {
      filename = mPlain[1];
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return { filename, size: blob.size };
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 类型（与后端契约对应） ----------

export type ChatRequest = {
  session_id: string;
  request_id: string;
  message?: string;
  choice_id?: string;
};

export type CitationRef = {
  id: string;
  title: string;
  issuer: string;
  url: string;
  published_at?: string | null;
  locator?: string | null;
  excerpt?: string | null;
  time_condition?: string | null;
};

export type ChatResponse = {
  status: "answer" | "clarify" | "insufficient" | "out_of_scope" | "workflow" | "error" | "model_unavailable";
  session_id: string;
  request_id: string;
  trace_id: string;
  knowledge_version: string;
  answer?: { blocks: { kind: string; text: string; citation_ids: string[] }[]; unknown_fields: string[] };
  clarify?: { question: string; choices: { id: string; label: string }[]; input_hint?: string | null };
  reason_code?: string | null;
  unknown_fields: string[];
  message?: string | null;
  workflow?: { flow_id: string; flow_version: string; scope: any; historical: boolean; name: string; summary: string };
  citations: CitationRef[];
  timing_ms?: number | null;
};

export type TurnMessage = {
  request_id: string;
  seq: number;
  role: "user" | "assistant";
  status: string;
  text: string;
  response: ChatResponse | null;
};

export type SlotSpec = {
  key: string;
  label: string;
  type: "text" | "textarea" | "choice" | "number" | "date" | "time" | "tel";
  options: string[];
  required: boolean;
  personal: boolean;
  note?: string | null;
};

export type RuleResult = {
  rule_id: string;
  name: string;
  state: "pass" | "fail" | "unknown";
  explain: string;
  evidence_ids: string[];
};

export type WorkflowDetail = {
  flow_id: string;
  name: string;
  version: string;
  historical: boolean;
  demo_notice?: string | null;
  scope: any;
  steps: { key: string; name: string; desc: string; evidence_ids: string[] }[];
  slots: SlotSpec[];
  rule_results: RuleResult[];
  materials: { name: string; status: string; submit_or_keep: string; evidence_ids: string[] }[];
  timeline: { owner: string; action: string }[];
  contact?: { person?: string; phone?: string; email?: string } | null;
  evidence_ids: string[];
};

export type PreviewResponse = {
  preview_token: string;
  flow_id: string;
  flow_version: string;
  field_errors: { slot_key: string; message: string }[];
  rule_results: RuleResult[];
  materials: { name: string; status: string; submit_or_keep: string; evidence_ids: string[] }[];
  missing_personal_fields: string[];
  document_kinds: string[];
  evidence_ids: string[];
  generated: boolean;
};

export type ServiceEntry = {
  service_id: string;
  name: string;
  board: string;
  summary: string;
  evidence_ids: string[];
  flow_id?: string | null;
  data_status: string;
  sample_questions: string[];
};

// ---------- api ----------

export const api = {
  live: () => request<{ status: string }>("/api/v1/health/live"),
  ready: () => request<{
    status: string; knowledge_version: string; knowledge_sources: number;
    knowledge_evidence: number; model_provider: string; model_configured: boolean;
  }>("/api/v1/health/ready"),

  createSession: () => request<{ session_id: string; expires_at: string }>("/api/v1/sessions", { method: "POST" }),
  messages: (sid: string) => request<{ messages: TurnMessage[] }>(`/api/v1/sessions/${sid}/messages`),
  deleteSession: (sid: string) => request<void>(`/api/v1/sessions/${sid}`, { method: "DELETE" }),

  chat: (req: ChatRequest, signal?: AbortSignal) =>
    request<ChatResponse>("/api/v1/chat", { method: "POST", body: JSON.stringify(req), signal }),

  services: (board?: string, q?: string) =>
    request<{ services: ServiceEntry[]; knowledge_version: string }>(
      `/api/v1/services${board || q ? "?" + new URLSearchParams({ ...(board ? { board } : {}), ...(q ? { q } : {}) }).toString() : ""}`),

  evidence: (id: string) =>
    request<{
      id: string; title: string; issuer: string; url: string;
      published_at?: string | null; effective_from?: string | null; effective_to?: string | null;
      locator?: string | null; excerpt: string; time_condition?: string | null;
      review_state?: string | null; doc_id: string; knowledge_version: string;
    }>(`/api/v1/evidence/${encodeURIComponent(id)}`),

  workflows: () => request<{ workflows: { flow_id: string; name: string; version: string; historical: boolean; boards: string[]; steps: string[] }[] }>("/api/v1/workflows"),
  workflow: (id: string) => request<WorkflowDetail>(`/api/v1/workflows/${id}`),

  preview: (id: string, body: { flow_version: string; inputs: Record<string, any>; historical_confirmed: boolean }) =>
    request<PreviewResponse>(`/api/v1/workflows/${id}/preview`, { method: "POST", body: JSON.stringify(body) }),

  exportDoc: (id: string, body: { flow_version: string; inputs: Record<string, any>; historical_confirmed: boolean; preview_token: string }, fallback: string, signal?: AbortSignal) =>
    download(`/api/v1/workflows/${id}/export`, body, fallback, signal),
};