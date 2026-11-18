import { markRaw, reactive } from "vue";
import type {
  Asset,
  Patch,
  SpherePoint,
  StudioDocument,
} from "../../../shared/types";
import { clamp, radians, smoothstep, wrap } from "../../../shared/math";
import { sample } from "../../projection/lib/sampling";
import { computeBounds } from "../lib/stamp";
import {
  buildStrokeGeometry,
  distance,
  distToStroke,
  toVec,
  transport,
} from "../lib/sphere";

export type PatchMode = "view" | "paint" | "source";

export interface BakeSnapshot {
  asset: Asset;
  patches: Patch[];
}

export function uvToSphere(u: number, v: number): SpherePoint {
  return {
    lon: wrap(u) * Math.PI * 2,
    lat: (0.5 - clamp(v, 0, 1)) * Math.PI,
  };
}

let serial = 0;

export function usePatches(doc: StudioDocument) {
  const ctl = reactive({
    mode: "view" as PatchMode,
    activeId: null as string | null,
    /** 笔刷角半径（弧度），球面量纲，不随投影/输出尺寸变化。 */
    brushRadius: radians(1.8),
    /** 交互拖动时降低图章精度，控制重复采样成本。 */
    draftQuality: true,
    interacting: false,
    history: [] as BakeSnapshot[],
  });

  const active = (): Patch | undefined =>
    doc.patches.find((p) => p.id === ctl.activeId);
  // 当前手势：区分涂抹与拖取样源，避免 pointerup 时互相误触发
  let gesture: "none" | "stroke" | "source" = "none";

  function normalizeZ() {
    [...doc.patches]
      .sort((a, b) => a.z - b.z)
      .forEach((p, i) => (p.z = i));
  }
  function touch(p: Patch) {
    p.revision++;
  }
  /** 锚点 = 所有笔触点的球面质心（3D 平均后归一化，跨经线安全）。 */
  function recenter(p: Patch) {
    let x = 0,
      y = 0,
      z = 0,
      n = 0;
    for (const s of p.strokes)
      for (const pt of s.points) {
        const v = toVec(pt);
        x += v[0];
        y += v[1];
        z += v[2];
        n++;
      }
    if (!n) return;
    const l = Math.hypot(x, y, z);
    if (l < 1e-9) return;
    p.anchor = {
      lon: wrap(Math.atan2(z / l, x / l), Math.PI * 2),
      lat: Math.asin(clamp(y / l, -1, 1)),
    };
  }

  function createPatch(): Patch {
    const p: Patch = {
      id: crypto.randomUUID(),
      name: `补丁 ${++serial}`,
      enabled: true,
      z: doc.patches.length ? Math.max(...doc.patches.map((q) => q.z)) + 1 : 0,
      feather: radians(0.8),
      strokes: [],
      anchor: { lon: 0, lat: 0 },
      source: { lon: 0, lat: 0 },
      revision: 0,
    };
    doc.patches.push(p);
    ctl.activeId = p.id;
    return p;
  }
  function setMode(mode: PatchMode) {
    ctl.mode = mode;
    if (mode !== "view" && !active()) createPatch();
  }

  // —— 涂抹蒙版 ——
  function beginStroke(u: number, v: number) {
    const p = active() ?? createPatch();
    p.strokes.push({ points: [uvToSphere(u, v)], radius: ctl.brushRadius });
    gesture = "stroke";
    ctl.interacting = true;
    touch(p);
  }
  function extendStroke(u: number, v: number) {
    const p = active();
    if (!p || gesture !== "stroke" || !p.strokes.length) return;
    const stroke = p.strokes[p.strokes.length - 1];
    const pt = uvToSphere(u, v);
    // 稀疏采样：小于 1/4 笔刷半径的移动直接丢弃，控制点数与重采样成本
    if (distance(stroke.points[stroke.points.length - 1], pt) < stroke.radius / 4)
      return;
    stroke.points.push(pt);
    touch(p);
  }
  function endStroke() {
    if (gesture !== "stroke") return;
    gesture = "none";
    ctl.interacting = false;
    const p = active();
    if (!p || !p.strokes.length) return;
    const first = p.strokes.length === 1;
    recenter(p);
    if (first) {
      // 第一笔完成后：取样源默认落在锚点上，引导用户接着选取干净区域
      p.source = { ...p.anchor };
      ctl.mode = "source";
    }
    touch(p);
  }

  // —— 取样源（位移） ——
  function beginSource() {
    if (!active()) return;
    gesture = "source";
    ctl.interacting = true;
  }
  function dragSource(u: number, v: number) {
    const p = active();
    if (!p || gesture !== "source") return;
    p.source = uvToSphere(u, v);
    touch(p);
  }
  function endSource() {
    if (gesture !== "source") return;
    gesture = "none";
    ctl.interacting = false;
  }

  // —— 图层管理 ——
  function toggle(id: string) {
    const p = doc.patches.find((q) => q.id === id);
    if (p) p.enabled = !p.enabled;
  }
  function remove(id: string) {
    const i = doc.patches.findIndex((q) => q.id === id);
    if (i < 0) return;
    doc.patches.splice(i, 1);
    if (ctl.activeId === id) {
      ctl.activeId = doc.patches[0]?.id ?? null;
      if (ctl.mode !== "view" && !doc.patches.length) ctl.mode = "view";
    }
    normalizeZ();
  }
  function move(id: string, dir: -1 | 1) {
    const sorted = [...doc.patches].sort((a, b) => a.z - b.z);
    const i = sorted.findIndex((q) => q.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sorted.length) return;
    [sorted[i].z, sorted[j].z] = [sorted[j].z, sorted[i].z];
    normalizeZ();
  }
  function setFeather(id: string, degrees: number) {
    const p = doc.patches.find((q) => q.id === id);
    if (!p) return;
    p.feather = radians(clamp(degrees, 0, 8));
    touch(p);
  }
  function select(id: string, mode?: PatchMode) {
    ctl.activeId = id;
    if (mode) ctl.mode = mode;
  }

  // —— 烘焙：补丁合成进一张新素材；原素材进历史，可无损恢复 ——
  function bake() {
    const asset = doc.asset;
    if (!asset) return;
    const layers = doc.patches
      .filter((p) => p.enabled && p.strokes.length > 0)
      .sort((a, b) => a.z - b.z);
    if (!layers.length) return;
    const data = new ImageData(
      new Uint8ClampedArray(asset.data.data),
      asset.width,
      asset.height,
    );
    // 与 renderRows 同一套合成顺序：逐补丁、按 z 序叠到原图副本上
    for (const p of layers) bakePatch(asset, p, data, doc.edge.seam);
    const canvas = document.createElement("canvas");
    canvas.width = asset.width;
    canvas.height = asset.height;
    canvas.getContext("2d")!.putImageData(data, 0, 0);
    const thumb = document.createElement("canvas");
    thumb.width = 240;
    thumb.height = 120;
    thumb.getContext("2d")!.drawImage(canvas, 0, 0, 240, 120);
    const baked: Asset = {
      id: crypto.randomUUID(),
      name: `${asset.name} · 已修补`,
      width: asset.width,
      height: asset.height,
      data,
      thumbnail: thumb.toDataURL("image/jpeg", 0.7),
    };
    ctl.history.push({ asset, patches: doc.patches.splice(0) });
    doc.asset = markRaw(baked);
    ctl.activeId = null;
    ctl.mode = "view";
  }
  function restore() {
    const snap = ctl.history.pop();
    if (!snap) return;
    doc.asset = markRaw(snap.asset);
    doc.patches.push(...snap.patches);
    normalizeZ();
  }

  return {
    ctl,
    active,
    setMode,
    createPatch,
    beginStroke,
    extendStroke,
    endStroke,
    beginSource,
    dragSource,
    endSource,
    toggle,
    remove,
    move,
    setFeather,
    select,
    bake,
    restore,
  };
}
export type PatchController = ReturnType<typeof usePatches>;

