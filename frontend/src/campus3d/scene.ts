// PLAN S5：three.js 场景。整个 src 里只有这个文件可以 import three。
// 运行时通过 CampusHero 的动态 import() 加载（不进主包，scripts/check-bundle.mjs 把关）。
//
// 约束（PLAN 3.1）：
// - 资产是烘焙好的 unlit 模型（KHR_materials_unlit → MeshBasicMaterial）：
//   不加任何灯、不开阴影、不改材质参数（高亮克隆在 S7）。
// - 相机用 meta 的 fov/near/far 与 stops.overview；fov 是竖直视场角。
// - 第一帧画完 createCampusScene 的 Promise 才 resolve；加载 15 秒未完成按失败处理。
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CampusMeta, Vec3 } from "./meta";

export interface CampusSceneHandle {
  goTo(stop: string, opts?: { immediate?: boolean }): void;
  setHighlight(board: string | null): void;
  onHover(cb: (board: string | null) => void): void;
  onPick(cb: (board: string) => void): void;
  onFrame(cb: () => void): void;
  project(point: Vec3): { x: number; y: number; visible: boolean };
  dispose(): void;
}

export type SceneOpts = {
  glbUrl: string;
  reducedMotion: boolean;
  onProgress: (p: number) => void;
};

const LOAD_TIMEOUT_MS = 15_000;

interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  buildings: Map<string, THREE.Mesh>;
  frameCbs: Set<() => void>;
  resizeObs: ResizeObserver;
  frames: number;
  disposed: boolean;
  onHoverCb: (board: string | null) => void;
  onPickCb: (board: string) => void;
}

export function createCampusScene(
  canvas: HTMLCanvasElement,
  meta: CampusMeta,
  opts: SceneOpts
): Promise<CampusSceneHandle> {
  return new Promise<CampusSceneHandle>((resolve, reject) => {
    // ---- 渲染器 / 场景 / 相机（PLAN S5 第 2 条的参数，其余都不开） ----
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    const bgColor = new THREE.Color(meta.background);
    renderer.setClearColor(bgColor, 1);

    const scene = new THREE.Scene();
    scene.background = bgColor;
    // 场景里不加任何灯（烘焙材质）

    const frame = canvas.parentElement;
    if (!frame) {
      reject(new Error("画布缺少外框容器"));
      return;
    }
    const w0 = Math.max(frame.clientWidth, 1);
    const h0 = Math.max(frame.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(meta.camera.fov, w0 / h0, meta.camera.near, meta.camera.far);
    const ov = meta.stops.overview;
    camera.position.set(ov.position[0], ov.position[1], ov.position[2]);
    camera.lookAt(ov.target[0], ov.target[1], ov.target[2]);
    renderer.setSize(w0, h0, false);

    const rt: Runtime = {
      renderer,
      scene,
      camera,
      buildings: new Map(),
      frameCbs: new Set(),
      resizeObs: new ResizeObserver(() => {
        const w = Math.max(frame.clientWidth, 1);
        const h = Math.max(frame.clientHeight, 1);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderNow();
      }),
      frames: 0,
      disposed: false,
      onHoverCb: () => {},
      onPickCb: () => {},
    };
    rt.resizeObs.observe(frame);

    function hookInfo() {
      // 调试钩子字段（PLAN 4.3）；window.__campus3d 由 CampusHero 先建好
      // （类型声明见 src/components/CampusHero.vue 的 declare global）
      const hook = window.__campus3d;
      if (!hook) return;
      const info = renderer.info;
      hook.frames = rt.frames;
      hook.drawCalls = info.render.calls;
      hook.triangles = info.render.triangles;
      hook.geometries = info.memory.geometries;
      hook.textures = info.memory.textures;
      hook.buildingCount = rt.buildings.size;
      hook.stop = "overview";
      hook.moving = false;
      hook.camera = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [ov.target[0], ov.target[1], ov.target[2]],
        fov: camera.fov,
      };
      hook.projectPoint = project;
    }

    function renderNow() {
      if (rt.disposed) return;
      renderer.render(scene, camera);
      rt.frames += 1;
      hookInfo();
      for (const cb of rt.frameCbs) cb();
    }

    function project(point: Vec3): { x: number; y: number; visible: boolean } {
      const v = new THREE.Vector3(point[0], point[1], point[2]).project(camera);
      const rect = canvas.getBoundingClientRect();
      const inside = v.z > -1 && v.z < 1 && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1;
      return {
        x: rect.left + ((v.x + 1) / 2) * rect.width,
        y: rect.top + ((1 - v.y) / 2) * rect.height,
        visible: inside,
      };
    }

    function disposeAll() {
      if (rt.disposed) return;
      rt.disposed = true;
      rt.resizeObs.disconnect();
      rt.frameCbs.clear();
      rt.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
          // 释放材质上的贴图（烘焙贴图），再释放材质
          const slots = m as unknown as Record<string, THREE.Texture | null | undefined>;
          for (const slot of ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"]) {
            const t = slots[slot];
            if (t) t.dispose();
          }
          m.dispose();
        }
      });
      rt.scene.clear();
      rt.renderer.dispose();
      rt.renderer.forceContextLoss();
    }

    // ---- 加载模型（15 秒未完成按失败；失败时自行清理）----
    const timer = window.setTimeout(() => {
      disposeAll();
      reject(new Error("场景加载超时（15s）"));
    }, LOAD_TIMEOUT_MS);

    const loader = new GLTFLoader();
    loader.load(
      opts.glbUrl,
      (gltf) => {
        if (rt.disposed) return;
        window.clearTimeout(timer);
        scene.add(gltf.scene);
        // 把名字以 B_ 开头的 Mesh 收进「楼号 → Mesh」表
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && typeof mesh.name === "string" && mesh.name.startsWith("B_")) {
            rt.buildings.set(mesh.name.slice(2), mesh);
          }
        });
        renderNow(); // 第一帧画完才 resolve
        hookInfo();

        const handle: CampusSceneHandle = {
          goTo(_stop: string, _o?: { immediate?: boolean }) {
            // S6 实现：停靠点过渡
          },
          setHighlight(_board: string | null) {
            // S7 实现：克隆材质高亮
          },
          onHover(cb: (board: string | null) => void) {
            rt.onHoverCb = cb;
          },
          onPick(cb: (board: string) => void) {
            rt.onPickCb = cb;
          },
          onFrame(cb: () => void) {
            rt.frameCbs.add(cb);
          },
          project,
          dispose: disposeAll,
        };
        resolve(handle);
      },
      (evt) => {
        opts.onProgress(evt.total > 0 ? Math.min(evt.loaded / evt.total, 1) : 0);
      },
      (err) => {
        window.clearTimeout(timer);
        disposeAll();
        reject(err instanceof Error ? err : new Error("模型加载失败"));
      }
    );
  });
}
