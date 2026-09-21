import type { ImageEntry, Sclerite } from "./types";

export type Task = "morphotype" | "species";
export type Category = { id: string; name: string; task: Task };
export type Prediction = {
  model: string;
  classes: string[];
  scores: number[];
  date: string;
};
export type Annotation = {
  uuid: string;
  objectId: number;
  task: Task;
  label?: string;
  prediction?: Prediction;
  acceptedModel?: string;
};
export type ClassificationData = {
  specimenId?: string;
  categories: Category[];
  annotations: Record<string, Annotation>;
};
export type ClassRow = { key: string; entry: ImageEntry; object: Sclerite };
export type Sample = {
  key: string;
  object: string;
  source: string;
  label: string;
  group: string;
  partition: "train" | "validation" | "test";
};
export type ClassifierModel = {
  encoder?: string;
  regularization?: {
    lambda: number;
    selected_on: "fixed" | "validation";
    candidates: {
      lambda: number;
      validation_macro_f1: number;
      converged: boolean;
    }[];
  };
  dataset_signature?: string;
  schema: string;
  id: string;
  created: number;
  task: Task;
  classes: { id: string; name: string }[];
  encoder_hash: string;
  preprocessing: string;
  backend: "cpu" | "coreml";
  head: {
    weights: number[][];
    bias: number[];
    iterations: number;
    converged: boolean;
    loss: number;
  };
  formal: boolean;
  samples: Sample[];
  evaluation: Record<
    string,
    { count: number; groups: number; macro_f1: number; confusion: number[][] }
  >;
};
export type EncoderInfo = {
  id: string;
  name: string;
  dim: number;
  available: boolean;
};
export const defaultEncoders: EncoderInfo[] = [
  {
    id: "mobilenetv4-small",
    name: "MobileNetV4 · 轻量",
    dim: 1280,
    available: true,
  },
  {
    id: "dinov3-vits16",
    name: "DINOv3 · 通用视觉特征",
    dim: 384,
    available: false,
  },
];
export const modelEncoder = (model: ClassifierModel) =>
  model.encoder ?? "mobilenetv4-small";
// 标签、类别和数据划分不进入特征身份；原图和 mask 已包含在 row.key 中。
export const featureIdentity = (
  cropKey: string,
  encoder: string,
  backend: string,
) => `${encoder}:${backend}:${cropKey}`;
export const emptyClassification = (): ClassificationData => ({
  categories: [],
  annotations: {},
});
const tasks = new Set(["morphotype", "species"]);
export function parseClassification(
  value: unknown,
): ClassificationData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as ClassificationData;
  if (
    !Array.isArray(v.categories) ||
    v.categories.length > 200 ||
    !v.annotations ||
    typeof v.annotations !== "object" ||
    Object.keys(v.annotations).length > 20000
  )
    throw new Error("分类数据格式或规模无效");
  const ids = new Set<string>();
  const categories = v.categories.map((c) => {
    if (
      !c ||
      typeof c.id !== "string" ||
      c.id.length > 100 ||
      !c.id ||
      ids.has(c.id) ||
      typeof c.name !== "string" ||
      !c.name.trim() ||
      c.name.length > 80 ||
      !tasks.has(c.task)
    )
      throw new Error("分类类别无效");
    ids.add(c.id);
    return { id: c.id, name: c.name, task: c.task };
  });
  const annotations: Record<string, Annotation> = {};
  for (const [key, a] of Object.entries(v.annotations)) {
    if (
      !/^(morphotype|species):[a-f0-9]{64}$/.test(key) ||
      !a ||
      typeof a.uuid !== "string" ||
      a.uuid.length > 100 ||
      !Number.isInteger(a.objectId) ||
      !tasks.has(a.task) ||
      !key.startsWith(a.task + ":")
    )
      throw new Error("分类实例记录无效");
    if (
      a.label &&
      !categories.some((c) => c.id === a.label && c.task === a.task)
    )
      throw new Error("人工类别不存在");
    const p = a.prediction;
    if (
      p &&
      (typeof p.model !== "string" ||
        p.model.length > 100 ||
        typeof p.date !== "string" ||
        !Array.isArray(p.classes) ||
        p.classes.length < 2 ||
        p.classes.length > 100 ||
        !p.classes.every((c) => typeof c === "string" && c.length <= 100) ||
        new Set(p.classes).size !== p.classes.length ||
        !Array.isArray(p.scores) ||
        p.scores.length !== p.classes.length ||
        p.scores.some((s) => !Number.isFinite(s) || s < 0 || s > 1) ||
        Math.abs(p.scores.reduce((a, b) => a + b, 0) - 1) > 1e-4)
    )
      throw new Error("预测分数记录无效");
    annotations[key] = {
      uuid: a.uuid,
      objectId: a.objectId,
      task: a.task,
      label: a.label,
      prediction: p,
      acceptedModel:
        typeof a.acceptedModel === "string" ? a.acceptedModel : undefined,
    };
  }
  return {
    categories,
    annotations,
    specimenId:
      typeof v.specimenId === "string" && v.specimenId.length <= 100
        ? v.specimenId
        : undefined,
  };
}

