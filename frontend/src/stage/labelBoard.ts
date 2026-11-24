// 舞台标签的共用布局板：两个标签组件（校区/楼题签、学院灯牌）各自 publish 候选，
// 由 StageLabelDriver 每帧调用一次 solve()，把同一份布局结果回给两边。
// 遮挡矩形只在尺寸/面板状态/视口变化后与低频兜底时重读，避免每帧强制排版。
import { shallowRef, type InjectionKey, type ShallowRef } from "vue";
import { layoutLabels, type LabelSpec, type Layout, type Rect } from "./labels";

export const LABEL_BOARD_KEY: InjectionKey<LabelBoard> = Symbol("stage-label-board");

export type LabelBoard = {
  publish(source: string, specs: LabelSpec[]): void;
  solve(): void;
  invalidate(): void;
  layouts: ShallowRef<Record<string, Layout>>;
};

/** 这些是悬在画布上的固定控件，标签不许压上去（隐藏的不算） */
const OCCLUDERS = [
  ".stage-top",
  ".stage-rail",
  ".stage-rail-enter",
  ".stage-answer",
  ".stage-dock",
  ".stage-hero",
  ".stage-read",
  ".stage-compass-box",
  ".stage-scale",
  ".stage-tour-exit",
  ".stage-answer-expand",
];

function readRect(el: Element): Rect | null {
  const cs = getComputedStyle(el);
  if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.15) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return null;
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}

/** 题字区：只有真正露出一整块时才当作遮挡（淡出中的残影不占位，否则楼题签会闪一下） */
function heroOpaque(el: Element): boolean {
  return Number(getComputedStyle(el).opacity) >= 0.9;
}

/** 只读一次：把当前真正可见的固定控件换成遮挡矩形 */
export function readOccluders(): Rect[] {
  if (typeof document === "undefined") return [];
  // 题字只在首页态占位：校区/回答态它正在淡出，不该把楼题签挤走
  const mode = document.querySelector(".stage")?.getAttribute("data-mode") ?? "home";
  const out: Rect[] = [];
  for (const sel of OCCLUDERS) {
    for (const el of Array.from(document.querySelectorAll(sel))) {
      if (sel === ".stage-hero" && (mode !== "home" || !heroOpaque(el))) continue;
      const r = readRect(el);
      if (!r) continue;
      // 只保留与视口相交的部分，屏外控件不占位
      if (r.x > window.innerWidth || r.y > window.innerHeight) continue;
      if (r.x + r.w < 0 || r.y + r.h < 0) continue;
      out.push(r);
    }
  }
  return out;
}

export function createLabelBoard(): LabelBoard {
  const layouts = shallowRef<Record<string, Layout>>({});
  const sources = new Map<string, LabelSpec[]>();
  let reserved: Rect[] = [];
  let dirty = true;
  let resetPrev = false;
  let lastRead = 0;
  let lastSig = "";

  function solve() {
    // 遮挡矩形：尺寸/状态变化时立即重读，另外按时间（≥200ms）兜底重读。
    // 不用「每 N 帧」：软渲染下一帧可能几百毫秒，面板弹出后会长时间读不到新矩形。
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (dirty || now - lastRead > 200) {
      reserved = readOccluders();
      lastRead = now;
      dirty = false;
    }
    const specs: LabelSpec[] = [];
    for (const list of sources.values()) specs.push(...list);
    // 状态变化（换模式/面板开合/尺寸）后重新算：不沿用旧位置，避免在淡出中的题字旁粘住
    const prev = resetPrev ? {} : layouts.value;
    resetPrev = false;
    const next = layoutLabels(
      specs,
      { w: window.innerWidth, h: window.innerHeight },
      reserved,
      prev,
    );
    let sig = "";
    for (const l of next) {
      sig += `${l.id}:${l.form}:${Math.round(l.x)}:${Math.round(l.y)}:${Math.round(l.w)}:${Math.round(l.h)};`;
    }
    if (sig === lastSig) return;
    lastSig = sig;
    const map: Record<string, Layout> = {};
    for (const l of next) map[l.id] = l;
    layouts.value = map;
  }

  return {
    layouts,
    publish(source, specs) {
      sources.set(source, specs);
    },
    solve,
    invalidate() {
      dirty = true;
      resetPrev = true;
    },
  };
}
