import { watch, onBeforeUnmount, type Ref, ref } from "vue";
import type { StudioDocument } from "../../../shared/types";
import { renderPreview } from "../../projection";
import type { PatchController } from "../../patch";
export function usePreview(
  doc: StudioDocument,
  canvas: Ref<HTMLCanvasElement | undefined>,
  patch?: PatchController,
) {
  const rendering = ref(false);
  let frame = 0;
  watch(
    () => [
      canvas.value,
      doc.asset,
      JSON.stringify(doc.projection),
      JSON.stringify(doc.edge),
      JSON.stringify(doc.patches),
      patch?.ctl.interacting,
      patch?.ctl.draftQuality,
    ],
    () => {
      cancelAnimationFrame(frame);
      rendering.value = true;
      frame = requestAnimationFrame(() => {
        if (canvas.value && doc.asset)
          renderPreview(
            canvas.value,
            {
              asset: doc.asset,
              projection: { ...doc.projection },
              edge: { ...doc.edge },
              patches: doc.patches,
              // 交互拖动中允许草稿精度：图章降采样，控制重复采样成本
              draft: !!(
                patch &&
                patch.ctl.draftQuality &&
                patch.ctl.interacting
              ),
            },
            600,
          );
        rendering.value = false;
      });
    },
    { immediate: true, flush: "post" },
  );
  onBeforeUnmount(() => cancelAnimationFrame(frame));
  return { rendering };
}
