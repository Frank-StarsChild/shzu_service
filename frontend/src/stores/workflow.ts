import { defineStore } from "pinia";
import { api, PreviewResponse, WorkflowDetail } from "@/api/client";
import { getFlowPreset, saveDraft, draftSummary, type FlowDraft } from "./flowDraft";

// 办事体验改造：向导状态。
// - 草稿按「会话 × 事项」持久化（flowDraft.ts）：同会话重进同一事项恢复
//   已确认值/手动修改值/当前步骤；手动修改优先于聊天带入的预设；
// - preset：聊天里学生自述的事实（后端 seed_slots 抽取），仅在对应槽位
//   尚无值时作为「待确认预设」出现，确认或跳过后不再弹出；
// - previewValid=false 表示旧核对结果/预览凭据已过期，导出前必须重新核对。
export const useWorkflowStore = defineStore("workflow", {
  state: () => ({
    flowId: "" as string,
    detail: null as WorkflowDetail | null,
    loadingFlow: false,
    inputs: {} as Record<string, any>,
    stepIndex: 0,
    historicalConfirmed: false,
    /** 草稿归属会话（loadFlow 传入；'' = 不持久化，如历史遗留调用） */
    sessionId: "" as string,
    /** 手动指定的草稿会话：从首页「继续办理」进入时恢复那个会话的草稿 */
    draftSessionId: "" as string,
    preset: {} as Record<string, any>,
    presetNote: "",
    presetConfirmedKeys: [] as string[],
    fieldErrors: {} as Record<string, string>,
    ruleResults: [] as PreviewResponse["rule_results"],
    missingPersonal: [] as string[],
    previewValid: false as boolean,
    previewToken: "" as string,
    previewing: false,
    exporting: false,
    lastExportName: "" as string,
    lastError: "" as string,
  }),
  getters: {
    /** 还需要确认的预设槽位：预设存在、未被确认/跳过、且表单里还没有值 */
    pendingPresetKeys(state): string[] {
      return Object.keys(state.preset).filter(
        (k) =>
          !state.presetConfirmedKeys.includes(k)
          && String(state.preset[k] ?? "").trim() !== ""
          && String(state.inputs[k] ?? "").trim() === ""
      );
    },
    /** 旧核对结果是否已过期（有结果但表单改过） */
    ruleResultsStale(state): boolean {
      return state.ruleResults.length > 0 && !state.previewValid;
    },
  },
  actions: {
    async loadFlow(flowId: string, opts?: {
      sessionId?: string;
      /** 覆盖要恢复的草稿归属会话（首页「继续办理」直接进入别的会话草稿） */
      draftSessionId?: string;
      preset?: Record<string, any>;
      presetNote?: string;
    }) {
      this.flowId = flowId;
      this.loadingFlow = true;
      this.lastError = "";
      this.fieldErrors = {};
      this.ruleResults = [];
      this.missingPersonal = [];
      this.previewValid = false;
      this.previewToken = "";
      this.sessionId = opts?.sessionId || "";
      this.draftSessionId = opts?.draftSessionId || opts?.sessionId || "";

      // 草稿恢复（会话 × 事项）
      const { loadDraft } = await import("./flowDraft");
      const draft: FlowDraft | null = this.draftSessionId
        ? loadDraft(this.draftSessionId, flowId)
        : null;
      this.inputs = draft ? { ...draft.inputs } : {};
      this.stepIndex = draft ? draft.stepIndex : 0;
      this.historicalConfirmed = draft ? draft.historicalConfirmed : false;
      this.presetConfirmedKeys = draft ? [...draft.presetConfirmedKeys] : [];

      // 预设：聊天带入的事实；草稿里已有值的键不覆盖（手动修改优先）
      const preset = opts?.preset ?? getFlowPreset(flowId)?.slots ?? {};
      const presetNote = opts?.presetNote ?? getFlowPreset(flowId)?.note ?? "";
      this.preset = {};
      this.presetNote = presetNote;
      for (const k of Object.keys(preset || {})) {
        if (String(this.inputs[k] ?? "").trim() === "") {
          this.preset = { ...this.preset, [k]: preset[k] };
        }
      }

      try {
        this.detail = await api.workflow(flowId);
      } catch (e: any) {
        this.lastError = e?.message || "加载向导失败";
      } finally {
        this.loadingFlow = false;
      }
      // 恢复的步骤号可能越界（流程改版）：夹回有效范围内
      if (this.detail && this.stepIndex >= this.detail.steps.length) {
        this.stepIndex = Math.max(0, this.detail.steps.length - 1);
      }
      this.persistDraft();
    },
    setField(key: string, value: any) {
      this.inputs = { ...this.inputs, [key]: value };
      this.previewValid = false; // 字段变更后清除预览有效标记（方案 F12）
      delete this.fieldErrors[key];
      this.persistDraft();
    },
    backToStep(i: number) {
      this.stepIndex = i;
      this.persistDraft();
    },
    nextStep() {
      if (!this.detail) return;
      this.stepIndex = Math.min(this.stepIndex + 1, this.detail.steps.length - 1);
      this.persistDraft();
    },
    prevStep() {
      this.stepIndex = Math.max(this.stepIndex - 1, 0);
      this.persistDraft();
    },
    /** 确认预设卡：写入表单值（学生在卡上可先改再确认） */
    confirmPreset(values: Record<string, any>) {
      let inputs = { ...this.inputs };
      for (const [k, v] of Object.entries(values)) {
        if (String(v ?? "").trim() !== "") inputs = { ...inputs, [k]: v };
      }
      this.inputs = inputs;
      const keys = Object.keys(this.preset);
      this.presetConfirmedKeys = [...new Set([...this.presetConfirmedKeys, ...keys])];
      this.preset = {};
      this.previewValid = false;
      this.persistDraft();
    },
    /** 跳过预设：不带入，留给表单自己填 */
    skipPreset() {
      const keys = Object.keys(this.preset);
      this.presetConfirmedKeys = [...new Set([...this.presetConfirmedKeys, ...keys])];
      this.preset = {};
      this.persistDraft();
    },
    setHistoricalConfirmed(on: boolean) {
      this.historicalConfirmed = on;
      this.persistDraft();
    },
    async preview() {
      if (!this.detail) return false;
      this.previewing = true;
      this.lastError = "";
      try {
        const r = await api.preview(this.flowId, {
          flow_version: this.detail.version,
          inputs: this.inputs,
          historical_confirmed: this.historicalConfirmed,
        });
        this.fieldErrors = Object.fromEntries(r.field_errors.map((f) => [f.slot_key, f.message]));
        this.ruleResults = r.rule_results;
        this.missingPersonal = r.missing_personal_fields;
        this.previewToken = r.preview_token;
        this.previewValid = r.generated;
        if (r.generated) this.stepIndex = Math.max(this.stepIndex, this.detail.steps.length - 1);
        this.persistDraft();
        return r.generated;
      } catch (e: any) {
        this.lastError = e?.message || "预览失败";
        this.fieldErrors = e?.field_errors || {};
        return false;
      } finally {
        this.previewing = false;
      }
    },
    async exportDoc() {
      if (!this.detail || !this.previewValid) return;
      this.exporting = true;
      this.lastError = "";
      try {
        const r = await api.exportDoc(this.flowId, {
          flow_version: this.detail.version,
          inputs: this.inputs,
          historical_confirmed: this.historicalConfirmed,
          preview_token: this.previewToken,
        }, this.detail.name + ".docx");
        this.lastExportName = r.filename;
        return r;
      } catch (e: any) {
        this.lastError = e?.message || "导出失败，已保留填写内容，可重试";
        if (e?.field_errors) this.fieldErrors = e.field_errors;
        if (e?.code === "preview_stale") {
          this.previewValid = false;
        }
        return null;
      } finally {
        this.exporting = false;
      }
    },
    /** 当前填写落盘（含首页「继续办理」摘要信息） */
    persistDraft() {
      if (!this.sessionId || !this.flowId || !this.detail) return;
      const draft: FlowDraft = {
        flowId: this.flowId,
        flowName: this.detail.name,
        inputs: { ...this.inputs },
        stepIndex: this.stepIndex,
        historicalConfirmed: this.historicalConfirmed,
        presetConfirmedKeys: [...this.presetConfirmedKeys],
        updatedAt: Date.now(),
        stepName: "",
        nextTodo: null,
      };
      draftSummary(draft, this.detail.steps, this.detail.slots);
      if (this.draftSessionId) {
        // 「继续办理」进入时：往草稿自身的会话键上写，保证再次进入仍可恢复
        saveDraft(this.draftSessionId, draft);
      }
      saveDraft(this.sessionId, draft);
    },
  },
});
