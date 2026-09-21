import JSZip from "jszip";
import UTIF from "utif";
import { DEFAULTS } from "./types";
import type { ImageEntry, Calibration, Parameters } from "./types";
import { measureLabels } from "./engine";
import { confirmedEntry } from "./review";
import { parsePlate, DEFAULT_PLATE_SETTINGS } from "./plate";
import type { PlateItem, PlateBackground, PlateSettings } from "./plate";
import { parseStudy } from "./species";
import { parseClassification } from "./classification";

export const MAX_PIXELS = 12_000_000;
const canvasBlob = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("无法编码图像"))),
      "image/png",
    ),
  );
export function imageCanvas(entry: ImageEntry) {
  const c = document.createElement("canvas");
  c.width = entry.width;
  c.height = entry.height;
  c.getContext("2d")!.putImageData(
    new ImageData(new Uint8ClampedArray(entry.data), entry.width, entry.height),
    0,
    0,
  );
  return c;
}
export async function loadImage(
  file: File,
  synthetic = false,
): Promise<ImageEntry> {
  if (file.size > 80_000_000)
    throw new Error("图像文件超过80 MB，请先导出较小视野。");
  let width: number, height: number, data: Uint8ClampedArray, url: string;
  if (/\.tiff?$/i.test(file.name)) {
    const buffer = await file.arrayBuffer(),
      pages = UTIF.decode(buffer);
    if (pages.length !== 1)
      throw new Error("第一版支持单页TIFF；请先将焦平面序列导出为单张合焦图。");
    const page = pages[0];
    const sourceW = page.t256?.[0],
      sourceH = page.t257?.[0];
    if (!sourceW || !sourceH || sourceW * sourceH > MAX_PIXELS)
      throw new Error("TIFF无效或超过1200万像素，请先裁剪视野。");
    UTIF.decodeImage(buffer, page);
    width = page.width;
    height = page.height;
    data = new Uint8ClampedArray(UTIF.toRGBA8(page));
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3] / 255;
      for (let j = 0; j < 3; j++)
        data[i + j] = Math.round(data[i + j] * a + 255 * (1 - a));
      data[i + 3] = 255;
    }
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    c.getContext("2d")!.putImageData(
      new ImageData(new Uint8ClampedArray(data), width, height),
      0,
      0,
    );
    url = URL.createObjectURL(await canvasBlob(c));
  } else {
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = objectUrl;
      await img.decode();
      width = img.naturalWidth;
      height = img.naturalHeight;
      if (width * height > MAX_PIXELS)
        throw new Error(
          "图像超过1200万像素，请先裁剪视野。原图不会被自动缩小。",
        );
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      data = ctx.getImageData(0, 0, width, height).data;
      url = objectUrl;
    } catch (e) {
      URL.revokeObjectURL(objectUrl);
      throw e;
    }
  }
  let sourceHash: string | undefined;
  try {
    if (globalThis.crypto?.subtle) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        await file.arrayBuffer(),
      );
      sourceHash = [...new Uint8Array(digest)]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    /* 哈希不可用时保留图像处理能力，研究审计单独提示。 */
  }
  return {
    id: crypto.randomUUID(),
    sourceHash,
    name: file.name,
    width,
    height,
    data,
    url,
    original: file,
    synthetic,
    params: { ...DEFAULTS },
    specimen: "",
    tissue: "未指定",
    notes: {},
    undo: [],
  };
}