export function categoriesOf(images: ImageEntry[], task: Task): Category[] {
  const all = new Map<string, Category>();
  for (const e of images)
    for (const c of e.classification?.categories ?? [])
      if (c.task === task) all.set(c.id, c);
  return [...all.values()];
}
export function annotation(row: ClassRow, task: Task) {
  return row.entry.classification?.annotations[`${task}:${row.key}`];
}
export function cropPacket(entry: ImageEntry, object: Sclerite): Uint8Array {
  const [x, y, w, h] = object.bbox;
  if (
    !entry.analysis ||
    w * h > 12_000_000 ||
    w < 1 ||
    h < 1 ||
    x < 0 ||
    y < 0 ||
    x + w > entry.width ||
    y + h > entry.height
  )
    throw new Error("骨针裁剪尺寸无效");
  const packet = new Uint8Array(8 + w * h * 4),
    view = new DataView(packet.buffer);
  view.setUint32(0, w, true);
  view.setUint32(4, h, true);
  for (let yy = 0; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      const src = (y + yy) * entry.width + x + xx,
        dest = 8 + (yy * w + xx) * 4;
      if (entry.analysis.labels[src] === object.id) {
        packet[dest] = entry.data[src * 4];
        packet[dest + 1] = entry.data[src * 4 + 1];
        packet[dest + 2] = entry.data[src * 4 + 2];
        packet[dest + 3] = 255;
      }
    }
  return packet;
}
const identityCache = new WeakMap<object, Promise<Map<number, string>>>();
async function keysOf(e: ImageEntry): Promise<Map<number, string>> {
  const a = e.analysis!;
  let promise = identityCache.get(a.labels);
  if (!promise) {
    promise = (async () => {
      const out = new Map<number, string>();
      for (const o of a.objects) {
        const packet = cropPacket(e, o);
        const origin = new TextEncoder().encode(
          `${e.sourceHash ?? e.id}|${a.classificationEpoch ?? a.revision ?? e.id}|${o.bbox.join(",")}|`,
        );
        const data = new Uint8Array(origin.length + packet.length);
        data.set(origin);
        data.set(packet, origin.length);
        const bytes = new Uint8Array(
          await crypto.subtle.digest("SHA-256", data),
        );
        out.set(
          o.id,
          [...bytes].map((v) => v.toString(16).padStart(2, "0")).join(""),
        );
      }
      return out;
    })();
    identityCache.set(a.labels, promise);
  }
  return promise;
}
export async function rowsOf(images: ImageEntry[]): Promise<ClassRow[]> {
  const rows: ClassRow[] = [];
  for (const e of images) {
    const a = e.analysis;
    if (!a) continue;
    const approved = new Set(a.approvedIds ?? []),
      rejected = new Set((a.rejected ?? []).map((o) => o.id));
    const eligible = a.objects.filter(
      (o) => approved.has(o.id) && !o.border && !rejected.has(o.id),
    );
    if (!eligible.length) continue;
    const keys = await keysOf(e);
    for (const o of eligible)
      rows.push({ key: keys.get(o.id)!, entry: e, object: o });
  }
  return rows;
}

