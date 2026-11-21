// STAGE W2：舞台界面层访问场景上下文的类型（StageCanvas provide / 各界面组件 inject）。
import type { GateResult } from "@/campus3d/gate";
import type { CampusMeta } from "@/campus3d/meta";
import type { CampusSceneHandle } from "@/campus3d/scene";

export type StageCtx = {
  meta: { value: CampusMeta | null };
  sceneStatus: { value: "static" | "loading" | "intro" | "ready" | "error" };
  gate: { value: GateResult };
  registerFrame(cb: () => void): () => void;
  getHandle(): CampusSceneHandle | null;
};
