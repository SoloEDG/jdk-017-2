export const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));
export const wrap = (v: number, period = 1) => ((v % period) + period) % period;
/** 把经度差折到 (-π, π]，保证跨 180° 经线时永远走短路径。 */
export const wrapPi = (v: number) => {
  const t = wrap(v + Math.PI, Math.PI * 2) - Math.PI;
  return t === -Math.PI ? Math.PI : t;
};
export const radians = (degrees: number) => (degrees * Math.PI) / 180;
export const degrees = (radians: number) => (radians * 180) / Math.PI;
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
