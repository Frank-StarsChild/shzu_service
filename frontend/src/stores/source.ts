import { defineStore } from "pinia";
import { api } from "@/api/client";

type EvidenceDetail = Awaited<ReturnType<typeof api.evidence>>;

export const useSourceStore = defineStore("source", {
  state: () => ({
    cache: {} as Record<string, EvidenceDetail>, // key: `${version}:${id}`
    loading: {} as Record<string, boolean>,
    failed: {} as Record<string, string>,
  }),
  actions: {
    async load(evidenceId: string, version?: string) {
      const key = `${version || "current"}:${evidenceId}`;
      if (this.cache[key] || this.loading[key]) return this.cache[key];
      this.loading[key] = true;
      this.failed[key] = "";
      try {
        const d = await api.evidence(evidenceId);
        this.cache[key] = { ...d, knowledge_version: version || d.knowledge_version };
        return this.cache[key];
      } catch (e: any) {
        this.failed[key] = e?.message || "加载失败";
        return null;
      } finally {
        this.loading[key] = false;
      }
    },
  },
});