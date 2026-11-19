// e2e 测试里访问 window.__campus3d 用的类型（与 src/components/CampusHero.vue 一致）。
// 本文件仅供 Playwright 用例的编辑器类型提示，不参与 vue-tsc 构建。
declare global {
  interface Window {
    __campus3d: {
      mode: "static" | "scene";
      reason: string;
      status: "static" | "loading" | "ready" | "error";
      hotspotCount: number;
      buildingCount: number;
      activeBoard: string | null;
      hoveredBoard: string | null;
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
