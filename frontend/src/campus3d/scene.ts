// NIGHT.md N1–N5：three.js 场景。整个 src 里只有这个文件可以 import three。
// 运行时通过 CampusHero 的动态 import() 加载（不进主包，scripts/check-bundle.mjs 把关）。
//
// 夜景资产把外观、光照、动效都烘焙在模型和贴图里：
// - 不加灯、不开阴影、不写着色器、不改材质颜色（NIGHT 规则 4）。
// - 高亮 = 把 H_<楼号> 组的缩放从 0 改成 1（N1），N5 让 scale.y 从 0.02 涌到 1。
// - 动效 = 横向滚动 FX 贴图（N3），循环条件：可见 + 前台 + 未开减少动态。
// - 开场 = 播放模型自带 intro 片段 + 镜头从 cameraFrom 落到 overview（N4）。
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { CampusMeta, Stop, StopId, Vec3 } from "./meta";
import { easeInOutCubic, easeOutCubic, lerpStop } from "./camera";

export interface CampusSceneHandle {
  goTo(stop: string | Stop, opts?: { immediate?: boolean; durationMs?: number; name?: string }): void;
  setHighlight(board: string | null): void;
  /** 对话定位：按 buildingId 直接聚焦一栋楼（镜头停靠 + 高亮件）。 */
  focusBuilding(buildingId: string | null): void;
  /** W3：片区显隐——把 Z_<片区号> 组缩放 0↔1；传 null 只把上一个收回去。 */
  setZone(zoneId: string | null): void;
  /** W5：楼的外壳显隐（H_<楼号> 组，沿用 N5 的涌起过渡）；不在表里时什么都不显示。 */
  setShell(buildingId: string | null): void;
  /** W5：通用图钉（P_pin）：先设 position=(anchor.x, 0, anchor.z) 再显隐，防飘在半空。 */
  setPin(buildingId: string | null): void;
  /** W2：镜头的方位角（0–360，正北为 0）。镜头移动途中也实时。 */
  getAzimuth(): number;
  /** W8：允许鼠标拖动旋转、滚轮缩放（OrbitControls，参数来自 meta.look.orbit）。 */
  setOrbit(enabled: boolean): void;
  /** W8：观景——绕当前目标点的竖直轴匀速转；关时 900ms 回到开启前的机位。 */
  setTour(on: boolean): void;
  onHover(cb: (board: string | null) => void): void;
  onPick(cb: (board: string) => void): void;
  onFrame(cb: () => void): void;
  /** 外壳把状态切到 intro 后调用：从此刻开始计时播开场（画布已开始淡入）。 */
  startIntro(): void;
  project(point: Vec3): { x: number; y: number; visible: boolean };
  dispose(): void;
}

export type SceneOpts = {
  glbUrl: string;
  reducedMotion: boolean;
  playIntro: boolean;
  onProgress: (p: number) => void;
  /** 开场动画播完且镜头到位后回调（只调一次）。 */
  onIntroDone?: () => void;
  /** W1：开场结束与不播开场时初始所在的停靠点（默认 "overview"）；舞台传 "home" */
  homeStop?: string;
};

const LOAD_TIMEOUT_MS = 15_000;
const MOVE_MS = 900;

interface MoveState {
  fromPos: THREE.Vector3;
  fromTarget: THREE.Vector3;
  to: Stop;
  stopId: string;
  start: number;
  durationMs: number;
}

interface RiseState {
  obj: THREE.Object3D;
  start: number;
  from: number;
  to: number;
  durationMs: number;
}

