import type { Asset, Patch, SpherePoint } from "../../../shared/types";
import { clamp, smoothstep, wrap, wrapPi } from "../../../shared/math";
import { sample } from "../../projection/lib/sampling";
import {
  buildStrokeGeometry,
  destination,
  distToStroke,
  toVec,
  transport,
  type StrokeGeometry,
} from "./sphere";

/**
 * 补丁图章：在等距柱状（uv）空间里预栅格化的小块，
 * 存预乘 alpha 的颜色与蒙版覆盖率。
 * 只依赖补丁数据本身 —— 旋转星球、切换投影、改输出尺寸都不会让它失效。
 */
export interface Stamp {
  image: ImageData;
  lon0: number; // 左边缘经度（未折回，配合 wrapPi 采样）
  latTop: number; // 上边缘纬度
  lonSpan: number; // 覆盖经度范围（弧度，≤ 2π）
  latSpan: number; // 覆盖纬度范围（弧度）
}

export const STAMP_FULL = 1024; // 全分辨率图章最大边长（小补丁按全景原始密度采样，不触顶）
export const STAMP_DRAFT = 128; // 交互拖动中的草稿边长

interface Prepared {
  geoms: { g: StrokeGeometry; radius: number }[];
  reach: number; // 蒙版相对锚点的最大角距 + 软边
}

function prepare(patch: Patch): Prepared | null {
  const geoms = patch.strokes
    .filter((s) => s.points.length > 0)
    .map((s) => ({ g: buildStrokeGeometry(s.points), radius: s.radius }));
  if (!geoms.length) return null;
  let reach = 0;
  const anchor = toVec(patch.anchor);
  for (const { g, radius } of geoms)
    for (const e of g.ends) {
      const d = Math.acos(clamp(e[0] * anchor[0] + e[1] * anchor[1] + e[2] * anchor[2], -1, 1));
      reach = Math.max(reach, d + radius);
    }
  return { geoms, reach: reach + patch.feather };
}

/** 覆盖球冠的 uv 包围盒；含极点时经度拉满，避免极点处无限放大。 */
function capBounds(anchor: SpherePoint, reach: number) {
  const latTop = Math.min(Math.PI / 2, anchor.lat + reach);
  const latBottom = Math.max(-Math.PI / 2, anchor.lat - reach);
  const containsPole =
    anchor.lat + reach >= Math.PI / 2 || anchor.lat - reach <= -Math.PI / 2;
  let lonHalf = Math.PI;
  if (!containsPole) {
    // 采样球冠边界估算经度半宽，再留 8% 余量
    let half = 0;
    for (let i = 0; i < 48; i++) {
      const p = destination(anchor, (i / 48) * Math.PI * 2, reach);
      half = Math.max(half, Math.abs(wrapPi(p.lon - anchor.lon)));
    }
    lonHalf = Math.min(Math.PI, half * 1.08 + 1e-3);
  }
  return {
    lon0: anchor.lon - lonHalf,
    latTop,
    lonSpan: lonHalf * 2,
    latSpan: latTop - latBottom,
  };
}

/** 补丁蒙版在 uv 空间的包围盒（无笔触时为 null），烘焙与图章共用。 */
export function computeBounds(patch: Patch) {
  const prep = prepare(patch);
  if (!prep) return null;
  const box = capBounds(patch.anchor, prep.reach);
  if (box.latSpan <= 0 || box.lonSpan <= 0) return null;
  return box;
}