/**
 * 烘焙单补丁：在素材原始分辨率下逐像素计算覆盖率与取样，
 * 与预览同一公式，但不经过图章缩放，质量无损。
 */
function bakePatch(asset: Asset, p: Patch, out: ImageData, seam: number) {
  const box = computeBounds(p);
  if (!box) return;
  const W = asset.width,
    H = asset.height;
  const x0 = Math.floor((box.lon0 / (Math.PI * 2)) * W);
  const x1 = Math.ceil(((box.lon0 + box.lonSpan) / (Math.PI * 2)) * W);
  const y0 = Math.max(0, Math.floor((0.5 - box.latTop / Math.PI) * H));
  const y1 = Math.min(
    H - 1,
    Math.ceil((0.5 - (box.latTop - box.latSpan) / Math.PI) * H),
  );
  const prepared = p.strokes.map((s) => ({
    radius: s.radius,
    g: buildStrokeGeometry(s.points),
  }));
  const feather = Math.max(p.feather, 1e-4);
  // 列数对 W 取帽：含极点时经度满圈，避免同一列被重复合成
  const columns = Math.min(x1 - x0, W - 1);
  for (let y = y0; y <= y1; y++) {
    const lat = (0.5 - (y + 0.5) / H) * Math.PI;
    for (let k = 0; k <= columns; k++) {
      const xx = wrap(x0 + k, W);
      const lon = ((xx + 0.5) / W) * Math.PI * 2;
      const q = toVec({ lon, lat });
      let cov = 0;
      for (const { g, radius } of prepared) {
        const c =
          1 - smoothstep(radius - feather, radius, distToStroke(q, g));
        if (c > cov) cov = c;
        if (cov >= 1) break;
      }
      if (cov <= 0.002) continue;
      const t = transport({ lon, lat }, p.anchor, p.source);
      const rgba = sample(asset, t.lon / (Math.PI * 2), 0.5 - t.lat / Math.PI, seam);
      const at = (y * W + xx) * 4;
      const keep = 1 - cov;
      out.data[at] = rgba[0] * cov + out.data[at] * keep;
      out.data[at + 1] = rgba[1] * cov + out.data[at + 1] * keep;
      out.data[at + 2] = rgba[2] * cov + out.data[at + 2] * keep;
      out.data[at + 3] = rgba[3] * cov + out.data[at + 3] * keep;
    }
  }
}
