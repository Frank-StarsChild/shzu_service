// 舞台标签的统一避让布局（纯函数，不碰 DOM、不依赖 Vue）。
//
// 输入：视口、遮挡矩形（顶栏 / 左侧校区栏 / 右侧面板 / 底部问话栏 / 题字 / 读数）、
// 一组候选标签（稳定 id、优先级、楼顶投影点、完整与紧凑两种尺寸、引线长度、能否挪动），
// 以及上一帧的结果（优先沿用，避免镜头微动时标签来回跳）。
// 输出：每个标签实际矩形、展示形态（full / compact / hidden）与引线落点。
//
// 坐标系：全部是浏览器视口 CSS 像素（handle.project 已含画布 left/top），可直接比较。
// 规矩：楼顶锚点不动；标签只能向上 / 左右挪；挪过的标签由组件从标签边缘画短引线回锚点。

export type Rect = { x: number; y: number; w: number; h: number };

export type LabelForm = "full" | "compact" | "hidden";

export type LabelSpec = {
  /** 稳定 id（同一帧内不得重复） */
  id: string;
  /** 越大越先放；同级按 id 升序，保证拖动时顺序不来回变 */
  priority: number;
  /** 引线落点（楼顶 anchor 的投影；同楼多学院已把错开量并进来） */
  ax: number;
  ay: number;
  /** 完整形态：盒子宽高与引线长度（盒子底中到锚点） */
  w: number;
  h: number;
  gap: number;
  /** 紧凑形态（小院徽 / 小序号 / 小横签） */
  compactW: number;
  compactH: number;
  compactGap: number;
  /** 投影是否在画面里（false 直接 hidden） */
  visible: boolean;
  /** 能否错开：false 时只允许默认位（校区竖签、地标题签）；true 时按 axis 挪 */
  movable: boolean;
  /** 允许的挪动方向：x 只左右（学院灯牌），y 只向上（校区/地标题签，保持竖直引线），
   *  xy 两者都可（楼题签） */
  axis?: "x" | "y" | "xy";
};

export type Layout = {
  id: string;
  form: LabelForm;
  /** 实际矩形（与 spec 的 ax/ay 同坐标系） */
  x: number;
  y: number;
  w: number;
  h: number;
  ax: number;
  ay: number;
  /** 本形态的引线长度（盒子底中到锚点的竖直距离） */
  gap: number;
  /** 盒子相对默认位挪动了没有（是则组件画斜引线） */
  shifted: boolean;
};

export type Viewport = { w: number; h: number };

/** 与遮挡物留的空（像素）；标签之间也留一点 */
const RESERVED_PAD = 8;
const LABEL_PAD = 2;
const VIEW_PAD = 4;

function intersects(a: Rect, b: Rect, pad = 0): boolean {
  return (
    a.x - pad < b.x + b.w
    && a.x + a.w + pad > b.x
    && a.y - pad < b.y + b.h
    && a.y + a.h + pad > b.y
  );
}

function inside(r: Rect, vp: Viewport): boolean {
  return r.x >= VIEW_PAD && r.y >= VIEW_PAD
    && r.x + r.w <= vp.w - VIEW_PAD && r.y + r.h <= vp.h - VIEW_PAD;
}

/** 候选位：默认（锚点正上方）、向上、左右错开 */
type Offset = { dx: number; dy: number };

function offsetsFor(spec: LabelSpec): Offset[] {
  if (!spec.movable) return [{ dx: 0, dy: 0 }];
  const axis = spec.axis ?? "xy";
  if (axis === "y") {
    return [
      { dx: 0, dy: 0 },
      { dx: 0, dy: 30 },
      { dx: 0, dy: 58 },
      { dx: 0, dy: 88 },
    ];
  }
  const list: Offset[] = [
    { dx: 0, dy: 0 },
    { dx: 36, dy: 0 },
    { dx: -36, dy: 0 },
    { dx: 72, dy: 0 },
    { dx: -72, dy: 0 },
  ];
  if (axis === "xy") {
    list.splice(1, 0, { dx: 0, dy: 30 }, { dx: 0, dy: 58 });
    list.push({ dx: 40, dy: 30 }, { dx: -40, dy: 30 });
  }
  return list;
}

/** 盒子按锚点摆位：水平居中于 (ax+dx)，底边在 (ay − gap − dy)，dy 为正 = 向上 */
function boxOf(spec: LabelSpec, w: number, h: number, gap: number, o: Offset): Rect {
  return {
    x: spec.ax + o.dx - w / 2,
    y: spec.ay - gap - o.dy - h,
    w,
    h,
  };
}

