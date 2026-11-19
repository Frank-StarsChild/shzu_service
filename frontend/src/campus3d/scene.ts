// PLAN S5+S6：three.js 场景。整个 src 里只有这个文件可以 import three。
// 运行时通过 CampusHero 的动态 import() 加载（不进主包，scripts/check-bundle.mjs 把关）。
//
// 约束（PLAN 3.1 / S6）：
// - 资产是烘焙好的 unlit 模型（KHR_materials_unlit → MeshBasicMaterial）：
//   不加任何灯、不开阴影、不改材质参数（高亮克隆在 S7）。
// - 相机：fov/near/far 取 meta；fov 是竖直视场角；goTo 在停靠点间 900ms 缓动，
//   从当前实际位置出发，中断不跳变；reducedMotion/immediate 直接到位。
// - 按需渲染：只有镜头移动时才请求下一帧，静止一帧都不画（S6 第 3 条）。
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { CampusMeta, Stop, StopId, Vec3 } from "./meta";
import { easeInOutCubic, lerpStop } from "./camera";

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
const MOVE_MS = 900;

interface MoveState {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  to: Stop;
  stopId: string;
  start: number;
}

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
  currentStop: string;
  currentTarget: THREE.Vector3;
  move: MoveState | null;
  rafId: number | null;
  // ---- S7 ----
  hotspotMeshes: THREE.Mesh[];
  hoverBoard: string | null;
  highlightMesh: THREE.Mesh | null;
  highlightOrigMat: THREE.Material | THREE.Material[] | null;
  highlightClone: THREE.Material | null;
  pointerBound: boolean;
  downPos: { x: number; y: number } | null;
  pointerPending: { x: number; y: number } | null;
  pointerFrame: number;
}