// 可复现的合成光镜测试图，只用于界面与算法演示，不是生物学数据。
export async function makeDemo(): Promise<ImageEntry> {
  const c = document.createElement("canvas");
  c.width = 1440;
  c.height = 1000;
  const ctx = c.getContext("2d")!;
  const bg = ctx.createRadialGradient(560, 370, 0, 640, 480, 1100);
  bg.addColorStop(0, "#f9f4e6");
  bg.addColorStop(1, "#c9c2ae");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, c.width, c.height);
  let seed = 52;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const positions = [
    [205, 165, -0.4, 160, 20],
    [475, 185, 0.38, 190, 23],
    [815, 150, -0.1, 140, 21],
    [1160, 210, 0.7, 190, 20],
    [210, 445, 0.55, 170, 22],
    [557, 470, -0.65, 200, 25],
    [960, 480, 0.5, 195, 22],
    [1205, 545, -0.5, 140, 18],
    [310, 775, -0.35, 185, 27],
    [735, 790, 0.33, 170, 22],
    [1115, 820, -0.22, 205, 25],
  ];
  for (let k = 0; k < positions.length; k++) {
    const [x, y, angle, l, r] = positions[k];
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    for (let i = 0; i <= 140; i++) {
      const t = (i / 140) * 2 * Math.PI,
        xx = Math.cos(t) * l,
        yy = Math.sin(t) * r * (1 + 0.23 * Math.sin(t * 23));
      if (i === 0) ctx.moveTo(xx, yy);
      else ctx.lineTo(xx, yy);
    }
    ctx.closePath();
    const g = ctx.createLinearGradient(0, -r, 0, r);
    g.addColorStop(0, "#766447");
    g.addColorStop(0.5, k % 3 === 0 ? "#c48b64" : "#bcac88");
    g.addColorStop(1, "#77694e");
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "#736349";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 0.42;
    for (let z = 0; z < 40; z++) {
      const px = (rand() * 2 - 1) * l * 0.86,
        py = (rand() * 2 - 1) * r * 0.7;
      ctx.beginPath();
      ctx.ellipse(
        px,
        py,
        3 + rand() * 4,
        2 + rand() * 3,
        rand() * 3,
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = "#6a583d";
      ctx.fill();
    }
    ctx.restore();
  }
  // 两枚接触对象，用“切开”工具校正。
  ctx.save();
  ctx.translate(935, 480);
  ctx.rotate(-0.9);
  ctx.fillStyle = "#a28d6c";
  ctx.beginPath();
  ctx.ellipse(0, 0, 118, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = "rgba(115,99,78,.24)";
    ctx.beginPath();
    ctx.arc(rand() * 1440, rand() * 1000, rand() * 2 + 0.5, 0, 7);
    ctx.fill();
  }
  const file = new File([await canvasBlob(c)], "演示_合成光镜.png", {
      type: "image/png",
    }),
    entry = await loadImage(file, true);
  entry.specimen = "DEMO-001";
  entry.tissue = "示例组织";
  return entry;
}

