import type { Patch, Projection, SpherePoint } from "../../../shared/types";
import { unprojectPoint } from "../../projection/lib/coordinates";
import { destination } from "./sphere";

export interface OverlayState {
  patches: Patch[];
  activeId: string | null;
  mode: "view" | "paint" | "source";
  brushRadius: number;
  hover: SpherePoint | null;
}

const MASK = "rgba(194, 98, 43, 0.4)";
const MASK_ACTIVE = "rgba(194, 98, 43, 0.6)";
const LINE = "#c2622b";
const SOURCE = "#337d60";

/** 角半径 → 屏幕像素半径（在 p 处沿任意方向偏移 r 再投影）。 */
function screenRadius(
  p: SpherePoint,
  r: number,
  w: number,
  h: number,
  proj: Projection,
): number | null {
  const c = unprojectPoint(p.lon / (Math.PI * 2), 0.5 - p.lat / Math.PI, w, h, proj);
  if (!c) return null;
  for (const brg of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const q = destination(p, brg, r);
    const s = unprojectPoint(q.lon / (Math.PI * 2), 0.5 - q.lat / Math.PI, w, h, proj);
    if (s) return Math.hypot(s.x - c.x, s.y - c.y);
  }
  return null;
}
function toScreen(p: SpherePoint, w: number, h: number, proj: Projection) {
  return unprojectPoint(p.lon / (Math.PI * 2), 0.5 - p.lat / Math.PI, w, h, proj);
}

/** 把存在球面上的笔触、锚点、笔刷光标画到视口覆盖层。 */
export function drawOverlay(
  canvas: HTMLCanvasElement,
  proj: Projection,
  state: OverlayState,
) {
  const w = canvas.width,
    h = canvas.height;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = ctx.lineJoin = "round";
  for (const patch of state.patches) {
    if (!patch.enabled && patch.id !== state.activeId) continue;
    const isActive = patch.id === state.activeId;
    ctx.fillStyle = isActive ? MASK_ACTIVE : MASK;
    // 蒙版笔触：逐点画圆盘，点距 ≤ 1/4 半径，视觉上连成管道
    for (const stroke of patch.strokes)
      for (const pt of stroke.points) {
        const c = toScreen(pt, w, h, proj);
        const r = screenRadius(pt, stroke.radius, w, h, proj);
        if (!c || r === null || r > w) continue;
        ctx.beginPath();
        ctx.arc(c.x, c.y, Math.max(r, 1.5), 0, Math.PI * 2);
        ctx.fill();
      }
    if (!patch.strokes.length) continue;
    // 目标锚点：暖色圆环
    const anchor = toScreen(patch.anchor, w, h, proj);
    if (anchor) {
      ctx.strokeStyle = LINE;
      ctx.lineWidth = isActive ? 2 : 1.2;
      ctx.beginPath();
      ctx.arc(anchor.x, anchor.y, isActive ? 6 : 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 取样源锚点：绿色十字（仅活动补丁，避免杂乱）
    if (isActive) {
      const s = toScreen(patch.source, w, h, proj);
      if (s) {
        ctx.strokeStyle = SOURCE;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 7, 0, Math.PI * 2);
        ctx.moveTo(s.x - 11, s.y);
        ctx.lineTo(s.x + 11, s.y);
        ctx.moveTo(s.x, s.y - 11);
        ctx.lineTo(s.x, s.y + 11);
        ctx.stroke();
        if (anchor) {
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(anchor.x, anchor.y);
          ctx.lineTo(s.x, s.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
    }
  }
  // 涂抹模式下的笔刷光标
  if (state.mode === "paint" && state.hover) {
    const c = toScreen(state.hover, w, h, proj);
    const r = screenRadius(state.hover, state.brushRadius, w, h, proj);
    if (c && r !== null && r <= w) {
      ctx.strokeStyle = LINE;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(r, 2), 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}
