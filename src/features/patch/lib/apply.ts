import type { Asset, Patch } from "../../../shared/types";
import { getStamp, sampleStamp, STAMP_DRAFT, STAMP_FULL, type Stamp } from "./stamp";

export interface PatchLayer {
  stamp: Stamp;
}
/**
 * 整理一次渲染要用的补丁层：启用、按 z 升序（先画的在底），
 * 并确保图章缓存有效。预览与导出都经过这里，合成顺序一致。
 */
export function prepareLayers(
  patches: Patch[],
  asset: Asset,
  seam: number,
  draft: boolean,
): PatchLayer[] {
  const maxDim = draft ? STAMP_DRAFT : STAMP_FULL;
  const layers: PatchLayer[] = [];
  const sorted = patches
    .filter((p) => p.enabled && p.strokes.length > 0)
    .sort((a, b) => a.z - b.z);
  for (const p of sorted) {
    const stamp = getStamp(asset, p, seam, maxDim);
    if (stamp) layers.push({ stamp });
  }
  return layers;
}
/** 在底色 rgba 上按顺序叠涂补丁（图章为预乘 alpha）。 */
export function applyLayers(
  rgba: number[],
  u: number,
  v: number,
  layers: PatchLayer[],
): number[] {
  let out = rgba;
  for (const { stamp } of layers) {
    const c = sampleStamp(stamp, u, v);
    if (c[3] <= 0) continue;
    const a = c[3] / 255;
    const keep = 1 - a;
    out = [
      c[0] + out[0] * keep,
      c[1] + out[1] * keep,
      c[2] + out[2] * keep,
      c[3] + out[3] * keep,
    ];
  }
  return out;
}
