<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import {
  Move,
  Maximize,
  MousePointer2,
  Plus,
  Minus,
  ScanLine,
  Brush,
  Crosshair,
} from "lucide-vue-next";
import type { StudioDocument, Projection, SpherePoint } from "../../../shared/types";
import { usePreview } from "../model/usePreview";
import { dragView, wheelZoom } from "../lib/gestures";
import { projectPoint } from "../../projection";
import { drawOverlay, uvToSphere, type PatchController } from "../../patch";
const { doc, patch } = defineProps<{
  doc: StudioDocument;
  patch: PatchController;
}>();
const canvas = ref<HTMLCanvasElement>();
const overlay = ref<HTMLCanvasElement>();
const { rendering } = usePreview(doc, canvas, patch);
const guides = ref(false);
const hover = ref<SpherePoint | null>(null);
let start: { x: number; y: number; p: Projection } | null = null;
function uvOf(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  const size = canvas.value?.width || 600;
  const x = ((e.clientX - rect.left) / rect.width) * size;
  const y = ((e.clientY - rect.top) / rect.height) * size;
  return projectPoint(x + 0.5, y + 0.5, size, size, doc.projection);
}
function down(e: PointerEvent) {
  if (e.button !== 0) return;
  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  if (patch.ctl.mode === "paint") {
    const { u, v } = uvOf(e);
    patch.beginStroke(u, v);
    hover.value = uvToSphere(u, v);
  } else if (patch.ctl.mode === "source") {
    const { u, v } = uvOf(e);
    patch.beginSource();
    patch.dragSource(u, v);
  } else {
    start = { x: e.clientX, y: e.clientY, p: { ...doc.projection } };
  }
}
function move(e: PointerEvent) {
  if (patch.ctl.mode === "paint") {
    const { u, v } = uvOf(e);
    hover.value = uvToSphere(u, v);
    if (patch.ctl.interacting) patch.extendStroke(u, v);
    return;
  }
  if (patch.ctl.mode === "source") {
    if (patch.ctl.interacting) {
      const { u, v } = uvOf(e);
      patch.dragSource(u, v);
    }
    return;
  }
  if (!start) return;
  Object.assign(
    doc.projection,
    dragView(
      start.p,
      e.clientX - start.x,
      e.clientY - start.y,
      (e.currentTarget as HTMLElement).clientWidth,
    ),
  );
}
function up() {
  patch.endStroke();
  patch.endSource();
  start = null;
}
function wheel(e: WheelEvent) {
  doc.projection.zoom = wheelZoom(doc.projection.zoom, e.deltaY);
}
// 覆盖层：把球面笔触/锚点按当前投影画回屏幕，旋转或改尺寸后仍贴着景物
let frame = 0;
watch(
  () => [
    canvas.value,
    JSON.stringify(doc.projection),
    JSON.stringify(doc.patches),
    patch.ctl.mode,
    patch.ctl.activeId,
    patch.ctl.brushRadius,
    hover.value,
    rendering.value,
  ],
  () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const o = overlay.value,
        c = canvas.value;
      if (!o || !c) return;
      o.width = c.width;
      o.height = c.height;
      drawOverlay(o, { ...doc.projection }, {
        patches: doc.patches,
        activeId: patch.ctl.activeId,
        mode: patch.ctl.mode,
        brushRadius: patch.ctl.brushRadius,
        hover: hover.value,
      });
    });
  },
  { immediate: true, flush: "post" },
);
onBeforeUnmount(() => cancelAnimationFrame(frame));
const modes = [
  { key: "view", label: "浏览", icon: Move },
  { key: "paint", label: "涂抹", icon: Brush },
  { key: "source", label: "取样", icon: Crosshair },
] as const;
</script>
<template>
  <main class="viewport">
    <div class="viewport-heading">
      <div>
        <span class="eyebrow">LIVE CANVAS</span>
        <h1>换个视角，世界很小。</h1>
      </div>
      <span class="live"><i />{{ rendering ? "正在渲染" : "实时预览" }}</span>
    </div>
    <div class="canvas-area">
      <span class="corner-label"
        >{{
          doc.projection.mode === "planet" ? "LITTLE PLANET" : "INFINITE TUNNEL"
        }}
        / 01</span
      >
      <div
        class="canvas-wrap"
        :class="[{ guides }, `mode-${patch.ctl.mode}`]"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up"
        @pointercancel="up"
        @lostpointercapture="up"
        @pointerleave="hover = null"
        @wheel.prevent="wheel"
      >
        <canvas ref="canvas" aria-label="小行星实时投影画布" />
        <canvas ref="overlay" class="overlay" aria-hidden="true" />
        <div v-if="!doc.asset" class="empty">导入一张照片，开启你的星球</div>
        <div v-if="guides" class="crosshair" />
      </div>
      <div class="canvas-caption">
        <span>STEREOGRAPHIC PROJECTION</span
        ><span v-if="patch.ctl.mode === 'paint'" class="mode-hint"
          >涂抹模式：在星球上涂出要遮盖的区域</span
        ><span v-else-if="patch.ctl.mode === 'source'" class="mode-hint"
          >取样模式：点击画面放置取样源</span
        ><span v-else>600 × 600 · 预览</span>
      </div>
    </div>
    <div class="viewport-toolbar">
      <div class="segmented small mode-switch" v-if="doc.asset">
        <button
          v-for="m in modes"
          :key="m.key"
          :class="{ active: patch.ctl.mode === m.key }"
          @click="patch.setMode(m.key)"
        >
          <component :is="m.icon" :size="12" /> {{ m.label }}
        </button>
      </div>
      <div class="gesture-hint" v-if="patch.ctl.mode === 'view'">
        <MousePointer2 :size="14" /> 拖动旋转 <span>·</span
        ><Move :size="14" /> 滚轮缩放
      </div>
      <div class="tool-buttons">
        <button
          aria-label="缩小"
          @click="doc.projection.zoom = wheelZoom(doc.projection.zoom, 100)"
        >
          <Minus :size="16" /></button
        ><span>{{ Math.round(doc.projection.zoom * 100) }}%</span
        ><button
          aria-label="放大"
          @click="doc.projection.zoom = wheelZoom(doc.projection.zoom, -100)"
        >
          <Plus :size="16" /></button
        ><b /><button
          aria-label="切换辅助线"
          :class="{ selected: guides }"
          @click="guides = !guides"
        >
          <ScanLine :size="17" /></button
        ><button aria-label="重置缩放" @click="doc.projection.zoom = 1">
          <Maximize :size="16" />
        </button>
      </div>
    </div>
    <div class="inspiration">
      <span class="spark">✳</span>
      <div>
        <strong>每一片风景，都有另一个宇宙。</strong
        ><span>试试切换隧道模式，或轻轻拖动星球，寻找意想不到的构图。</span>
      </div>
      <span class="inspiration-number">017</span>
    </div>
  </main>
</template>
<style scoped>
.canvas-wrap {
  position: relative;
}
.canvas-wrap .overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.canvas-wrap.mode-paint,
.canvas-wrap.mode-source {
  cursor: crosshair;
}
.mode-switch {
  margin-bottom: 0;
  flex: none;
}
.mode-switch button {
  display: flex;
  align-items: center;
  gap: 4px;
  justify-content: center;
  padding: 7px 10px;
}
.mode-hint {
  color: #8a6a3f;
}
</style>
