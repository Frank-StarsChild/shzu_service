// STAGE W2：读数用的三个纯函数（时辰、方位角、中文序号）。

const SHICHEN_CHARS = "子丑寅卯辰巳午未申酉戌亥";

/** 小时（0–23）对应的时辰。 */
export function shichen(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  return SHICHEN_CHARS[Math.floor(((h + 1) % 24) / 2)] + "时";
}

/**
 * 方位角（STAGE 6.2）：从相机指向目标点的水平方向，相对正北顺时针的角度（度，[0, 360)）。
 * 场景坐标 X 朝东、Y 朝上、Z 朝南：d = target − position，atan2(d.x, −d.z)。
 */
export function azimuthDeg(
  position: [number, number, number],
  target: [number, number, number]
): number {
  const dx = target[0] - position[0];
  const dz = target[2] - position[2];
  const deg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  const norm = ((deg % 360) + 360) % 360;
  return norm === 360 ? 0 : norm;
}

const CN_DIGITS = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 1–20 的中文序号（一…十、十一…十九、二十）。 */
export function cnNumber(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 20) {
    throw new Error(`cnNumber 只支持 1 到 20（收到 ${n}）`);
  }
  if (n <= 10) return n === 10 ? "十" : CN_DIGITS[n];
  if (n < 20) return "十" + CN_DIGITS[n - 10];
  return "二十";
}

/**
 * 读数第二行（W2 第 6 条）：把 meta.look.hud.coord 里的两个数取出来，
 * 排成「北纬 X° 东经 Y°」。支持字母在前（"N 44.305° E 86.060°"）与
 * 数字在前（"44.305° N 86.060° E"）两种写法；解析不出来就原样返回。
 */
export function coordText(coord: string): string {
  const s = coord.trim();
  let m = /^([NS])\s*([0-9]+(?:\.[0-9]+)?)\s*°?\s*[,，]?\s*([EW])\s*([0-9]+(?:\.[0-9]+)?)\s*°?$/i.exec(s);
  if (m) return `北纬 ${m[2]}° 东经 ${m[4]}°`;
  m = /^([0-9]+(?:\.[0-9]+)?)\s*°?\s*([NS])\s*,?\s*([0-9]+(?:\.[0-9]+)?)\s*°?\s*([EW])$/i.exec(s);
  if (m) return `北纬 ${m[1]}° 东经 ${m[3]}°`;
  return coord;
}
