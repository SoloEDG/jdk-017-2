import type { RenderSnapshot } from "../../../shared/types";
import { projectPoint } from "./coordinates";
import { sample } from "./sampling";
import { applyEdge } from "../../edge";
import { prepareLayers, applyLayers } from "../../patch";
export function renderRows(
  s: RenderSnapshot,
  image: ImageData,
  start: number,
  end: number,
  offset = 0,
  fullHeight = image.height,
) {
  // 补丁层在逐像素循环前准备好：图章缓存命中时几乎零成本
  const layers = prepareLayers(s.patches, s.asset, s.edge.seam, !!s.draft);
  for (let y = start; y < end; y++)
    for (let x = 0; x < image.width; x++) {
      const uv = projectPoint(
        x + 0.5,
        y + 0.5,
        image.width,
        fullHeight,
        s.projection,
      );
      // 同一合成顺序：底色 → 补丁（按 z 序）→ 边缘处理，预览与导出一致
      const base = sample(s.asset, uv.u, uv.v, s.edge.seam);
      const rgba = layers.length ? applyLayers(base, uv.u, uv.v, layers) : base;
      const result = applyEdge(
        rgba,
        x + 0.5,
        y + 0.5,
        image.width,
        fullHeight,
        s.edge,
      );
      const at = ((y - offset) * image.width + x) * 4;
      for (let c = 0; c < 4; c++) image.data[at + c] = result[c];
    }
}
export function renderPreview(
  canvas: HTMLCanvasElement,
  s: RenderSnapshot,
  size: number,
) {
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(size, size);
  renderRows(s, image, 0, size);
  ctx.putImageData(image, 0, 0);
}