export type DatasetPlan = {
  rows: ClassRow[];
  groups: Map<string, string>;
  partitions: Map<string, Sample["partition"]>;
  formal: boolean;
  reason: string;
};
// 同标本、群体及重复原图构成同一个不可拆分组。分区只用标签覆盖，不看模型表现。
export function planDataset(
  rows: ClassRow[],
  task: Task,
  classes: Category[],
  formalRequested: boolean,
): DatasetPlan {
  const labeled = rows.filter((r) => annotation(r, task)?.label);
  if (labeled.some((r) => r.entry.study?.source === "publication"))
    throw new Error(
      "首版分类训练面向自采光镜图像，论文 plate 请独立整理，不与显微照片混合训练。",
    );
  if (labeled.some((r) => r.entry.synthetic))
    throw new Error("合成演示不能用于训练真实分类模型，请移除其人工标签。");
  if (
    labeled.some(
      (r) => !r.entry.classification?.specimenId || !r.entry.sourceHash,
    )
  )
    throw new Error("先为所有有标签的照片指定标本；原图必须可追溯。");
  if (
    classes.length < 2 ||
    classes.some(
      (c) => !labeled.some((r) => annotation(r, task)?.label === c.id),
    )
  )
    throw new Error("至少两个类别，且每个类别都需要已确认的骨针标签。");
  const groups = independentGroups(labeled);
  return partitionDataset(labeled, task, classes, formalRequested, groups);
}

export function independentGroups(labeled: ClassRow[]): Map<string, string> {
  labeled = labeled.filter(
    (r) => r.entry.classification?.specimenId && r.entry.sourceHash,
  );
  const parent = new Map<string, string>();
  const root = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    const p = parent.get(id)!;
    if (p === id) return id;
    const r = root(p);
    parent.set(id, r);
    return r;
  };
  const join = (a: string, b: string) => {
    const x = root(a),
      y = root(b);
    if (x !== y) parent.set(x, y);
  };
  const first = new Map<string, string>();
  for (const r of labeled) {
    const specimen = r.entry.classification!.specimenId!;
    root(specimen);
    for (const k of [
      `source:${r.entry.sourceHash}`,
      r.entry.study?.colony ? `colony:${r.entry.study.colony.trim()}` : "",
      r.entry.study?.publication
        ? `publication:${r.entry.study.publication.trim()}`
        : "",
    ]) {
      if (!k) continue;
      if (first.has(k)) join(specimen, first.get(k)!);
      else first.set(k, specimen);
    }
  }
  return new Map(
    labeled.map((r) => [r.key, root(r.entry.classification!.specimenId!)]),
  );
}

