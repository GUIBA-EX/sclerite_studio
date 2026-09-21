import { PAGE, rotatedSize } from "./plate";
import type { PlateItem, PlateSettings } from "./plate";
const LEFT = 32,
  RIGHT = 1168,
  TOP = 32,
  BOTTOM = 744,
  GAP = 22,
  CAPTION = 56;
export function sourceLetter(index: number): string {
  let value = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    value = String.fromCharCode(65 + ((n - 1) % 26)) + value;
  return value;
}
const calibrated = (i: PlateItem) =>
  Number.isFinite(i.umPerPixel) && i.umPerPixel! > 0;
type Rect = { x: number; y: number; w: number; h: number };
function compactPack(
  items: PlateItem[],
  startPage: number,
): { items: PlateItem[]; lastPage: number } {
  const sheets: Rect[][] = [];
  const result: PlateItem[] = [];
  const sorted = [...items].sort((a, b) => {
    const aa = rotatedSize(a),
      bb = rotatedSize(b);
    return (
      Math.max(bb.width, bb.height) - Math.max(aa.width, aa.height) ||
      b.sourceWidth * b.sourceHeight - a.sourceWidth * a.sourceHeight
    );
  });
  for (const item of sorted) {
    const box = rotatedSize(item),
      w = Math.max(80, box.width),
      h = box.height + CAPTION;
    let choice: { sheet: number; rect: Rect; score: number } | undefined;
    for (let p = 0; p < sheets.length; p++)
      for (const r of sheets[p])
        if (w <= r.w + 1e-8 && h <= r.h + 1e-8) {
          const score =
            Math.min(r.w - w, r.h - h) + Math.max(r.w - w, r.h - h) * 0.001;
          if (!choice || score < choice.score)
            choice = { sheet: p, rect: r, score };
        }
    if (!choice) {
      const rect = { x: LEFT, y: TOP, w: RIGHT - LEFT, h: BOTTOM - TOP };
      sheets.push([rect]);
      choice = { sheet: sheets.length - 1, rect, score: 0 };
    }
    const { sheet, rect } = choice,
      used = { x: rect.x, y: rect.y, w: w + GAP, h: h + GAP };
    const free: Rect[] = [];
    for (const r of sheets[sheet]) {
      if (
        used.x >= r.x + r.w ||
        used.x + used.w <= r.x ||
        used.y >= r.y + r.h ||
        used.y + used.h <= r.y
      ) {
        free.push(r);
        continue;
      }
      if (used.x > r.x) free.push({ ...r, w: used.x - r.x });
      if (used.x + used.w < r.x + r.w)
        free.push({ ...r, x: used.x + used.w, w: r.x + r.w - used.x - used.w });
      if (used.y > r.y) free.push({ ...r, h: used.y - r.y });
      if (used.y + used.h < r.y + r.h)
        free.push({ ...r, y: used.y + used.h, h: r.y + r.h - used.y - used.h });
    }
    sheets[sheet] = free.filter(
      (r, n) =>
        r.w > 0 &&
        r.h > 0 &&
        !free.some(
          (s, m) =>
            m !== n &&
            r.x >= s.x &&
            r.y >= s.y &&
            r.x + r.w <= s.x + s.w &&
            r.y + r.h <= s.y + s.h &&
            (r.w * r.h < s.w * s.h || m < n),
        ),
    );
    result.push({
      ...item,
      x: rect.x + w / 2,
      y: rect.y + box.height / 2,
      page: startPage + sheet,
    });
  }
  return { items: result, lastPage: startPage + sheets.length - 1 };
}
// 原像素以2倍PNG导出时1:1；按物理尺度排版时以首张校准照片为参考。
// 仅特大对象触发整组共同缩小，绝不逐枚适配格子；容量不足时分页。
export function layoutOriginal(
  items: PlateItem[],
  settings: PlateSettings,
): PlateItem[] {
  const sources = [...new Set(items.map((i) => i.sourceId))];
  const pools =
    settings.sizeMode === "pixels"
      ? [items]
      : [items.filter(calibrated), items.filter((i) => !calibrated(i))];
  let page = 0;
  const result: PlateItem[] = [];
  for (const pool of pools) {
    if (!pool.length) continue;
    const physical = settings.sizeMode === "auto" && pool.every(calibrated);
    const unit = (i: PlateItem) => (physical ? i.umPerPixel! : 1);
    let scale = physical ? 0.5 / pool[0].umPerPixel! : 0.5;
    for (const i of pool) {
      const box = rotatedSize({
        width: i.sourceWidth * unit(i),
        height: i.sourceHeight * unit(i),
        angle: i.angle,
      });
      scale = Math.min(
        scale,
        (RIGHT - LEFT) / box.width,
        (BOTTOM - TOP - CAPTION) / box.height,
      );
    }
    const sized = pool.map((i) => ({
      ...i,
      width: i.sourceWidth * unit(i) * scale,
      height: i.sourceHeight * unit(i) * scale,
      sourceLabel: i.sourceLabel ?? sourceLetter(sources.indexOf(i.sourceId)),
    }));
    if (sized.some((i) => i.width < 1 || i.height < 1))
      throw new Error(
        "尺寸差异过大，部分对象不足1版面像素；请按尺寸分批排版。",
      );
    if (!settings.groupBySource) {
      const packed = compactPack(sized, page + 1);
      result.push(...packed.items);
      page = packed.lastPage;
      continue;
    }
    const blocks = settings.groupBySource
      ? [...new Set(sized.map((i) => i.sourceId))].map((id) =>
          sized.filter((i) => i.sourceId === id),
        )
      : [sized];
    page++;
    let x = LEFT,
      y = TOP,
      rowHeight = 0;
    for (const block of blocks) {
      if (x !== LEFT) {
        y += rowHeight + GAP;
        x = LEFT;
        rowHeight = 0;
      }
      const sorted = [...block].sort(
        (a, b) =>
          rotatedSize(b).height - rotatedSize(a).height ||
          a.instanceId - b.instanceId,
      );
      for (const i of sorted) {
        const box = rotatedSize(i),
          w = Math.max(80, box.width),
          h = box.height + CAPTION;
        if (x + w > RIGHT + 1e-8) {
          y += rowHeight + GAP;
          x = LEFT;
          rowHeight = 0;
        }
        if (y + h > BOTTOM + 1e-8) {
          page++;
          x = LEFT;
          y = TOP;
          rowHeight = 0;
        }
        result.push({ ...i, x: x + w / 2, y: y + box.height / 2, page });
        x += w + GAP;
        rowHeight = Math.max(rowHeight, h);
      }
    }
  }
  const byKey = new Map(result.map((i) => [i.key, i]));
  return items.map((i) => byKey.get(i.key)!);
}
export type ScaleBar = {
  x: number;
  y: number;
  length: number;
  label: string;
  key: string;
};
function scaleOf(i: PlateItem, physical: boolean) {
  return i.width / (i.sourceWidth * (physical ? i.umPerPixel! : 1));
}
function sameScale(items: PlateItem[], physical: boolean) {
  if (!items.length) return false;
  const first = scaleOf(items[0], physical);
  return items.every(
    (i) =>
      Math.abs(scaleOf(i, physical) - first) <= first * 1e-6 &&
      Math.abs(i.width / i.height - i.sourceWidth / i.sourceHeight) < 1e-6,
  );
}
function bar(
  i: PlateItem,
  target: number,
  x: number,
  y: number,
  physical: boolean,
  key: string,
): ScaleBar {
  const scale = scaleOf(i, physical),
    raw = target / scale,
    power = 10 ** Math.floor(Math.log10(raw));
  const value =
    [5, 2, 1].map((n) => n * power).find((n) => n <= raw) ?? power / 2;
  return {
    x,
    y,
    length: value * scale,
    label: `${Number(value.toPrecision(6))} ${physical ? "μm" : "px"}`,
    key,
  };
}
export function pageScales(
  items: PlateItem[],
  show = true,
): { bars: ScaleBar[]; description: string } {
  if (!items.length) return { bars: [], description: "空版面" };
  const physical = items.every(calibrated),
    pixels = items.every((i) => !calibrated(i));
  if ((physical || pixels) && sameScale(items, physical)) {
    const b = bar(items[0], 150, 0, PAGE.height - 28, physical, "page");
    b.x = PAGE.width - 40 - b.length;
    return {
      bars: show ? [b] : [],
      description: physical
        ? "统一物理倍率 · 共用比例尺"
        : "原始像素比例 · px不是实际长度",
    };
  }
  return {
    bars: show
      ? items.map((i) => {
          const b = bar(
            i,
            Math.min(110, Math.max(50, rotatedSize(i).width * 0.65)),
            0,
            i.y + rotatedSize(i).height / 2 + 38,
            calibrated(i),
            i.key,
          );
          b.x = i.x - b.length / 2;
          return b;
        })
      : [],
    description: "非统一倍率 · 每枚独立比例尺（未校准使用px）",
  };
}
export function pageSources(items: PlateItem[]): string {
  const source = [
    ...new Map(
      items.map((i) => [
        i.sourceId,
        `${i.sourceLabel ?? "?"}: ${i.sourceName}`,
      ]),
    ).values(),
  ].join("  ·  ");
  return source.length > 132 ? source.slice(0, 129) + "…" : source;
}
