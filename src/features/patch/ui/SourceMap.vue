<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import type { Patch, StudioDocument } from "../../../shared/types";
import { wrapPi } from "../../../shared/math";
import type { PatchController } from "../model/usePatches";

const props = defineProps<{
  doc: StudioDocument;
  patch: PatchController;
  target: Patch;
}>();

const W = 236;
const H = 118;
const canvas = ref<HTMLCanvasElement>();
let thumb: HTMLImageElement | null = null;
let frame = 0;

const toX = (lon: number) => (lon / (Math.PI * 2)) * W;
const toY = (lat: number) => (0.5 - lat / Math.PI) * H;

function draw() {
  const c = canvas.value;
  if (!c) return;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, W, H);
  if (thumb) ctx.drawImage(thumb, 0, 0, W, H);
  else {
    ctx.fillStyle = "#eef2ec";
    ctx.fillRect(0, 0, W, H);
  }
  const p = props.target;
  // 经度展开绘制：折线先解缠成连续坐标，再按 -W/0/+W 画三遍，跨经线不走远路
  for (const stroke of p.strokes) {
    const xs: number[] = [];
    const ys: number[] = [];
    let px: number | null = null;
    for (const pt of stroke.points) {
      const x: number =
        px === null
          ? toX(pt.lon)
          : px + (wrapPi(pt.lon - (px / W) * Math.PI * 2) / (Math.PI * 2)) * W;
      xs.push(x);
      ys.push(toY(pt.lat));
      px = x;
    }
    for (const off of [-W, 0, W]) {
      ctx.strokeStyle = "rgba(194, 98, 43, 0.85)";
      ctx.lineWidth = Math.max(1.5, (stroke.radius / Math.PI) * H);
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.beginPath();
      xs.forEach((x, i) =>
        i === 0 ? ctx.moveTo(x + off, ys[i]) : ctx.lineTo(x + off, ys[i]),
      );
      ctx.stroke();
    }
  }
  // 锚点：目标 = 暖色环，取样源 = 绿色十字；位移用虚线连接（短路径）
  const ax = toX(p.anchor.lon);
  const ay = toY(p.anchor.lat);
  const dx = (wrapPi(p.source.lon - p.anchor.lon) / (Math.PI * 2)) * W;
  const sx = ax + dx;
  const sy = toY(p.source.lat);
  for (const off of [-W, 0, W]) {
    ctx.strokeStyle = "#c2622b";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(ax + off, ay, 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = "#8a938a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(ax + off, ay);
    ctx.lineTo(sx + off, sy);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = "#337d60";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(sx + off, sy, 5, 0, Math.PI * 2);
    ctx.moveTo(sx + off - 8, sy);
    ctx.lineTo(sx + off + 8, sy);
    ctx.moveTo(sx + off, sy - 8);
    ctx.lineTo(sx + off, sy + 8);
    ctx.stroke();
  }
}
function schedule() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(draw);
}
function pick(e: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  const u = (e.clientX - rect.left) / rect.width;
  const v = (e.clientY - rect.top) / rect.height;
  props.patch.dragSource(u, v);
}
function down(e: PointerEvent) {
  if (!props.doc.asset) return;
  props.patch.setMode("source");
  props.patch.beginSource();
  pick(e);
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
}
function move(e: PointerEvent) {
  if (props.patch.ctl.interacting) pick(e);
}
function up() {
  props.patch.endSource();
}
watch(
  () => [
    props.doc.asset?.thumbnail,
    JSON.stringify(props.doc.patches),
    props.target.id,
  ],
  () => {
    const url = props.doc.asset?.thumbnail;
    if (url && (!thumb || thumb.dataset.url !== url)) {
      const img = new Image();
      img.dataset.url = url;
      img.onload = schedule;
      img.src = url;
      thumb = img;
    }
    schedule();
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(() => cancelAnimationFrame(frame));
</script>
<template>
  <canvas
    ref="canvas"
    class="source-map"
    :width="W"
    :height="H"
    aria-label="在全景原图上选择取样区域"
    @pointerdown="down"
    @pointermove="move"
    @pointerup="up"
    @pointercancel="up"
  />
</template>
<style scoped>
.source-map {
  display: block;
  width: 100%;
  border-radius: 6px;
  border: 1px solid var(--line);
  cursor: crosshair;
  touch-action: none;
}
</style>