function partitionDataset(
  labeled: ClassRow[],
  task: Task,
  classes: Category[],
  formalRequested: boolean,
  groups: Map<string, string>,
): DatasetPlan {
  const groupIds = [...new Set(groups.values())].sort();
  const partitions = new Map<string, Sample["partition"]>(
    groupIds.map((g) => [g, "train"]),
  );
  const base = {
    rows: labeled,
    groups,
    partitions,
    formal: false,
    reason: "试用模型 · 未独立验证",
  };
  const explicit = labeled.filter(
    (r) =>
      r.entry.study?.partition &&
      !["unassigned", "exclude"].includes(r.entry.study.partition),
  );
  if (labeled.some((r) => r.entry.study?.partition === "exclude"))
    throw new Error("有标签的照片被标为排除；请先清除对应训练标签。");
  if (!formalRequested) {
    if (explicit.some((r) => r.entry.study?.partition !== "train"))
      throw new Error("存在锁定验证／测试材料，不能并入试用训练。");
    return base;
  }
  const covered = (parts: Map<string, Sample["partition"]>) =>
    classes.every((c) =>
      ["train", "validation", "test"].every((p) =>
        labeled.some(
          (r) =>
            annotation(r, task)?.label === c.id &&
            parts.get(groups.get(r.key)!) === p,
        ),
      ),
    );
  if (explicit.length) {
    if (explicit.length !== labeled.length)
      throw new Error(
        "已有手动分区，不能混用自动分区；请将训练照片的分区全部指定。",
      );
    const manual = new Map<string, Sample["partition"]>();
    for (const r of explicit) {
      const g = groups.get(r.key)!,
        part = r.entry.study!.partition as Sample["partition"];
      if (manual.has(g) && manual.get(g) !== part)
        throw new Error("同一标本、群体或来源跨越训练和测试区。");
      manual.set(g, part);
    }
    if (!covered(manual))
      throw new Error("手动分区未覆盖全部类别，不能进行独立评估。");
    return {
      ...base,
      partitions: manual,
      formal: true,
      reason: "按已指定的独立分区评估",
    };
  }
  if (
    classes.some(
      (c) =>
        new Set(
          labeled
            .filter((r) => annotation(r, task)?.label === c.id)
            .map((r) => groups.get(r.key)),
        ).size < 3,
    )
  )
    throw new Error(
      "每类至少需要 3 个独立标本／群体组，才能划分训练、验证、测试。可关闭独立评估训练试用模型。",
    );
  let seed = 20260922;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  // 少量标本时 20% 可能装不下全部类别；再尝试三等分，仍不拆分组。
  const holdSizes = [
    ...new Set([
      Math.max(1, Math.round(groupIds.length * 0.2)),
      Math.max(1, Math.floor(groupIds.length / 3)),
    ]),
  ];
  for (let attempt = 0; attempt < 512 * holdSizes.length; attempt++) {
    const ordered = groupIds.slice();
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
    const hold = holdSizes[Math.floor(attempt / 512)];
    const split = new Map<string, Sample["partition"]>(
      ordered.map((g, i) => [
        g,
        i < hold ? "test" : i < 2 * hold ? "validation" : "train",
      ]),
    );
    if (covered(split))
      return {
        ...base,
        partitions: split,
        formal: true,
        reason:
          attempt < 512
            ? "固定种子 20260922 · 按独立组划分，目标 60/20/20"
            : "固定种子 20260922 · 少量独立组按约三等分划分以覆盖全部类别",
      };
  }
  throw new Error(
    "当前组结构无法得到覆盖全部类别的独立分区；请增加标本或使用试用模型，不会退回骨针随机划分。",
  );
}

export function predictionBest(p: Prediction) {
  let i = 0;
  p.scores.forEach((v, n) => {
    if (v > p.scores[i]) i = n;
  });
  return { id: p.classes[i], score: p.scores[i] };
}
export function resultsCsv(
  rows: ClassRow[],
  task: Task,
  categories: Category[],
): string {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return (
    "\ufeff" +
    [
      [
        "image",
        "image_id",
        "object_id",
        "object_uuid",
        "specimen",
        "specimen_id",
        "task",
        "human_label",
        "suggested_label",
        "model_score",
        "review",
        "model_id",
      ],
      ...rows.map((r) => {
        const a = annotation(r, task),
          p = a?.prediction,
          best = p ? predictionBest(p) : undefined;
        return [
          r.entry.name,
          r.entry.id,
          r.object.id,
          a?.uuid,
          r.entry.specimen,
          r.entry.classification?.specimenId,
          task,
          a?.label ? names.get(a.label) : "",
          best ? (names.get(best.id) ?? best.id) : "",
          best?.score,
          a?.label ? "human-confirmed" : p ? "pending" : "unlabeled",
          p?.model,
        ];
      }),
    ]
      .map((r) => r.map(cell).join(","))
      .join("\r\n")
  );
}