export function createCampusScene(
  canvas: HTMLCanvasElement,
  meta: CampusMeta,
  opts: SceneOpts
): Promise<CampusSceneHandle> {
  return new Promise<CampusSceneHandle>((resolve, reject) => {
    // ---- 渲染器 / 场景 / 相机（参数照 PLAN S5，其余都不开） ----
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
    const currentTarget = new THREE.Vector3(ov.target[0], ov.target[1], ov.target[2]);
    camera.lookAt(currentTarget);
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
        renderNow(); // 尺寸变化才画（按需渲染）
      }),
      frames: 0,
      disposed: false,
      onHoverCb: () => {},
      onPickCb: () => {},
      currentStop: "overview",
      currentTarget,
      move: null,
      rafId: null,
      hotspotMeshes: [],
      hoverBoard: null,
      highlightMesh: null,
      highlightOrigMat: null,
      highlightClone: null,
      pointerBound: false,
      downPos: null,
      pointerPending: null,
      pointerFrame: -1,
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
      hook.stop = rt.currentStop;
      hook.moving = rt.move !== null;
      hook.hoveredBoard = rt.hoverBoard;
      hook.highlightMaterials = rt.highlightClone !== null ? 1 : 0;
      hook.camera = {
        position: [camera.position.x, camera.position.y, camera.position.z],
        target: [rt.currentTarget.x, rt.currentTarget.y, rt.currentTarget.z],
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

    // 同一微任务内的多次状态变化（如 goTo+setHighlight）只渲一帧（S7：软件渲染下
    // 一次全场景渲染 ~100ms，重复渲染会让即时路径超过 200ms 预算）
    let renderQueued = false;
    function scheduleRender() {
      if (renderQueued || rt.disposed) return;
      renderQueued = true;
      queueMicrotask(() => {
        renderQueued = false;
        renderNow();
      });
    }

    // ---- 按需渲染的动画循环：只在移动期间跑；到位即停 ----
    function animate(now: number) {
      if (rt.disposed) {
        rt.rafId = null;
        return;
      }
      if (rt.move) {
        const raw = Math.min((now - rt.move.start) / MOVE_MS, 1);
        const e = easeInOutCubic(raw);
        const s = lerpStop(
          {
            position: [rt.move.fromPos.x, rt.move.fromPos.y, rt.move.fromPos.z],
            target: [rt.move.fromTarget.x, rt.move.fromTarget.y, rt.move.fromTarget.z],
          },
          rt.move.to,
          e
        );
        camera.position.set(s.position[0], s.position[1], s.position[2]);
        rt.currentTarget.set(s.target[0], s.target[1], s.target[2]);
        camera.lookAt(rt.currentTarget);
        renderNow();
        if (raw >= 1) {
          rt.move = null;
          rt.rafId = null; // 静止后一帧都不画
          renderNow(); // 最后一帧按精确终点再画一次
        } else {
          rt.rafId = requestAnimationFrame(animate);
        }
      } else {
        rt.rafId = null;
      }
    }

    function goTo(stopId: string, o?: { immediate?: boolean }) {
      const stop = meta.stops[stopId as StopId];
      if (!stop || rt.disposed) return;
      const wasMoving = rt.move !== null;
      rt.currentStop = stopId;
      if (o?.immediate || opts.reducedMotion) {
        rt.move = null;
        camera.position.set(stop.position[0], stop.position[1], stop.position[2]);
        rt.currentTarget.set(stop.target[0], stop.target[1], stop.target[2]);
        camera.lookAt(rt.currentTarget);
        scheduleRender();
        return;
      }
      // 从当前实际位置出发（移动中途再次调用也不跳变）
      rt.move = {
        fromPos: camera.position.clone(),
        fromTarget: rt.currentTarget.clone(),
        to: stop,
        stopId,
        start: performance.now(),
      };
      renderNow();
      if (rt.rafId === null || !wasMoving) {
        if (rt.rafId !== null) cancelAnimationFrame(rt.rafId);
        rt.rafId = requestAnimationFrame(animate);
      }
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

    // ---- S7 联动：高亮、拾取、点击 ----
    const HIGHLIGHT_COLOR = new THREE.Color("#e2001a");
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

    /** 板块 → 楼 Mesh（楼名/说明来自 meta，不写死）。视觉高亮态，多来源驱动。 */
    function setHighlight(board: string | null) {
      const buildingId = board
        ? meta.hotspots.find((h) => h.board === board)?.buildingId ?? null
        : null;
      const mesh = buildingId ? rt.buildings.get(buildingId) ?? null : null;
      if (mesh === rt.highlightMesh) return; // 幂等：早退（含两者都为空）

      // 还原上一栋：换回原材质并释放克隆（highlightMaterials 永远 ≤ 1）
      if (rt.highlightMesh && rt.highlightOrigMat) {
        rt.highlightMesh.material = rt.highlightOrigMat;
      }
      if (rt.highlightClone) {
        rt.highlightClone.dispose();
        rt.highlightClone = null;
      }
      rt.highlightMesh = null;
      rt.highlightOrigMat = null;

      if (mesh) {
        const orig = mesh.material;
        // 高亮必须克隆材质，不能改共用的那个（模型里 B_ 共用同一材质）
        const clone = (orig as THREE.MeshBasicMaterial).clone();
        clone.color = HIGHLIGHT_COLOR;
        mesh.material = clone;
        rt.highlightMesh = mesh;
        rt.highlightOrigMat = orig;
        rt.highlightClone = clone;
      }
      hookInfo();
      scheduleRender(); // 高亮刚变化 → 画一帧（与同 tick 的其它变化合并）
    }

    /** 只对 5 栋热点楼做射线检测；返回板块或 null。 */
    function pickBoard(clientX: number, clientY: number): string | null {
      const rect = canvas.getBoundingClientRect();
      ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2) + 1);
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObjects(rt.hotspotMeshes, false);
      if (hits.length === 0) return null;
      const id = rt.hotspotMeshes.indexOf(hits[0].object as THREE.Mesh);
      return id >= 0 ? meta.hotspots[id].board : null;
    }

    function onPointerMove(e: PointerEvent) {
      if (rt.disposed) return;
      // 每帧最多处理一次（PLAN S7 第 2 条）
      if (rt.frames !== rt.pointerFrame) {
        rt.pointerFrame = rt.frames;
        const board = pickBoard(e.clientX, e.clientY);
        if (board !== rt.hoverBoard) {
          // hoveredBoard 仅由画布驱动（4.3）；高亮经 onHover → 上层 activeBoard 联动
          rt.hoverBoard = board;
          canvas.style.cursor = board ? "pointer" : "";
          hookInfo();
          rt.onHoverCb(board);
        }
        rt.pointerPending = null;
      } else {
        rt.pointerPending = { x: e.clientX, y: e.clientY };
      }
    }

    function onPointerLeave() {
      if (rt.disposed) return;
      if (rt.hoverBoard !== null) {
        rt.hoverBoard = null;
        canvas.style.cursor = "";
        hookInfo();
        rt.onHoverCb(null);
      }
      rt.pointerPending = null;
    }

    function onPointerDown(e: PointerEvent) {
      rt.downPos = { x: e.clientX, y: e.clientY };
    }

    function onPointerUp(e: PointerEvent) {
      const down = rt.downPos;
      rt.downPos = null;
      if (!down) return;
      // 按下和抬起位置相差 < 5px 才算点击（拖动不算）
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 5) return;
      const board = pickBoard(e.clientX, e.clientY);
      if (board) rt.onPickCb(board);
    }

    function bindPointer() {
      if (rt.pointerBound) return;
      rt.pointerBound = true;
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
      canvas.addEventListener("pointerdown", onPointerDown);
      canvas.addEventListener("pointerup", onPointerUp);
    }

    function unbindPointer() {
      if (!rt.pointerBound) return;
      rt.pointerBound = false;
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
    }

    function disposeAll() {
      if (rt.disposed) return;
      rt.disposed = true;
      if (rt.rafId !== null) {
        cancelAnimationFrame(rt.rafId);
        rt.rafId = null;
      }
      rt.move = null;
      unbindPointer();
      // 还原高亮状态（换回原材质、释放克隆），避免资源泄漏计入
      if (rt.highlightMesh && rt.highlightOrigMat) {
        rt.highlightMesh.material = rt.highlightOrigMat;
      }
      if (rt.highlightClone) {
        rt.highlightClone.dispose();
        rt.highlightClone = null;
      }
      rt.highlightMesh = null;
      rt.highlightOrigMat = null;
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
        // S7：热点楼列表 + 画布交互绑定
        rt.hotspotMeshes = meta.hotspots
          .map((h) => rt.buildings.get(h.buildingId))
          .filter((m): m is THREE.Mesh => !!m);
        bindPointer();

        const handle: CampusSceneHandle = {
          goTo,
          setHighlight,
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