function fits(r: Rect, vp: Viewport, reserved: Rect[], accepted: Rect[]): boolean {
  if (!inside(r, vp)) return false;
  for (const o of reserved) if (intersects(r, o, RESERVED_PAD)) return false;
  for (const a of accepted) if (intersects(r, a, LABEL_PAD)) return false;
  return true;
}

/** 上一帧位置：仍不撞、且没有离开默认位太远才沿用（镜头平移后不粘在旧位置） */
function reusePrev(
  prev: Layout | undefined,
  spec: LabelSpec,
  vp: Viewport,
  reserved: Rect[],
  accepted: Rect[],
): Rect | null {
  if (!prev || prev.form !== "full") return null;
  const r = { x: prev.x, y: prev.y, w: prev.w, h: prev.h };
  if (!fits(r, vp, reserved, accepted)) return null;
  const base = boxOf(spec, r.w, r.h, spec.gap, { dx: 0, dy: 0 });
  const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
  const d = { x: base.x + base.w / 2, y: base.y + base.h / 2 };
  if (Math.hypot(c.x - d.x, c.y - d.y) > 110) return null;
  return r;
}

function hiddenOf(spec: LabelSpec): Layout {
  return {
    id: spec.id,
    form: "hidden",
    x: spec.ax - spec.w / 2,
    y: spec.ay - spec.gap - spec.h,
    w: spec.w,
    h: spec.h,
    ax: spec.ax,
    ay: spec.ay,
    gap: spec.gap,
    shifted: false,
  };
}

export function layoutLabels(
  specs: LabelSpec[],
  viewport: Viewport,
  reserved: Rect[],
  prev: Record<string, Layout> = {},
): Layout[] {
  const order = [...specs].sort((a, b) =>
    b.priority - a.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
  const accepted: Rect[] = [];
  const out: Layout[] = [];

  for (const spec of order) {
    if (!spec.visible) {
      out.push(hiddenOf(spec));
      continue;
    }

    // 1) 上一帧位置
    const prevRect = reusePrev(prev[spec.id], spec, viewport, reserved, accepted);
    if (prevRect) {
      accepted.push(prevRect);
      out.push({
        id: spec.id,
        form: "full",
        x: prevRect.x,
        y: prevRect.y,
        w: prevRect.w,
        h: prevRect.h,
        ax: spec.ax,
        ay: spec.ay,
        gap: spec.gap,
        shifted:
          Math.abs(prevRect.x + prevRect.w / 2 - spec.ax) > 0.5
          || Math.abs(prevRect.y + prevRect.h - (spec.ay - spec.gap)) > 0.5,
      });
      continue;
    }

    // 2) 完整形态的各个候选位
    let placed: Layout | null = null;
    for (const o of offsetsFor(spec)) {
      const r = boxOf(spec, spec.w, spec.h, spec.gap, o);
      if (!fits(r, viewport, reserved, accepted)) continue;
      placed = {
        id: spec.id,
        form: "full",
        ...r,
        ax: spec.ax,
        ay: spec.ay,
        gap: spec.gap,
        shifted: o.dx !== 0 || o.dy !== 0,
      };
      accepted.push(r);
      break;
    }
    if (placed) {
      out.push(placed);
      continue;
    }

    // 3) 紧凑形态（小院徽 / 小序号 / 小横签）
    const compactOffsets: Offset[] = spec.movable
      ? ((spec.axis ?? "xy") === "y"
          ? [{ dx: 0, dy: 0 }, { dx: 0, dy: 26 }]
          : [
              { dx: 0, dy: 0 },
              { dx: 28, dy: 0 },
              { dx: -28, dy: 0 },
              ...((spec.axis ?? "xy") === "xy" ? [{ dx: 0, dy: 26 }] : []),
            ])
      : [{ dx: 0, dy: 0 }];
    for (const o of compactOffsets) {
      const r = boxOf(spec, spec.compactW, spec.compactH, spec.compactGap, o);
      if (!fits(r, viewport, reserved, accepted)) continue;
      placed = {
        id: spec.id,
        form: "compact",
        ...r,
        ax: spec.ax,
        ay: spec.ay,
        gap: spec.compactGap,
        shifted: o.dx !== 0 || o.dy !== 0,
      };
      accepted.push(r);
      break;
    }
    out.push(placed ?? hiddenOf(spec));
  }

  return out;
}

/** 由布局反推「相对默认位」的位移（组件写样式与画引线都用它） */
export function shiftOf(l: Layout): { dx: number; dy: number } {
  if (l.form === "hidden") return { dx: 0, dy: 0 };
  return {
    dx: l.x + l.w / 2 - l.ax,
    dy: l.ay - l.gap - (l.y + l.h),
  };
}