export function buildStamp(
  asset: Asset,
  patch: Patch,
  seam: number,
  maxDim: number,
): Stamp | null {
  const prep = prepare(patch);
  if (!prep) return null;
  const box = capBounds(patch.anchor, prep.reach);
  if (box.latSpan <= 0 || box.lonSpan <= 0) return null;
  // 分辨率对齐全景本身的像素密度，再按 maxDim 收敛，控制内存与采样成本
  const naturalW = (box.lonSpan / (Math.PI * 2)) * asset.width;
  const naturalH = (box.latSpan / Math.PI) * asset.height;
  const scale = Math.min(1, maxDim / Math.max(naturalW, naturalH, 1));
  const w = Math.max(4, Math.round(naturalW * scale));
  const h = Math.max(4, Math.round(naturalH * scale));
  const image = new ImageData(w, h);
  const feather = Math.max(patch.feather, 1e-4);
  for (let j = 0; j < h; j++) {
    const lat = box.latTop - ((j + 0.5) / h) * box.latSpan;
    for (let i = 0; i < w; i++) {
      const lon = box.lon0 + ((i + 0.5) / w) * box.lonSpan;
      const q = toVec({ lon, lat });
      let cov = 0;
      for (const { g, radius } of prep.geoms) {
        const d = distToStroke(q, g);
        const c = 1 - smoothstep(radius - feather, radius, d);
        if (c > cov) cov = c;
        if (cov >= 1) break;
      }
      const at = (j * w + i) * 4;
      if (cov <= 0.002) continue;
      const src = transport({ lon, lat }, patch.anchor, patch.source);
      const rgba = sample(
        asset,
        src.lon / (Math.PI * 2),
        0.5 - src.lat / Math.PI,
        seam,
      );
      image.data[at] = rgba[0] * cov;
      image.data[at + 1] = rgba[1] * cov;
      image.data[at + 2] = rgba[2] * cov;
      image.data[at + 3] = cov * 255;
    }
  }
  return { image, ...box };
}

interface CacheEntry {
  key: string;
  stamp: Stamp | null;
}
const cache = new WeakMap<Patch, CacheEntry>();

/** 取补丁图章；只有 revision / seam / 精度 / 素材变化才重建。 */
export function getStamp(
  asset: Asset,
  patch: Patch,
  seam: number,
  maxDim: number,
): Stamp | null {
  const key = `${patch.revision}|${seam}|${maxDim}|${asset.id}`;
  const hit = cache.get(patch);
  if (hit && hit.key === key) return hit.stamp;
  const stamp = buildStamp(asset, patch, seam, maxDim);
  cache.set(patch, { key, stamp });
  return stamp;
}

/** 在 uv 处采样图章（预乘 alpha）。经度对齐分两种：不满一圈用 wrapPi 短偏移，含极点满圈时按 [0, 2π) 展开。 */
export function sampleStamp(stamp: Stamp, u: number, v: number): number[] {
  const lon = u * Math.PI * 2;
  const lat = (0.5 - v) * Math.PI;
  const full = stamp.lonSpan >= Math.PI * 2 - 1e-9;
  const dl = full
    ? wrap(lon - stamp.lon0, Math.PI * 2)
    : wrapPi(lon - stamp.lon0);
  const fx = (dl / stamp.lonSpan) * stamp.image.width - 0.5;
  const fy = ((stamp.latTop - lat) / stamp.latSpan) * stamp.image.height - 0.5;
  if (fx < -0.5 || fy < -0.5 || fx > stamp.image.width - 0.5 || fy > stamp.image.height - 0.5)
    return ZERO;
  const x = clamp(fx, 0, stamp.image.width - 1);
  const y = clamp(fy, 0, stamp.image.height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const dx = x - x0, dy = y - y0;
  const x1 = Math.min(x0 + 1, stamp.image.width - 1);
  const y1 = Math.min(y0 + 1, stamp.image.height - 1);
  const d = stamp.image.data, w = stamp.image.width;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const a = d[(y0 * w + x0) * 4 + c], b = d[(y0 * w + x1) * 4 + c];
    const e = d[(y1 * w + x0) * 4 + c], f = d[(y1 * w + x1) * 4 + c];
    out[c] = (a * (1 - dx) + b * dx) * (1 - dy) + (e * (1 - dx) + f * dx) * dy;
  }
  return out;
}
const ZERO = [0, 0, 0, 0];
