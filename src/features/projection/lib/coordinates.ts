import type { Projection } from "../../../shared/types.ts";
import { radians, wrap, clamp } from "../../../shared/math.ts";
export function projectPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  p: Projection,
) {
  const unit = Math.min(width, height) / 2;
  const a = (x - width / 2) / unit / p.zoom,
    b = (y - height / 2) / unit / p.zoom;
  const radius = Math.hypot(a, b);
  const theta = 2 * Math.atan(radius);
  const angle = Math.atan2(b, a) + radians(p.roll);
  let vx = Math.sin(theta) * Math.cos(angle),
    vy = Math.cos(theta) * (p.mode === "planet" ? -1 : 1),
    vz = Math.sin(theta) * Math.sin(angle);
  const tilt = radians(p.pitch);
  const rotatedY = vy * Math.cos(tilt) - vz * Math.sin(tilt);
  vz = vy * Math.sin(tilt) + vz * Math.cos(tilt);
  vy = rotatedY;
  return {
    u: wrap(Math.atan2(vz, vx) / (Math.PI * 2) + p.yaw / 360),
    v: clamp(0.5 - Math.asin(clamp(vy, -1, 1)) / Math.PI, 0, 1),
  };
}
/**
 * projectPoint 的逆变换：全景 uv → 屏幕像素。
 * 用于把存在球面上的笔触与锚点画回视图；落在投影背面的点返回 null。
 */
export function unprojectPoint(
  u: number,
  v: number,
  width: number,
  height: number,
  p: Projection,
): { x: number; y: number } | null {
  const unit = Math.min(width, height) / 2;
  const lon = u * Math.PI * 2 - radians(p.yaw);
  const lat = (0.5 - v) * Math.PI;
  const cosLat = Math.cos(lat);
  const vx = cosLat * Math.cos(lon);
  let vy = Math.sin(lat),
    vz = cosLat * Math.sin(lon);
  const tilt = radians(p.pitch);
  const unTiltedY = vy * Math.cos(tilt) + vz * Math.sin(tilt);
  vz = -vy * Math.sin(tilt) + vz * Math.cos(tilt);
  vy = unTiltedY;
  const cosTheta = p.mode === "planet" ? -vy : vy;
  const theta = Math.acos(clamp(cosTheta, -1, 1));
  const radius = Math.tan(theta / 2);
  if (!Number.isFinite(radius) || radius > 8) return null;
  const angle =
    Math.sin(theta) > 1e-9 ? Math.atan2(vz, vx) - radians(p.roll) : 0;
  return {
    x: radius * Math.cos(angle) * unit * p.zoom + width / 2,
    y: radius * Math.sin(angle) * unit * p.zoom + height / 2,
  };
}