export async function saveBlob(blob: Blob, filename: string) {
  if ("__TAURI_INTERNALS__" in window) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: filename });
    if (path) await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return Boolean(path);
  }
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}
function csvCell(v: unknown) {
  let text = String(v ?? "");
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function csv(entries: ImageEntry[], confirmedOnly = true): string {
  const header = [
    "image_id",
    "image_name",
    "specimen",
    "tissue",
    "instance_id",
    "morphotype_note",
    "synthetic",
    "unit",
    "area",
    "perimeter",
    "max_feret_length",
    "width_perpendicular_to_max_feret",
    "aspect_ratio",
    "circularity",
    "bbox_x_px",
    "bbox_y_px",
    "bbox_width_px",
    "bbox_height_px",
    "touches_border",
    "um_per_pixel",
    "review_status",
    "review_hint",
    "auto_split_parent",
  ];
  const rows: unknown[][] = [header];
  for (const e of confirmedOnly ? entries.map(confirmedEntry) : entries)
    for (const o of e.analysis?.objects ?? []) {
      const s = e.calibration?.umPerPixel ?? 1;
      rows.push([
        e.id,
        e.name,
        e.specimen,
        e.tissue,
        o.id,
        e.notes[o.id] ?? "",
        e.synthetic,
        e.calibration ? "um" : "px",
        o.area * s * s,
        o.perimeter * s,
        o.length * s,
        o.width * s,
        o.aspect,
        o.circularity,
        ...o.bbox,
        o.border,
        e.calibration?.umPerPixel ?? "",
        e.analysis?.approvedIds?.includes(o.id)
          ? "confirmed_complete"
          : "pending",
        e.analysis?.reviewHints?.[o.id] ?? "",
        e.analysis?.splitEvents?.find((ev) => ev.childIds.includes(o.id))
          ?.parentId ?? "",
      ]);
    }
  return "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

export async function exportProject(
  entries: ImageEntry[],
  results: boolean,
  onProgress: (s: string) => void,
  plateItems: PlateItem[] = [],
  plateBackground: PlateBackground = "white",
  plateSettings: PlateSettings = { ...DEFAULT_PLATE_SETTINGS },
) {
  if (!results)
    parsePlate({
      schema: "sclerite-plate/1",
      width: 1200,
      height: 900,
      items: plateItems,
      background: plateBackground,
      settings: plateSettings,
    });
  if (results) {
    entries = entries.map(confirmedEntry);
    if (!entries.some((e) => e.analysis?.objects.length))
      throw new Error(
        "请先在候选测量表最右侧勾选“确认完整”。未确认的对象不会导出。",
      );
  }
  const zip = new JSZip(),
    manifest = {
      schema: "sclerite-studio/1",
      version: "0.12.3",
      exportPolicy: results
        ? "confirmed-complete-only"
        : "working-project-with-pending-candidates",
      createdAt: new Date().toISOString(),
      measurementDefinition:
        "2D projected mask; max Feret diameter of pixel-cell convex hull; width perpendicular to max Feret; marching-squares perimeter; units per image",
      images: [] as unknown[],
    };
  for (let n = 0; n < entries.length; n++) {
    const e = entries[n],
      prefix = `images/${e.id}`;
    onProgress(`整理 ${n + 1}/${entries.length}：${e.name}`);
    const originalPath = `${prefix}/original`;
    zip.file(originalPath, await e.original.arrayBuffer());
    const maskPath = e.analysis ? `${prefix}/labels.u32` : undefined;
    if (e.analysis) {
      const bytes = new ArrayBuffer(e.analysis.labels.length * 4),
        view = new DataView(bytes);
      e.analysis.labels.forEach((v, i) => view.setUint32(i * 4, v, true));
      zip.file(maskPath!, bytes);
    }
    manifest.images.push({
      id: e.id,
      name: e.name,
      mime: e.original.type,
      originalPath,
      maskPath,
      width: e.width,
      height: e.height,
      synthetic: e.synthetic,
      calibration: e.calibration,
      params: e.params,
      specimen: e.specimen,
      tissue: e.tissue,
      study: e.study,
      classification: e.classification,
      classificationEpoch: e.analysis?.classificationEpoch,
      sourceHash: e.sourceHash,
      notes: e.notes,
      threshold: e.analysis?.threshold,
      revision: e.analysis?.revision,
      parameterKey: e.analysis?.parameterKey,
      approvedIds: e.analysis?.approvedIds ?? [],
      reviewHints: e.analysis?.reviewHints ?? {},
      splitEvents: e.analysis?.splitEvents ?? [],
      rejected: e.analysis?.rejected ?? [],
    });
    if (results && e.analysis) {
      const original = imageCanvas(e),
        all = document.createElement("canvas");
      all.width = e.width;
      all.height = e.height;
      const ac = all.getContext("2d")!,
        full = ac.createImageData(e.width, e.height);
      e.analysis.labels.forEach((id, i) => {
        full.data[i * 4] =
          full.data[i * 4 + 1] =
          full.data[i * 4 + 2] =
            id ? 255 : 0;
        full.data[i * 4 + 3] = 255;
      });
      ac.putImageData(full, 0, 0);
      zip.file(
        `${prefix}/foreground-mask.png`,
        await (await canvasBlob(all)).arrayBuffer(),
      );
      for (const o of e.analysis.objects) {
        const [x, y, w, h] = o.bbox,
          c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d")!;
        ctx.drawImage(original, x, y, w, h, 0, 0, w, h);
        zip.file(
          `${prefix}/objects/${o.id.toString().padStart(4, "0")}-crop.png`,
          await (await canvasBlob(c)).arrayBuffer(),
        );
        const cut = ctx.getImageData(0, 0, w, h),
          mask = ctx.createImageData(w, h);
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++) {
            const i = (yy * w + xx) * 4,
              on = e.analysis.labels[(y + yy) * e.width + x + xx] === o.id;
            cut.data[i + 3] = on ? 255 : 0;
            mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = on ? 255 : 0;
            mask.data[i + 3] = 255;
          }
        ctx.putImageData(cut, 0, 0);
        zip.file(
          `${prefix}/objects/${o.id.toString().padStart(4, "0")}-cutout.png`,
          await (await canvasBlob(c)).arrayBuffer(),
        );
        ctx.putImageData(mask, 0, 0);
        zip.file(
          `${prefix}/objects/${o.id.toString().padStart(4, "0")}-mask.png`,
          await (await canvasBlob(c)).arrayBuffer(),
        );
      }
    }
  }
  zip.file("project.json", JSON.stringify(manifest, null, 2));
  if (!results)
    zip.file(
      "plate.json",
      JSON.stringify({
        schema: "sclerite-plate/1",
        width: 1200,
        height: 900,
        items: plateItems,
        background: plateBackground,
        settings: plateSettings,
      }),
    );
  zip.file("measurements.csv", csv(entries));
  zip.file(
    "quality-audit.json",
    JSON.stringify(
      entries.map((e) => ({
        image: e.name,
        retainedCandidates: e.analysis?.objects.length ?? 0,
        approvedIds: e.analysis?.approvedIds ?? [],
        rejected: e.analysis?.rejected ?? [],
        splitEvents: e.analysis?.splitEvents ?? [],
      })),
      null,
      2,
    ),
  );
  zip.file(
    "README.txt",
    "Sclerite Studio 0.12.0\n请用0.12或更高版本打开本项目。classification保存人工类别、预测分数、标本UUID及分割身份；模型包另外导出。study元数据与原图SHA256继续保留。\n结果ZIP及CSV仅含勾选确认的对象。自动切分不补画遮挡，切线和完整性须复核。工作项目包含待复核候选和plate.json（尺寸、分页、背景、标尺设置）；结果ZIP不含版面。\n原图位于images/<image_id>/original；labels.u32为行优先小端32位实例ID，0为背景。未校准以px/px²记录，校准以um/um²记录。长度为二维最大Feret径，不是弧长。\n排版默认保持原始尺寸比例；只有校准后才生成μm标尺，单枚缩放时使用独立标尺。排版变换不改变分类输入。\n模型建议不是人工标签，分数不是物种真实概率。重分割或修改轮廓后，旧身份标签不进入当前训练。分组基于记录的标本、群体和原图，不能自动识别重拍、重新编码或未知同源骨针。合成示例标为synthetic=true。\n",
  );
  onProgress("压缩项目…");
  const blob = await zip.generateAsync({
    type: "blob",
    compression: "DEFLATE",
    compressionOptions: { level: 3 },
  });
  return saveBlob(
    blob,
    results ? "sclerite-results.zip" : "sclerite-project.zip",
  );
}

export async function importProject(
  file: File,
  onPlate?: (
    items: PlateItem[],
    background: PlateBackground,
    settings: PlateSettings,
  ) => void,
): Promise<ImageEntry[]> {
  if (file.size > 300_000_000) throw new Error("项目超过300 MB。");
  const zip = await JSZip.loadAsync(file),
    m = JSON.parse(await zip.file("project.json")!.async("string"));
  if (
    m.schema !== "sclerite-studio/1" ||
    !Array.isArray(m.images) ||
    m.images.length > 30
  )
    throw new Error("不是有效的Sclerite Studio项目。");
  const entries: ImageEntry[] = [];
  try {
    for (const item of m.images) {
      const bytes = await zip.file(item.originalPath)!.async("uint8array");
      const e = await loadImage(
        new File([new Uint8Array(bytes)], String(item.name), {
          type: item.mime,
        }),
        Boolean(item.synthetic),
      );
      entries.push(e);
      e.id = String(item.id);
      e.specimen = String(item.specimen ?? "");
      e.tissue = String(item.tissue ?? "未指定");
      e.study = parseStudy(item.study);
      e.classification = parseClassification(item.classification);
      e.notes =
        item.notes && typeof item.notes === "object"
          ? (Object.fromEntries(
              Object.entries(item.notes).filter(
                ([key, value]) =>
                  /^\d+$/.test(key) && typeof value === "string",
              ),
            ) as Record<string, string>)
          : {};
      if (item.params) {
        const p = item.params as Parameters;
        if (
          !["dark", "bright"].includes(p.polarity) ||
          !Number.isInteger(p.backgroundRadius) ||
          p.backgroundRadius < 0 ||
          p.backgroundRadius > 256 ||
          !Number.isFinite(p.threshold) ||
          p.threshold < 0 ||
          p.threshold > 255 ||
          !Number.isInteger(p.minArea) ||
          p.minArea < 1
        )
          throw new Error("项目分割参数无效");
        e.params = { ...DEFAULTS, ...p, autoSplit: p.autoSplit ?? false };
        if (
          typeof e.params.completeOnly !== "boolean" ||
          !Number.isInteger(e.params.closingRadius) ||
          e.params.closingRadius < 0 ||
          e.params.closingRadius > 4 ||
          typeof e.params.autoSplit !== "boolean" ||
          !Number.isFinite(e.params.splitProminence) ||
          e.params.splitProminence < 0.05 ||
          e.params.splitProminence > 0.8 ||
          !Number.isFinite(e.params.splitRadiusRatio) ||
          e.params.splitRadiusRatio < 0.1 ||
          e.params.splitRadiusRatio > 0.5
        )
          throw new Error("完整性筛选参数无效");
      }
      if (item.calibration) {
        const c = item.calibration as Calibration;
        if (
          !Number.isFinite(c.umPerPixel) ||
          c.umPerPixel <= 0 ||
          !Number.isFinite(c.distanceUm) ||
          c.distanceUm <= 0
        )
          throw new Error("项目尺度无效");
        e.calibration = c;
      }
      if (item.maskPath) {
        const buffer = await zip.file(item.maskPath)!.async("arraybuffer");
        if (buffer.byteLength !== e.width * e.height * 4)
          throw new Error("mask尺寸与原图不符。");
        const view = new DataView(buffer),
          labels = new Int32Array(e.width * e.height);
        for (let i = 0; i < labels.length; i++) {
          const v = view.getUint32(i * 4, true);
          if (v > 1_000_000) throw new Error("实例编号超出范围");
          labels[i] = v;
        }
        e.analysis = {
          classificationEpoch:
            typeof item.classificationEpoch === "string"
              ? item.classificationEpoch
              : item.revision,
          labels,
          objects: measureLabels(labels, e.width, e.height),
          threshold: Number(item.threshold) || 0,
          revision:
            typeof item.revision === "string" ? item.revision : undefined,
          parameterKey:
            typeof item.parameterKey === "string"
              ? item.parameterKey
              : undefined,
          approvedIds:
            [
              "0.2.0",
              "0.3.0",
              "0.4.0",
              "0.5.0",
              "0.6.0",
              "0.7.0",
              "0.11.0",
              "0.12.0",
              "0.12.1",
              "0.12.2",
              "0.12.3",
            ].includes(m.version) && Array.isArray(item.approvedIds)
              ? item.approvedIds.filter(
                  (id: unknown) => Number.isInteger(id) && Number(id) > 0,
                )
              : [],
          reviewHints:
            item.reviewHints && typeof item.reviewHints === "object"
              ? (Object.fromEntries(
                  Object.entries(item.reviewHints).filter(
                    ([id, v]) => /^\d+$/.test(id) && typeof v === "string",
                  ),
                ) as Record<string, string>)
              : {},
          splitEvents: Array.isArray(item.splitEvents)
            ? item.splitEvents.filter((ev: unknown) => {
                const v = ev as {
                  parentId: number;
                  childIds: number[];
                  prominence: number;
                  radiusRatio: number;
                  seeds: unknown[];
                };
                return (
                  Number.isInteger(v?.parentId) &&
                  Array.isArray(v.childIds) &&
                  v.childIds.every((id) => Number.isInteger(id) && id > 0) &&
                  Number.isFinite(v.prominence) &&
                  Number.isFinite(v.radiusRatio) &&
                  Array.isArray(v.seeds)
                );
              })
            : [],
          rejected: Array.isArray(item.rejected)
            ? item.rejected.filter((r: unknown) => {
                const v = r as {
                  id: number;
                  bbox: number[];
                  reasons: unknown[];
                };
                return (
                  Number.isInteger(v?.id) &&
                  Array.isArray(v?.bbox) &&
                  v.bbox.length === 4 &&
                  Array.isArray(v?.reasons) &&
                  v.reasons.every((s) => typeof s === "string")
                );
              })
            : [],
        };
      }
    }
  } catch (error) {
    entries.forEach((e) => URL.revokeObjectURL(e.url));
    throw error;
  }
  if (onPlate && zip.file("plate.json")) {
    try {
      const plate = parsePlate(
        JSON.parse(await zip.file("plate.json")!.async("string")),
      );
      for (const item of plate.items) {
        const img = new Image();
        img.src = item.image;
        await img.decode();
        if (
          img.naturalWidth !== item.sourceWidth ||
          img.naturalHeight !== item.sourceHeight
        )
          throw new Error("版面裁剪尺寸与记录不符");
      }
      onPlate(
        plate.items,
        plate.background ?? "white",
        plate.settings ?? { ...DEFAULT_PLATE_SETTINGS },
      );
    } catch (error) {
      entries.forEach((e) => URL.revokeObjectURL(e.url));
      throw error;
    }
  }
  return entries;
}
