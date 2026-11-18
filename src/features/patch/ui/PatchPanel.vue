<script setup lang="ts">
import { computed } from "vue";
import {
  Stamp,
  Plus,
  Pencil,
  Trash2,
  ChevronUp,
  ChevronDown,
  Layers,
  Undo2,
} from "lucide-vue-next";
import type { StudioDocument } from "../../../shared/types";
import { degrees, wrapPi } from "../../../shared/math";
import { distance } from "../lib/sphere";
import type { PatchController } from "../model/usePatches";
import SourceMap from "./SourceMap.vue";

const props = defineProps<{ doc: StudioDocument; patch: PatchController }>();
const { patch } = props;

const sorted = computed(() =>
  [...props.doc.patches].sort((a, b) => b.z - a.z),
);
const active = computed(() => patch.active());
const offset = computed(() => {
  const p = active.value;
  if (!p || !p.strokes.length) return null;
  return {
    east: degrees(wrapPi(p.source.lon - p.anchor.lon) * Math.cos(p.anchor.lat)),
    north: degrees(p.source.lat - p.anchor.lat),
    total: degrees(distance(p.anchor, p.source)),
  };
});
const canBake = computed(
  () =>
    !!props.doc.asset &&
    props.doc.patches.some((p) => p.enabled && p.strokes.length > 0),
);
function newPatch() {
  patch.createPatch();
  patch.setMode("paint");
}
</script>
<template>
  <section class="panel patch-panel">
    <div class="section-label"><span>03 / 局部修补</span><Stamp :size="15" /></div>
    <p v-if="!doc.asset" class="mini">导入全景素材后，可以在星球上圈出路人等杂物，用全景自身的干净区域盖掉。</p>
    <template v-else>
      <button class="text-button new-patch" @click="newPatch">
        <Plus :size="14" /> 新建修补补丁
      </button>
      <label class="control"
        >笔刷半径 <output>{{ degrees(patch.ctl.brushRadius).toFixed(1) }}°</output
        ><input
          aria-label="笔刷半径"
          type="range"
          min="0.3"
          max="8"
          step="0.1"
          :value="degrees(patch.ctl.brushRadius)"
          @input="patch.ctl.brushRadius = ($event.target as HTMLInputElement).valueAsNumber * Math.PI / 180"
      /></label>
      <p v-if="!doc.patches.length" class="mini">
        在星球视口切换到「涂抹」，涂出要遮盖的区域；随后在小地图上点选一块干净区域作为取样源。
      </p>
      <ul v-if="doc.patches.length" class="patch-list">
        <li
          v-for="p in sorted"
          :key="p.id"
          :class="{ active: p.id === patch.ctl.activeId, off: !p.enabled }"
          @click="patch.select(p.id)"
        >
          <label class="check" @click.stop>
            <input
              type="checkbox"
              :checked="p.enabled"
              :aria-label="`启用${p.name}`"
              @change="patch.toggle(p.id)"
            />
          </label>
          <span class="patch-name">{{ p.name }}</span>
          <span class="patch-actions">
            <button aria-label="上移一层" :disabled="p.z === doc.patches.length - 1" @click.stop="patch.move(p.id, 1)"><ChevronUp :size="13" /></button>
            <button aria-label="下移一层" :disabled="p.z === 0" @click.stop="patch.move(p.id, -1)"><ChevronDown :size="13" /></button>
            <button aria-label="重新编辑" title="重新编辑" @click.stop="patch.select(p.id, 'paint')"><Pencil :size="12" /></button>
            <button aria-label="删除补丁" @click.stop="patch.remove(p.id)"><Trash2 :size="12" /></button>
          </span>
        </li>
      </ul>
      <template v-if="active">
        <label class="control"
          >软边宽度 <output>{{ degrees(active.feather).toFixed(1) }}°</output
          ><input
            aria-label="软边宽度"
            type="range"
            min="0"
            max="8"
            step="0.1"
            :value="degrees(active.feather)"
            @input="patch.setFeather(active.id, ($event.target as HTMLInputElement).valueAsNumber)"
        /></label>
        <div class="source-block">
          <span class="field-label">取样源（在同一张全景上点选）</span>
          <SourceMap :doc="doc" :patch="patch" :target="active" />
          <p v-if="offset" class="mini">
            位移：东 {{ offset.east.toFixed(1) }}° · 北 {{ offset.north.toFixed(1) }}° · 相距 {{ offset.total.toFixed(1) }}°
          </p>
        </div>
      </template>
      <label class="check draft-check">
        <input type="checkbox" v-model="patch.ctl.draftQuality" />
        拖动时降低修补精度（更流畅）
      </label>
      <div class="bake-block">
        <button class="text-button" :disabled="!canBake" @click="patch.bake()">
          <Layers :size="13" /> 烘焙为独立素材
        </button>
        <button v-if="patch.ctl.history.length" class="text-button" @click="patch.restore()">
          <Undo2 :size="13" /> 恢复烘焙前素材（{{ patch.ctl.history.length }}）
        </button>
        <p class="mini">
          补丁独立保存，原图永不修改；烘焙会生成一张新素材，原素材可随时恢复。
        </p>
      </div>
    </template>
  </section>
</template>
<style scoped>
.new-patch {
  font-weight: 600;
}
.patch-list {
  list-style: none;
  margin: 12px 0 4px;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.patch-list li {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 7px 9px;
  cursor: pointer;
  font-size: 10px;
  color: #5c6a5e;
}
.patch-list li.active {
  border-color: #b9cfbc;
  background: #f4f9f3;
}
.patch-list li.off .patch-name {
  opacity: 0.45;
  text-decoration: line-through;
}
.patch-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.patch-actions {
  display: flex;
  gap: 2px;
}
.patch-actions button {
  color: #7d8a7d;
  padding: 3px;
  border-radius: 4px;
  display: flex;
}
.patch-actions button:hover {
  background: #eef3ec;
  color: #4a7756;
}
.patch-actions button:disabled {
  opacity: 0.3;
}
.source-block {
  margin: 14px 0 4px;
}
.source-block .field-label {
  display: block;
  margin-bottom: 7px;
}
.draft-check {
  margin-top: 14px;
}
.bake-block {
  margin-top: 10px;
  border-top: 1px solid var(--line);
  padding-top: 6px;
}
.bake-block .mini {
  margin-top: 6px;
}
</style>