interface Runtime {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  root: THREE.Object3D | null;
  buildings: Map<string, THREE.Mesh>;
  hotNodes: Map<string, THREE.Object3D>;
  /** W1：Z_<片区号> 组（父节点是模型根）；v2 元数据没有时为空表 */
  zoneNodes: Map<string, THREE.Object3D>;
  /** W3：当前显示的 Z_ 组的片区号（null = 全收） */
  activeZoneId: string | null;
  /** W5：图钉当前所在的楼（null = 隐藏） */
  activePinId: string | null;
  /** W1：通用图钉 P_pin（v2 没有时为 null，不收集） */
  pinNode: THREE.Object3D | null;
  frameCbs: Set<() => void>;
  resizeObs: ResizeObserver;
  frames: number;
  disposed: boolean;
  loaded: boolean;
  onHoverCb: (board: string | null) => void;
  onPickCb: (board: string) => void;
  currentStop: string;
  currentTarget: THREE.Vector3;
  move: MoveState | null;
  rafId: number | null;
  lastTs: number | null;
  // ---- 高亮（N1/N5）----
  activeHotId: string | null;
  rise: RiseState | null;
  // ---- 动效（N3）----
  fxMap: THREE.Texture | null;
  loopT: number;
  loopRunning: boolean;
  lastLoopRender: number;
  frameMs: number;
  intersection: IntersectionObserver | null;
  visibleRatio: number;
  docVisible: boolean;
  onVisibility: () => void;
  // ---- 开场（N4）----
  mixer: THREE.AnimationMixer | null;
  introAction: THREE.AnimationAction | null;
  introPlaying: boolean;
  clipFinished: boolean;
  cameraArrived: boolean;
  introDone: boolean;
  introStart: number;
  introDuration: number;
  introStarted: boolean;
  // ---- 交互 ----
  hotspotMeshes: THREE.Mesh[];
  hoverBoard: string | null;
  pointerBound: boolean;
  downPos: { x: number; y: number } | null;
  pointerPending: { x: number; y: number } | null;
  pointerFrame: number;
  // ---- W8：拖动旋转与观景 ----
  /** OrbitControls，懒创建一次；v2 元数据没有 look.orbit 时一直是 null */
  controls: OrbitControls | null;
  /** 就绪后是否允许交互（镜头飞行、开场、观景期间禁用） */
  orbitWanted: boolean;
  tourActive: boolean;
  /** 开观景时的机位快照（关时回到这里） */
  tourSaved: { pos: THREE.Vector3; target: THREE.Vector3; stop: string } | null;
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

    const frame = canvas.parentElement;
    if (!frame) {
      reject(new Error("画布缺少外框容器"));
      return;
    }
    const w0 = Math.max(frame.clientWidth, 1);
    const h0 = Math.max(frame.clientHeight, 1);
    const camera = new THREE.PerspectiveCamera(meta.camera.fov, w0 / h0, meta.camera.near, meta.camera.far);
    // W1：初始停靠点用 homeStop（默认 overview）；舞台的元数据带 home
    const homeStopId = opts.homeStop ?? "overview";
    const ov = meta.stops[homeStopId as StopId] ?? meta.stops.overview;
    camera.position.set(ov.position[0], ov.position[1], ov.position[2]);
    const currentTarget = new THREE.Vector3(ov.target[0], ov.target[1], ov.target[2]);
    camera.lookAt(currentTarget);
    renderer.setSize(w0, h0, false);

    const rt: Runtime = {
      renderer,
      scene,
      camera,
      root: null,
      buildings: new Map(),
      hotNodes: new Map(),
      zoneNodes: new Map(),
      activeZoneId: null,
      activePinId: null,
      pinNode: null,
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
      loaded: false,
      onHoverCb: () => {},
      onPickCb: () => {},
      currentStop: homeStopId,
      currentTarget,
      move: null,
      rafId: null,
      lastTs: null,
      activeHotId: null,
      rise: null,
      fxMap: null,
      loopT: 0,
      loopRunning: false,
      lastLoopRender: 0,
      frameMs: 1000 / meta.look.fx.maxFps,
      intersection: null,
      visibleRatio: 1,
      docVisible: document.visibilityState === "visible",
      onVisibility: () => {},
      mixer: null,
      introAction: null,
      introPlaying: false,
      clipFinished: false,
      cameraArrived: false,
      introDone: false,
      introStart: 0,
      introDuration: meta.look.intro.seconds,
      introStarted: false,
      hotspotMeshes: [],
      hoverBoard: null,
      pointerBound: false,
      downPos: null,
      pointerPending: null,
      pointerFrame: -1,
      // W8
      controls: null,
      orbitWanted: false,
      tourActive: false,
      tourSaved: null,
    };
    rt.resizeObs.observe(frame);

    function hotOf(buildingId: string | null): THREE.Object3D | null {
      return buildingId ? rt.hotNodes.get(buildingId) ?? null : null;
    }

