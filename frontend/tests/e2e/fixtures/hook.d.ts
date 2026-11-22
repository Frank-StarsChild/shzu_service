// e2e 测试里访问 window.__campus3d 用的类型（与 src/components/CampusHero.vue 一致）。
// 本文件仅供 Playwright 用例的编辑器类型提示，不参与 vue-tsc 构建。
declare global {
  interface Window {
    __campus3d: {
      /** 普通版（/）里是闸门结果 static/scene；舞台（/stage）里是舞台状态（STAGE 6.4） */
      mode: "static" | "scene" | "home" | "campus" | "answer" | "tour";
      reason: string;
      status: "static" | "loading" | "ready" | "error";
      hotspotCount: number;
      buildingCount: number;
      activeBoard: string | null;
      hoveredBoard: string | null;
      // ---- 夜景 N 系列 ----
      assetVersion?: string;
      hotNodes?: number;
      hotVisible?: string | null;
      hotRise?: number;
      looping?: boolean;
      fxOffset?: number;
      nodeScaleY?: (name: string) => number | null;
      intro?: "none" | "playing" | "done" | "skipped";
      introReason?: string;
      // ---- 对话定位 ----
      focusedBuilding?: string | null;
      // ---- STAGE v3（W1 起）----
      pack?: string;
      shellNodes?: number;
      zoneNodes?: number;
      zone?: string | null;
      shell?: string | null;
      pin?: string | null;
      azimuth?: number;
      tour?: boolean;
      framing?: number;
      panBounds?: number[] | null;
      debugGoTo?: (stop: string) => void;
      debugShowAnswer?: (buildingId: string) => void;
      stop: string;
      moving: boolean;
      frames: number;
      drawCalls: number;
      triangles: number;
      geometries: number;
      textures: number;
      highlightMaterials: number;
      camera: { position: number[]; target: number[]; fov: number };
      projectPoint: (point: [number, number, number]) => { x: number; y: number; visible: boolean };
    };
  }
}

export {};
