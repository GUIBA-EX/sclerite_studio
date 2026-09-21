export const PAGE = { width: 1200, height: 900 } as const;
export type PlateBackground = "white" | "black";
export type PlateSettings = {
  sizeMode: "auto" | "pixels";
  groupBySource: boolean;
  showScaleBars: boolean;
  showSourceNotes?: boolean;
};
export const DEFAULT_PLATE_SETTINGS: PlateSettings = {
  sizeMode: "auto",
  groupBySource: true,
  showScaleBars: true,
  showSourceNotes: true,
};
export type PlateItem = {
  key: string;
  image: string;
  sourceName: string;
  sourceId: string;
  instanceId: number;
  sourceWidth: number;
  sourceHeight: number;
  umPerPixel?: number;
  reviewHint: string;
  sourceRevision?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  longAxisAngle?: number;
  axisStrength?: number;
  label: string;
  page?: number;
  sourceLabel?: string;
};
export type Plate = {
  schema: "sclerite-plate/1";
  width: 1200;
  height: 900;
  items: PlateItem[];
  background?: PlateBackground;
  settings?: PlateSettings;
};
// 二阶中心矩求mask主轴；不使用灰度，避免内部亮点改变方向。
export function maskAxis(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
) {
  let n = 0,
    sx = 0,
    sy = 0,
    xx = 0,
    yy = 0,
    xy = 0;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (rgba[(y * width + x) * 4 + 3] < 128) continue;
      n++;
      sx += x;
      sy += y;
      xx += x * x;
      yy += y * y;
      xy += x * y;
    }
  if (n < 3) return { longAxisAngle: 0, axisStrength: 0 };
  const a = xx / n - (sx / n) ** 2,
    b = xy / n - (sx / n) * (sy / n),
    c = yy / n - (sy / n) ** 2;
  return {
    longAxisAngle: (Math.atan2(2 * b, a - c) * 90) / Math.PI,
    axisStrength:
      a + c > 0 ? Math.min(1, Math.hypot(a - c, 2 * b) / (a + c)) : 0,
  };
}
export function normalizeAngle(angle: number) {
  return ((((angle + 180) % 360) + 360) % 360) - 180;
}
export function uprightItem(item: PlateItem): PlateItem {
  // 近圆形/近等轴对象不强行赋予稳定方向；无法判断生物学头尾。
  if (item.longAxisAngle === undefined || (item.axisStrength ?? 0) < 0.12)
    return item;
  let angle = 90 - item.longAxisAngle;
  if (angle > 90) angle -= 180;
  return { ...item, angle: normalizeAngle(angle) };
}
export function rotatedSize(
  item: Pick<PlateItem, "width" | "height" | "angle">,
) {
  const a = (item.angle * Math.PI) / 180,
    c = Math.abs(Math.cos(a)),
    s = Math.abs(Math.sin(a));
  return {
    width: c * item.width + s * item.height,
    height: s * item.width + c * item.height,
  };
}
// 图像旋转、标签始终水平。只变显示变换，不修改原始像素或测量。
export function constrainItem(item: PlateItem): PlateItem {
  const box = rotatedSize(item),
    scale = Math.min(
      1,
      (PAGE.width - 48) / box.width,
      (PAGE.height - 188) / box.height,
    );
  const ex = (box.width * scale) / 2,
    ey = (box.height * scale) / 2;
  return {
    ...item,
    width: item.width * scale,
    height: item.height * scale,
    x: Math.max(ex + 20, Math.min(PAGE.width - ex - 20, item.x)),
    y: Math.max(ey + 20, Math.min(PAGE.height - ey - 156, item.y)),
  };
}
export function arrange(items: PlateItem[]): PlateItem[] {
  const columns = Math.max(
    1,
    Math.min(
      items.length,
      Math.ceil(Math.sqrt((items.length * PAGE.width) / PAGE.height)),
    ),
  );
  const rows = Math.max(1, Math.ceil(items.length / columns));
  const cw = (PAGE.width - 64) / columns,
    ch = (PAGE.height - 64) / rows;
  return items.map((item, i) => {
    const footprint = rotatedSize({
      width: item.sourceWidth,
      height: item.sourceHeight,
      angle: item.angle,
    });
    const scale = Math.min(
      (cw - 32) / footprint.width,
      (ch - 58) / footprint.height,
    );
    return constrainItem({
      ...item,
      x:
        (PAGE.width -
          Math.min(columns, items.length - Math.floor(i / columns) * columns) *
            cw) /
          2 +
        cw * ((i % columns) + 0.5),
      y: 32 + ch * (Math.floor(i / columns) + 0.5) - 8,
      width: item.sourceWidth * scale,
      height: item.sourceHeight * scale,
      angle: item.angle,
    });
  });
}
// 统一倍率只接受已校准裁剪，以最小格子容纳比例为共同 px/μm。
export function arrangeUniform(items: PlateItem[]): PlateItem[] {
  if (!items.length || items.some((i) => !i.umPerPixel || i.umPerPixel <= 0))
    throw new Error("统一倍率需要所有对象先完成尺度校准。");
  const grid = arrange(items);
  const scale = Math.min(
    ...grid.map((i) => i.width / (i.sourceWidth * i.umPerPixel!)),
  );
  return grid.map((i) => ({
    ...i,
    width: i.sourceWidth * i.umPerPixel! * scale,
    height: i.sourceHeight * i.umPerPixel! * scale,
  }));
}
export function isUniform(items: PlateItem[]): boolean {
  if (!items.length || items.some((i) => !i.umPerPixel)) return false;
  const scale = items[0].width / (items[0].sourceWidth * items[0].umPerPixel!);
  return items.every(
    (i) =>
      Math.abs(i.width / (i.sourceWidth * i.umPerPixel!) - scale) < 1e-6 &&
      Math.abs(i.height / i.width - i.sourceHeight / i.sourceWidth) < 1e-6,
  );
}
export function moveItems(
  items: PlateItem[],
  keys: string[],
  dx: number,
  dy: number,
): PlateItem[] {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return items;
  const selected = items.filter((i) => keys.includes(i.key));
  if (!selected.length) return items;
  // 全组选取共同可移动距离，避免撞到页边时对象间距改变。
  const trials = selected.map((i) =>
    constrainItem({ ...i, x: i.x + dx, y: i.y + dy }),
  );
  const mx =
    dx >= 0
      ? Math.min(...trials.map((i, n) => i.x - selected[n].x))
      : Math.max(...trials.map((i, n) => i.x - selected[n].x));
  const my =
    dy >= 0
      ? Math.min(...trials.map((i, n) => i.y - selected[n].y))
      : Math.max(...trials.map((i, n) => i.y - selected[n].y));
  return items.map((i) =>
    keys.includes(i.key) ? { ...i, x: i.x + mx, y: i.y + my } : i,
  );
}
export function alignItems(
  items: PlateItem[],
  keys: string[],
  mode: "align" | "distribute",
): PlateItem[] {
  const selected = items
    .filter((i) => keys.includes(i.key))
    .sort((a, b) => a.x - b.x);
  if (selected.length < 2) return items;
  const y = selected.reduce((n, i) => n + i.y, 0) / selected.length;
  const changes = new Map(
    selected.map((i, n) => [
      i.key,
      constrainItem({
        ...i,
        ...(mode === "align"
          ? { y }
          : {
              x:
                selected[0].x +
                (n * (selected.at(-1)!.x - selected[0].x)) /
                  (selected.length - 1),
            }),
      }),
    ]),
  );
  return items.map((i) => changes.get(i.key) ?? i);
}
export function parsePlate(value: unknown): Plate {
  const p = value as Plate;
  if (
    !p ||
    p.schema !== "sclerite-plate/1" ||
    p.width !== 1200 ||
    p.height !== 900 ||
    !Array.isArray(p.items) ||
    p.items.length > 200 ||
    (p.background !== undefined &&
      p.background !== "white" &&
      p.background !== "black")
  )
    throw new Error("无效的版面文件");
  const keys = new Set<string>();
  for (const i of p.items) {
    if (
      !i ||
      typeof i.key !== "string" ||
      keys.has(i.key) ||
      typeof i.image !== "string" ||
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(i.image) ||
      i.image.length > 16_000_000 ||
      typeof i.label !== "string" ||
      i.label.length > 100 ||
      typeof i.sourceName !== "string" ||
      typeof i.sourceId !== "string" ||
      typeof i.reviewHint !== "string" ||
      !Number.isInteger(i.instanceId) ||
      ![
        "sourceWidth",
        "sourceHeight",
        "x",
        "y",
        "width",
        "height",
        "angle",
      ].every((k) => Number.isFinite(i[k as keyof PlateItem])) ||
      i.sourceWidth < 1 ||
      i.sourceHeight < 1 ||
      i.sourceWidth > 12000 ||
      i.sourceHeight > 12000 ||
      i.width < 1 ||
      i.height < 1 ||
      i.width > 5000 ||
      i.height > 5000 ||
      Math.abs(i.angle) > 360 ||
      (i.page !== undefined &&
        (!Number.isInteger(i.page) || i.page < 1 || i.page > 200)) ||
      (i.sourceLabel !== undefined &&
        (typeof i.sourceLabel !== "string" || i.sourceLabel.length > 20)) ||
      (i.longAxisAngle !== undefined &&
        (!Number.isFinite(i.longAxisAngle) ||
          Math.abs(i.longAxisAngle) > 90)) ||
      (i.axisStrength !== undefined &&
        (!Number.isFinite(i.axisStrength) ||
          i.axisStrength < 0 ||
          i.axisStrength > 1)) ||
      (i.umPerPixel !== undefined &&
        (!Number.isFinite(i.umPerPixel) || i.umPerPixel <= 0))
    )
      throw new Error("版面对象无效");
    keys.add(i.key);
  }
  if (
    p.settings &&
    (!["auto", "pixels"].includes(p.settings.sizeMode) ||
      typeof p.settings.groupBySource !== "boolean" ||
      typeof p.settings.showScaleBars !== "boolean" ||
      (p.settings.showSourceNotes !== undefined &&
        typeof p.settings.showSourceNotes !== "boolean"))
  )
    throw new Error("版面设置无效");
  return {
    ...p,
    background: p.background ?? "white",
    settings: { ...DEFAULT_PLATE_SETTINGS, ...p.settings },
    items: p.items.map(constrainItem),
  };
}