    function hookInfo() {
      // 调试钩子字段（PLAN 4.3 + NIGHT 各卡 + STAGE W1）；window.__campus3d 由外壳先建好。
      // 舞台（StageCanvas）写的 v3 字段不在 CampusHero 的严格类型里，这里按宽松记录取用。
      const hook = window.__campus3d as unknown as Record<string, unknown> | undefined;
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
      hook.highlightMaterials = 0;
      hook.assetVersion = meta.version;
      hook.hotNodes = rt.hotNodes.size;
      hook.hotVisible = rt.activeHotId;
      hook.hotRise = rt.activeHotId ? hotOf(rt.activeHotId)?.scale.y ?? 0 : 0;
      hook.looping = rt.loopRunning;
      hook.fxOffset = rt.fxMap ? rt.fxMap.offset.x : 0;
      hook.nodeScaleY = (name: string) => rt.root?.getObjectByName(name)?.scale.y ?? null;
      // W1：v3 舞台字段（v2 时 pack 为空串、zoneNodes 为 0）
      hook.pack = meta.pack?.id ?? "";
      hook.shellNodes = rt.hotNodes.size;
      hook.zoneNodes = rt.zoneNodes.size;
      // W3：当前显示的片区组（或 null）
      hook.zone = rt.activeZoneId;
      // W5：外壳与图钉（楼号或 null）
      hook.shell = rt.activeHotId;
      hook.pin = rt.activePinId;
      // W2：方位角（镜头移动途中也是实时值）
      hook.azimuth = getAzimuth();
      // W8：是否在观景
      hook.tour = rt.tourActive;
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

    // 同一微任务内的多次状态变化只渲一帧
    let renderQueued = false;
    function scheduleRender() {
      if (renderQueued || rt.disposed) return;
      renderQueued = true;
      queueMicrotask(() => {
        renderQueued = false;
        renderNow();
      });
    }

    function requestFrame() {
      if (rt.disposed || rt.rafId !== null) return;
      rt.rafId = requestAnimationFrame(tick);
    }

    function needMore(): boolean {
      return rt.loopRunning || rt.move !== null || rt.rise !== null || rt.introPlaying || rt.tourActive;
    }

    /** W8：镜头在飞/播开场/观景期间不允许交互；到位后恢复 */
    function syncControls() {
      if (!rt.controls) return;
      rt.controls.enabled = rt.orbitWanted && rt.move === null && !rt.introPlaying && !rt.tourActive;
    }

    function updateMove(now: number) {
      const m = rt.move;
      if (!m) return;
      const raw = Math.min((now - m.start) / m.durationMs, 1);
      const e = easeInOutCubic(raw);
      const s = lerpStop(
        {
          position: [m.fromPos.x, m.fromPos.y, m.fromPos.z],
          target: [m.fromTarget.x, m.fromTarget.y, m.fromTarget.z],
        },
        m.to,
        e
      );
      camera.position.set(s.position[0], s.position[1], s.position[2]);
      rt.currentTarget.set(s.target[0], s.target[1], s.target[2]);
      camera.lookAt(rt.currentTarget);
      if (raw >= 1) {
        rt.move = null;
        // W8：到位后把 controls 的目标点同步过来（不调 update，不加夹持）
        if (rt.controls) rt.controls.target.copy(rt.currentTarget);
        syncControls();
        if (rt.introPlaying) {
          rt.cameraArrived = true;
          maybeFinishIntro();
        }
      }
    }

    function updateRise(now: number) {
      const r = rt.rise;
      if (!r) return;
      const raw = Math.min((now - r.start) / r.durationMs, 1);
      r.obj.scale.y = r.from + (r.to - r.from) * easeOutCubic(raw);
      if (raw >= 1) {
        r.obj.scale.y = r.to;
        rt.rise = null;
      }
    }

    function tick(now: number) {
      rt.rafId = null;
      if (rt.disposed) return;
      const dt = rt.lastTs === null ? 0 : Math.min((now - rt.lastTs) / 1000, 0.1);
      rt.lastTs = now;

      let dirty = false;
      if (rt.introPlaying) {
        // 按墙上时间播动画（软件渲染一帧可能要几百毫秒，用帧间 dt 会把 2.7 秒拖成十几秒）
        const t = rt.introStarted
          ? Math.min((now - rt.introStart) / 1000, rt.introDuration)
          : 0;
        if (rt.introAction) rt.introAction.time = t;
        rt.mixer?.update(0);
        if (rt.introStarted && t >= rt.introDuration) {
          rt.clipFinished = true;
          maybeFinishIntro();
        }
        dirty = true;
      }
      if (rt.move) {
        updateMove(now);
        dirty = true;
      }
      if (rt.rise) {
        updateRise(now);
        dirty = true;
      }
      // W8：观景——每帧绕目标点的竖直轴转 degPerSec × dt 度（dt 已封顶 0.1 秒）
      if (rt.tourActive && rt.move === null) {
        rotateTour(dt);
        dirty = true;
      }
      if (rt.loopRunning) {
        rt.loopT += dt;
        if (now - rt.lastLoopRender >= rt.frameMs) {
          if (rt.fxMap) rt.fxMap.offset.x = (rt.loopT * meta.look.fx.speed) % 1;
          rt.lastLoopRender = now;
          renderNow();
        }
      } else if (dirty) {
        renderNow();
      }

      if (needMore()) requestFrame();
      else rt.lastTs = null;
    }

    // ---- 动效循环（N3）：可见 + 前台 + 未开减少动态 ----
    function updateLoopState() {
      const should =
        rt.loaded && !opts.reducedMotion && rt.docVisible && rt.visibleRatio > 0.05;
      if (should && !rt.loopRunning) {
        rt.loopRunning = true;
        rt.lastLoopRender = 0;
        rt.lastTs = null;
        requestFrame();
      } else if (!should && rt.loopRunning) {
        rt.loopRunning = false;
      }
      if (!should && rt.introPlaying && !rt.docVisible) skipIntro();
      hookInfo();
    }

    function onVisibility() {
      rt.docVisible = document.visibilityState === "visible";
      updateLoopState();
    }

    // ---- 高亮（N1/N5）----
    function hideActiveHot() {
      const old = hotOf(rt.activeHotId);
      if (old) old.scale.set(0, 0, 0);
      rt.activeHotId = null;
      rt.rise = null;
    }

    function showHot(buildingId: string | null) {
      if (rt.activeHotId === buildingId) return;
      hideActiveHot();
      if (!buildingId) {
        hookInfo();
        scheduleRender();
        return;
      }
      const obj = hotOf(buildingId);
      if (!obj) {
        hookInfo();
        scheduleRender();
        return;
      }
      rt.activeHotId = buildingId;
      if (opts.reducedMotion) {
        obj.scale.set(1, 1, 1);
      } else {
        // N5：x/z 始终是 1，只让 scale.y 从 0.02 涌到 1（红色从楼底升起）
        obj.scale.set(1, 0.02, 1);
        rt.rise = {
          obj,
          start: performance.now(),
          from: 0.02,
          to: 1,
          durationMs: meta.look.highlight.riseMs,
        };
        requestFrame();
      }
      hookInfo();
      scheduleRender();
    }

    function setHighlight(board: string | null) {
      const buildingId = board
        ? meta.hotspots.find((h) => h.board === board)?.buildingId ?? null
        : null;
      showHot(buildingId);
    }

    /** 对话定位：按 buildingId 直接聚焦（镜头停靠 + 高亮件，非热点楼只移动镜头）。 */
    function focusBuilding(buildingId: string | null) {
      if (rt.disposed) return;
      if (!buildingId) {
        showHot(null);
        return;
      }
      const b = meta.buildings[buildingId];
      const anchor = b?.anchor;
      if (anchor) {
        const center = meta.stops.overview.target;
        let dx = anchor[0] - center[0];
        let dz = anchor[2] - center[2];
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;
        const dist = 430;
        const height = 250;
        const stop: Stop = {
          position: [anchor[0] + dx * dist, height, anchor[2] + dz * dist],
          target: [anchor[0], Math.max(anchor[1], 8), anchor[2]],
        };
        goTo(stop);
      }
      showHot(buildingId);
    }

    function goTo(
      stopIdOrStop: string | Stop,
      o?: { immediate?: boolean; durationMs?: number; name?: string }
    ) {
      const isId = typeof stopIdOrStop === "string";
      const stop = isId ? meta.stops[stopIdOrStop as StopId] : stopIdOrStop;
      if (!stop || rt.disposed) return;
      rt.currentStop = isId
        ? String(stopIdOrStop)
        : (o?.name ?? "focus");
      if (o?.immediate || opts.reducedMotion) {
        rt.move = null;
        camera.position.set(stop.position[0], stop.position[1], stop.position[2]);
        rt.currentTarget.set(stop.target[0], stop.target[1], stop.target[2]);
        camera.lookAt(rt.currentTarget);
        // W8：立即到位也把 controls 的目标点同步过来
        if (rt.controls) rt.controls.target.copy(rt.currentTarget);
        syncControls();
        if (rt.introPlaying) {
          rt.cameraArrived = true;
          maybeFinishIntro();
        }
        hookInfo();
        scheduleRender();
        return;
      }
      // 从当前实际位置出发（移动中途再次调用也不跳变）
      rt.move = {
        fromPos: camera.position.clone(),
        fromTarget: rt.currentTarget.clone(),
        to: stop,
        stopId: rt.currentStop,
        start: performance.now(),
        durationMs: o?.durationMs ?? MOVE_MS,
      };
      syncControls(); // W8：飞行期间禁止交互
      renderNow();
      requestFrame();
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

    // ---- W2：方位角（镜头指向；移动途中也实时）----
    function getAzimuth(): number {
      const dx = rt.currentTarget.x - camera.position.x;
      const dz = rt.currentTarget.z - camera.position.z;
      const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
      const norm = ((deg % 360) + 360) % 360;
      return norm === 360 ? 0 : norm;
    }

    // ---- W3：片区显隐（Z_ 组缩放 0↔1；传 null 只把上一个收回去）----
    function setZone(zoneId: string | null) {
      if (rt.disposed) return;
      const prev = rt.activeZoneId;
      if (prev !== null && prev !== zoneId) {
        const prevNode = rt.zoneNodes.get(prev);
        if (prevNode) prevNode.scale.set(0, 0, 0);
      }
      rt.activeZoneId = null;
      if (zoneId !== null) {
        const node = rt.zoneNodes.get(zoneId);
        if (node) {
          node.scale.set(1, 1, 1);
          rt.activeZoneId = zoneId;
        }
      }
      hookInfo();
      scheduleRender();
    }

    // ---- W5：楼的通用图钉（P_pin；先设地面位置再显隐，STAGE 12.3/12.4）----
    function setPin(buildingId: string | null) {
      if (rt.disposed) return;
      const pin = rt.pinNode;
      if (!pin) return;
      if (buildingId === null) {
        pin.scale.set(0, 0, 0);
        rt.activePinId = null;
      } else {
        const anchor = meta.buildings[buildingId]?.anchor;
        if (!anchor) {
          pin.scale.set(0, 0, 0);
          rt.activePinId = null;
        } else {
          pin.position.set(anchor[0], 0, anchor[2]);
          pin.scale.set(1, 1, 1);
          rt.activePinId = buildingId;
        }
      }
      hookInfo();
      scheduleRender();
    }

    // ---- W8：拖动旋转（OrbitControls，只用 three 自带，参数全部来自 meta.look.orbit）----
    function onControlsStart() {
      // 用户开始交互（拖动或滚轮）：停靠点位置不再有意义
      rt.currentStop = "free";
    }

    function onControlsChange() {
      // 拖动、滚轮时请求渲染一帧，并回调 onFrame（题签、罗盘、星跟着动）
      hookInfo();
      scheduleRender();
    }

    function setOrbit(enabled: boolean) {
      if (rt.disposed) return;
      rt.orbitWanted = enabled;
      if (enabled && !rt.controls && meta.look.orbit) {
        const o = meta.look.orbit;
        const savedPos = camera.position.clone();
        const controls = new OrbitControls(camera, canvas);
        controls.enablePan = false;
        controls.enableDamping = false;
        controls.minPolarAngle = (o.minPolarDeg * Math.PI) / 180;
        controls.maxPolarAngle = (o.maxPolarDeg * Math.PI) / 180;
        controls.minDistance = o.minDistance;
        controls.maxDistance = o.maxDistance;
        controls.target.copy(rt.currentTarget);
        // 构造函数内部会用默认 target=(0,0,0) 调一次 update()（末尾 lookAt 世界原点），
        // 把镜头朝向弄歪。这里把镜头摆回当前机位（位置本来没动，只需朝向）。
        camera.position.copy(savedPos);
        camera.lookAt(rt.currentTarget);
        controls.addEventListener("start", onControlsStart);
        controls.addEventListener("change", onControlsChange);
        rt.controls = controls;
      }
      syncControls();
    }

    // ---- W8：观景（绕目标点竖直轴匀速转，方位角随时间增大）----
    function rotateTour(dtSec: number) {
      const cfg = meta.look.tour;
      if (!cfg) return;
      const rad = (cfg.degPerSec * dtSec * Math.PI) / 180;
      const target = rt.currentTarget;
      const r = Math.hypot(camera.position.x - target.x, camera.position.z - target.z);
      if (r < 1e-6) return;
      // 偏移角 φ = atan2(−ox, oz)（与 getAzimuth 同构）；φ 增大 = 方位角增大
      const phi = Math.atan2(-(camera.position.x - target.x), camera.position.z - target.z) + rad;
      camera.position.x = target.x - r * Math.sin(phi);
      camera.position.z = target.z + r * Math.cos(phi);
      camera.lookAt(target);
    }

    function setTour(on: boolean) {
      if (rt.disposed) return;
      if (on) {
        if (rt.tourActive) return;
        rt.move = null;
        if (rt.controls) rt.controls.enabled = false;
        rt.tourActive = true;
        rt.tourSaved = {
          pos: camera.position.clone(),
          target: rt.currentTarget.clone(),
          stop: rt.currentStop,
        };
        requestFrame();
      } else {
        if (!rt.tourActive) return;
        rt.tourActive = false;
        const saved = rt.tourSaved;
        rt.tourSaved = null;
        if (saved) {
          // 900ms（reducedMotion 立即）回到开观景前的机位；goTo 从当前位置出发，不跳变
          goTo(
            {
              position: [saved.pos.x, saved.pos.y, saved.pos.z],
              target: [saved.target.x, saved.target.y, saved.target.z],
            },
            { name: saved.stop }
          );
        }
      }
      hookInfo();
    }

    // ---- 开场（N4）----
    function startIntro() {
      if (!rt.introPlaying || rt.introStarted) return;
      rt.introStarted = true;
      rt.introStart = performance.now();
      if (rt.introAction) rt.introAction.time = 0;
      rt.mixer?.update(0);
      requestFrame();
    }

    function maybeFinishIntro() {
      if (rt.introPlaying && rt.clipFinished && rt.cameraArrived) finishIntro();
    }

    function finishIntro() {
      if (!rt.introPlaying) return;
      rt.introPlaying = false;
      rt.introDone = true;
      rt.mixer?.removeEventListener("finished", onMixerFinished);
      opts.onIntroDone?.();
      hookInfo();
      scheduleRender();
      if (needMore()) requestFrame();
    }

    function onMixerFinished() {
      rt.clipFinished = true;
      maybeFinishIntro();
    }

    function skipIntro() {
      if (!rt.introPlaying) return;
      const clip = rt.introAction?.getClip();
      if (rt.introAction && clip) {
        rt.introAction.time = clip.duration;
        rt.mixer?.update(0);
      }
      rt.clipFinished = true;
      rt.cameraArrived = true;
      goTo(homeStopId, { immediate: true });
      finishIntro();
    }

    // ---- 拾取（只对 5 栋热点楼）----
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();

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
      rt.rise = null;
      rt.introPlaying = false;
      rt.mixer?.stopAllAction();
      rt.mixer?.removeEventListener("finished", onMixerFinished);
      rt.mixer = null;
      rt.introAction = null;
      rt.intersection?.disconnect();
      if (rt.onVisibility) document.removeEventListener("visibilitychange", rt.onVisibility);
      unbindPointer();
      // W8：OrbitControls 与观景状态一并释放
      rt.controls?.dispose();
      rt.controls = null;
      rt.tourActive = false;
      rt.tourSaved = null;
      rt.resizeObs.disconnect();
      rt.frameCbs.clear();
      rt.scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const m of mats) {
          if (!m) continue;
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
        rt.root = gltf.scene;
        scene.add(gltf.scene);

        // B_ 节点 → 楼号 Mesh（拾取与计数）
        gltf.scene.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && typeof mesh.name === "string" && mesh.name.startsWith("B_")) {
            rt.buildings.set(mesh.name.slice(2), mesh);
          }
        });

        // H_ 高亮件：只收「父节点是模型根节点」的组，楼号 = 名字去掉前缀（N1；W1 里 shellNodes 同源）
        const prefix = meta.look.highlight.nodePrefix;
        for (const child of gltf.scene.children) {
          if (child.name.startsWith(prefix)) {
            rt.hotNodes.set(child.name.slice(prefix.length), child);
          }
        }

        // W1：Z_ 片区组与 P_pin 图钉（同样只收父节点是模型根的；v2 没有这些字段时跳过）
        const zonePrefix = meta.look.zone?.nodePrefix;
        if (zonePrefix) {
          for (const child of gltf.scene.children) {
            if (child.name.startsWith(zonePrefix)) {
              rt.zoneNodes.set(child.name.slice(zonePrefix.length), child);
            }
          }
        }
        const pinName = meta.look.pin?.node;
        if (pinName) {
          rt.pinNode = gltf.scene.children.find((c) => c.name === pinName) ?? null;
        }

        // 动效贴图：FX_beacons 的 material.map，代码不需要知道哪个网格是什么（N3）
        const fxObj = gltf.scene.getObjectByName(meta.look.fx.node) as THREE.Mesh | undefined;
        if (fxObj?.isMesh) {
          const mat = fxObj.material as THREE.MeshBasicMaterial;
          rt.fxMap = mat.map ?? null;
        }

        // 热点楼列表 + 画布交互
        rt.hotspotMeshes = meta.hotspots
          .map((h) => rt.buildings.get(h.buildingId))
          .filter((m): m is THREE.Mesh => !!m);
        bindPointer();

        // 开场动画：第一帧之前把动画时间设到 0、相机放到 cameraFrom（N4）
        const clip = opts.playIntro
          ? THREE.AnimationClip.findByName(gltf.animations, meta.look.intro.clip)
          : null;
        if (clip) {
          rt.mixer = new THREE.AnimationMixer(gltf.scene);
          const action = rt.mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          action.reset();
          action.play();
          rt.mixer.update(0);
          rt.mixer.addEventListener("finished", onMixerFinished);
          rt.introAction = action;
          rt.introPlaying = true;
          rt.introStart = performance.now();
          rt.introDuration = Math.min(clip.duration || Infinity, meta.look.intro.seconds);
          const from = meta.look.intro.cameraFrom;
          camera.position.set(from.position[0], from.position[1], from.position[2]);
          rt.currentTarget.set(from.target[0], from.target[1], from.target[2]);
          camera.lookAt(rt.currentTarget);
          goTo(homeStopId, { durationMs: meta.look.intro.cameraMs });
        } else {
          rt.clipFinished = true;
          rt.cameraArrived = true;
          rt.introDone = true;
          // playIntro 为真但资产没有片段：立刻通知外壳进入 ready
          if (opts.playIntro) window.setTimeout(() => opts.onIntroDone?.(), 0);
        }

        rt.loaded = true;

        // 可见性：画框滚出视口就停渲染（N3）
        if (typeof IntersectionObserver !== "undefined") {
          rt.intersection = new IntersectionObserver(
            (entries) => {
              for (const e of entries) rt.visibleRatio = e.intersectionRatio;
              updateLoopState();
            },
            { threshold: [0, 0.05, 0.25, 0.5, 1] }
          );
          rt.intersection.observe(frame);
        }
        rt.onVisibility = onVisibility;
        document.addEventListener("visibilitychange", onVisibility);

        renderNow(); // 第一帧画完才 resolve
        resolve(makeHandle());
        updateLoopState();
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

    function makeHandle(): CampusSceneHandle {
      return {
        goTo,
        setHighlight,
        focusBuilding,
        setZone,
        setShell: showHot,
        setPin,
        getAzimuth,
        setOrbit,
        setTour,
        onHover(cb: (board: string | null) => void) {
          rt.onHoverCb = cb;
        },
        onPick(cb: (board: string) => void) {
          rt.onPickCb = cb;
        },
        onFrame(cb: () => void) {
          rt.frameCbs.add(cb);
        },
        startIntro,
        project,
        dispose: disposeAll,
      };
    }

    // W2：测试入口（只给 e2e 用，做完也留着）
    const hookObj = (window as unknown as { __campus3d?: Record<string, unknown> }).__campus3d;
    if (hookObj) {
      hookObj.debugGoTo = (stop: string) => goTo(stop);
    }
  });
}