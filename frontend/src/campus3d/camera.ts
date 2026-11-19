// PLAN S6：镜头缓动与停靠点插值。纯函数，不依赖 three（可穷举测试）。
import type { Stop } from "./meta";

/** 先慢后快再慢（cubic in-out）。 */
export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 对 position 和 target 逐分量线性插值。 */
export function lerpStop(a: Stop, b: Stop, t: number): Stop {
  return {
    position: [
      lerp(a.position[0], b.position[0], t),
      lerp(a.position[1], b.position[1], t),
      lerp(a.position[2], b.position[2], t),
    ],
    target: [
      lerp(a.target[0], b.target[0], t),
      lerp(a.target[1], b.target[1], t),
      lerp(a.target[2], b.target[2], t),
    ],
  };
}
