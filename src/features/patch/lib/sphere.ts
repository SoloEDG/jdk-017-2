import type { SpherePoint } from "../../../shared/types";
import { clamp, wrap, wrapPi } from "../../../shared/math";

export type Vec3 = [number, number, number];

/** 球面经纬度 → 单位向量。经度以 2π 为周期，跨经线天然连续。 */
export function toVec(p: SpherePoint): Vec3 {
  const c = Math.cos(p.lat);
  return [c * Math.cos(p.lon), Math.sin(p.lat), c * Math.sin(p.lon)];
}
export function toPoint(v: Vec3): SpherePoint {
  return {
    lon: wrap(Math.atan2(v[2], v[0]), Math.PI * 2),
    lat: Math.asin(clamp(v[1], -1, 1)),
  };
}
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
/** 两点间大圆角距（弧度）。 */
export function distance(a: SpherePoint, b: SpherePoint): number {
  return Math.acos(clamp(dot(toVec(a), toVec(b)), -1, 1));
}
/** 从 from 指向 to 的方位角（弧度，正北为 0，顺时针）。 */
export function bearing(from: SpherePoint, to: SpherePoint): number {
  const dLon = wrapPi(to.lon - from.lon);
  const y = Math.sin(dLon) * Math.cos(to.lat);
  const x =
    Math.cos(from.lat) * Math.sin(to.lat) -
    Math.sin(from.lat) * Math.cos(to.lat) * Math.cos(dLon);
  return Math.atan2(y, x);
}
/** 从 from 出发，沿方位角 brg 走角距 d 后的落点。 */
export function destination(
  from: SpherePoint,
  brg: number,
  d: number,
): SpherePoint {
  const sinLat =
    Math.sin(from.lat) * Math.cos(d) +
    Math.cos(from.lat) * Math.sin(d) * Math.cos(brg);
  const lat = Math.asin(clamp(sinLat, -1, 1));
  const y = Math.sin(brg) * Math.sin(d) * Math.cos(from.lat);
  const x = Math.cos(d) - Math.sin(from.lat) * sinLat;
  return { lon: wrap(from.lon + Math.atan2(y, x), Math.PI * 2), lat };
}
/**
 * 把目标锚点附近的一点 q 平移到取样源坐标系：
 * 保持相对方位角与角距不变（等距方位局部标架），
 * 全程大圆计算，跨经线、近极点都不会绕远路或发散。
 */
export function transport(
  q: SpherePoint,
  target: SpherePoint,
  source: SpherePoint,
): SpherePoint {
  const d = distance(target, q);
  if (d < 1e-9) return source;
  return destination(source, bearing(target, q), d);
}

/** 预计算的大圆弧段，用于蒙版覆盖率查询。 */
export interface Segment {
  a: Vec3;
  b: Vec3;
  n: Vec3; // 归一化的 a×b，所在大圆法向
  len: number; // 弧长（弧度）
}
export function buildSegments(points: SpherePoint[]): Segment[] {
  const out: Segment[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = toVec(points[i]);
    const b = toVec(points[i + 1]);
    const len = Math.acos(clamp(dot(a, b), -1, 1));
    if (len < 1e-9) continue;
    out.push({ a, b, n: norm(cross(a, b)), len });
  }
  return out;
}
/**
 * 点 q 到大圆弧段的最短角距。
 * 全部在 3D 向量空间完成：经线 0/2π 处连续，极点附近不放大。
 */
export function distToSegment(q: Vec3, s: Segment): number {
  // q 到大圆所在平面的角距即到大圆（整圆）的距离
  const onCircle = Math.abs(Math.asin(clamp(dot(q, s.n), -1, 1)));
  // q 在大圆上的最近点是否落在弧段内：沿弧方向与 a、b 的夹角都不超过弧长
  const t = norm([
    q[0] - s.n[0] * dot(q, s.n),
    q[1] - s.n[1] * dot(q, s.n),
    q[2] - s.n[2] * dot(q, s.n),
  ]);
  const da = Math.acos(clamp(dot(s.a, t), -1, 1));
  const db = Math.acos(clamp(dot(t, s.b), -1, 1));
  if (da <= s.len && db <= s.len) return onCircle;
  return Math.min(
    Math.acos(clamp(dot(q, s.a), -1, 1)),
    Math.acos(clamp(dot(q, s.b), -1, 1)),
  );
}
/** 预计算的笔触几何：弧段 + 端点向量，蒙版查询时复用，避免逐像素重建。 */
export interface StrokeGeometry {
  segments: Segment[];
  ends: Vec3[];
}
export function buildStrokeGeometry(points: SpherePoint[]): StrokeGeometry {
  return {
    segments: buildSegments(points),
    ends: points.map(toVec),
  };
}
/** 点到笔触（折线 + 圆头端点）的最短角距。 */
export function distToStroke(q: Vec3, g: StrokeGeometry): number {
  let best = Infinity;
  for (const s of g.segments) best = Math.min(best, distToSegment(q, s));
  if (g.segments.length === 0)
    for (const e of g.ends)
      best = Math.min(best, Math.acos(clamp(dot(q, e), -1, 1)));
  return best;
}
