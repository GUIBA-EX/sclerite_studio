import { tr } from "./i18n";
import { useEffect, useRef } from "react";
import type { ImageEntry } from "./types";
import { COLORS } from "./types";

export default function ObjectPreview({
  entry,
  ids,
  thumbnail = false,
  overlay = false,
}: {
  entry: ImageEntry;
  ids: number[];
  thumbnail?: boolean;
  overlay?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const key = ids.join(",");
  useEffect(() => {
    const a = entry.analysis,
      c = ref.current;
    if (!a || !c) return;
    const objects = a.objects.filter((o) => ids.includes(o.id));
    if (!objects.length) return;
    const x = Math.max(0, Math.min(...objects.map((o) => o.bbox[0])) - 12);
    const y = Math.max(0, Math.min(...objects.map((o) => o.bbox[1])) - 12);
    const w =
      Math.min(
        entry.width,
        Math.max(...objects.map((o) => o.bbox[0] + o.bbox[2])) + 12,
      ) - x;
    const h =
      Math.min(
        entry.height,
        Math.max(...objects.map((o) => o.bbox[1] + o.bbox[3])) + 12,
      ) - y;
    const scale = Math.min(1, (thumbnail ? 64 : 500) / Math.max(w, h));
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    const ctx = c.getContext("2d")!,
      image = ctx.createImageData(c.width, c.height);
    for (let yy = 0; yy < c.height; yy++)
      for (let xx = 0; xx < c.width; xx++) {
        const sx = Math.min(entry.width - 1, x + Math.floor(xx / scale)),
          sy = Math.min(entry.height - 1, y + Math.floor(yy / scale));
        const p = sy * entry.width + sx,
          d = (yy * c.width + xx) * 4,
          id = a.labels[p];
        for (let ch = 0; ch < 3; ch++)
          image.data[d + ch] = entry.data[p * 4 + ch];
        image.data[d + 3] = 255;
        if (overlay && ids.includes(id)) {
          const color = COLORS[(id - 1) % COLORS.length];
          const edge = [p - 1, p + 1, p - entry.width, p + entry.width].some(
            (n) => a.labels[n] !== id,
          );
          for (let ch = 0; ch < 3; ch++)
            image.data[d + ch] = edge
              ? 255
              : image.data[d + ch] * 0.7 +
                parseInt(color.slice(1 + ch * 2, 3 + ch * 2), 16) * 0.3;
        }
      }
    ctx.putImageData(image, 0, 0);
  }, [entry, key, thumbnail, overlay]);
  return (
    <canvas
      ref={ref}
      className={thumbnail ? "object-thumbnail" : "object-preview"}
      aria-label={overlay ? tr("切分边界预览") : tr("骨针原图预览")}
    />
  );
}
