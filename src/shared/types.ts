export interface Projection {
  mode: "planet" | "tunnel";
  zoom: number;
  yaw: number;
  pitch: number;
  roll: number;
}
export interface Edge {
  seam: number;
  feather: number;
  background: string;
  transparent: boolean;
}
export interface Asset {
  id: string;
  name: string;
  width: number;
  height: number;
  data: ImageData;
  thumbnail: string;
}
/** 球面位置：等距柱状全景坐标，lon ∈ [0, 2π)，lat ∈ [-π/2, π/2]，单位弧度。 */
export interface SpherePoint {
  lon: number;
  lat: number;
}
/** 一笔涂抹：球面折线 + 角半径（弧度），与投影和输出尺寸无关。 */
export interface Stroke {
  points: SpherePoint[];
  radius: number;
}
/** 独立补丁层：蒙版（笔触并集）+ 取样源锚点，非破坏式，原图永不修改。 */
export interface Patch {
  id: string;
  name: string;
  enabled: boolean;
  /** 叠放顺序，小的先合成。 */
  z: number;
  /** 软边宽度（弧度），蒙版边缘的过渡带。 */
  feather: number;
  strokes: Stroke[];
  /** 目标锚点：待修区域在球面上的中心。 */
  anchor: SpherePoint;
  /** 取样源锚点：干净区域在同一全景上的位置。 */
  source: SpherePoint;
  /** 数据版本号，任何编辑都会递增，用于让图章缓存失效。 */
  revision: number;
}
export interface StudioDocument {
  asset: Asset | null;
  projection: Projection;
  edge: Edge;
  patches: Patch[];
}
export interface ExportSettings {
  size: number;
  format: "png" | "jpeg";
  quality: number;
}
export interface RenderSnapshot {
  asset: Asset;
  projection: Projection;
  edge: Edge;
  patches: Patch[];
  /** 交互拖动中为 true：补丁图章用低分辨率草稿，控制重复采样成本。 */
  draft?: boolean;
}
