import { defineStore } from "pinia";
import { api, PreviewResponse, WorkflowDetail } from "@/api/client";

export const useWorkflowStore = defineStore("workflow", {
  state: () => ({
    flowId: "" as string,
    detail: null as WorkflowDetail | null,
    loadingFlow: false,
    inputs: {} as Record<string, any>,
    stepIndex: 0,
    historicalConfirmed: false,
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
  actions: {
    async loadFlow(flowId: string) {
      this.flowId = flowId;
      this.loadingFlow = true;
      this.inputs = {};
      this.stepIndex = 0;
      this.historicalConfirmed = false;
      this.fieldErrors = {};
      this.ruleResults = [];
      this.missingPersonal = [];
      this.previewValid = false;
      this.previewToken = "";
      this.lastError = "";
      try {
        this.detail = await api.workflow(flowId);
      } catch (e: any) {
        this.lastError = e?.message || "加载向导失败";
      } finally {
        this.loadingFlow = false;
      }
    },
    setField(key: string, value: any) {
      this.inputs = { ...this.inputs, [key]: value };
      this.previewValid = false; // 字段变更后清除预览有效标记（方案 F12）
      delete this.fieldErrors[key];
    },
    backToStep(i: number) {
      this.stepIndex = i;
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
  },
});