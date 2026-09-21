import type { ImageEntry, Sclerite } from "./types";

export type StudyMetadata = {
  colony: string;
  taxon: string;
  hypothesis: string;
  lineage: string;
  evidence: string;
  publication: string;
  batch: string;
  locality: string;
  source: "unknown" | "microscopy" | "publication";
  sampling: "unknown" | "systematic" | "selected";
  partition: "unassigned" | "train" | "validation" | "test" | "exclude";
};
export const EMPTY_STUDY: StudyMetadata = {
  colony: "",
  taxon: "",
  hypothesis: "",
  lineage: "",
  evidence: "",
  publication: "",
  batch: "",
  locality: "",
  source: "unknown",
  sampling: "unknown",
  partition: "unassigned",
};
export const SOURCE_LABELS = {
  unknown: "来源未指定",
  microscopy: "自采光镜",
  publication: "论文图版",
};
export const SAMPLING_LABELS = {
  unknown: "取样未指定",
  systematic: "系统 / 随机取样",
  selected: "挑选展示",
};
export const PARTITION_LABELS = {
  unassigned: "未分配",
  train: "训练",
  validation: "验证",
  test: "测试",
  exclude: "排除",
};

// 导入旧项目时缺失字段保持未知；不从文件名猜标本或物种。
export function parseStudy(value: unknown): StudyMetadata {
  const result = { ...EMPTY_STUDY };
  if (value == null) return result;
  if (typeof value !== "object" || Array.isArray(value))
    throw new Error("物种研究信息无效");
  const data = value as Record<string, unknown>;
  for (const key of [
    "colony",
    "taxon",
    "hypothesis",
    "lineage",
    "evidence",
    "publication",
    "batch",
    "locality",
  ] as const) {
    if (
      data[key] !== undefined &&
      (typeof data[key] !== "string" || data[key].length > 10000)
    )
      throw new Error("研究信息字段无效：" + key);
    result[key] = (data[key] as string | undefined) ?? "";
  }
  for (const [key, choices] of [
    ["source", Object.keys(SOURCE_LABELS)],
    ["sampling", Object.keys(SAMPLING_LABELS)],
    ["partition", Object.keys(PARTITION_LABELS)],
  ] as const) {
    if (data[key] !== undefined && !choices.includes(data[key] as string))
      throw new Error("研究信息选项无效：" + key);
    if (data[key] !== undefined) Object.assign(result, { [key]: data[key] });
  }
  return result;
}
export const studyOf = (e: ImageEntry) => ({ ...EMPTY_STUDY, ...e.study });
const morphotypeOf = (e: ImageEntry, id: number) =>
  typeof e.notes[id] === "string" ? e.notes[id].trim() || "未标注" : "未标注";
export function completeObjects(e: ImageEntry): Sclerite[] {
  const approved = new Set(e.analysis?.approvedIds ?? []);
  const rejected = new Set(e.analysis?.rejected?.map((o) => o.id) ?? []);
  return (e.analysis?.objects ?? []).filter(
    (o) => approved.has(o.id) && !o.border && !rejected.has(o.id),
  );
}
export function quantile(values: number[], p: number): number | null {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * p,
    lo = Math.floor(at),
    hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}
export type Summary = {
  key: string;
  specimen: string;
  tissue: string;
  source: StudyMetadata["source"];
  sampling: StudyMetadata["sampling"];
  imageIds: string[];
  n: number;
  calibratedN: number;
  length: [number | null, number | null, number | null];
  width: number | null;
  aspect: number | null;
  circularity: number | null;
  morphotypes: Record<string, number>;
  taxa: string[];
  hypotheses: string[];
  lineages: string[];
};
export function uniqueRealImages(images: ImageEntry[]) {
  const seen = new Set<string>();
  return images.filter((e) => {
    if (e.synthetic || studyOf(e).partition === "exclude") return false;
    if (!e.sourceHash) return true;
    if (seen.has(e.sourceHash)) return false;
    seen.add(e.sourceHash);
    return true;
  });
}
export function summarizeStudy(
  images: ImageEntry[],
  morphotype = "",
): Summary[] {
  const groups = new Map<
    string,
    {
      row: Summary;
      lengths: number[];
      widths: number[];
      aspects: number[];
      circularities: number[];
    }
  >();
  for (const e of uniqueRealImages(images)) {
    if (!e.specimen.trim() || !e.tissue.trim() || e.tissue === "未指定")
      continue;
    const meta = studyOf(e),
      objects = completeObjects(e).filter(
        (o) => !morphotype || morphotypeOf(e, o.id) === morphotype,
      );
    if (!objects.length) continue;
    const key = JSON.stringify([
      e.specimen.trim(),
      e.tissue.trim(),
      meta.source,
      meta.sampling,
    ]);
    let g = groups.get(key);
    if (!g) {
      g = {
        row: {
          key,
          specimen: e.specimen.trim(),
          tissue: e.tissue.trim(),
          source: meta.source,
          sampling: meta.sampling,
          imageIds: [],
          n: 0,
          calibratedN: 0,
          length: [null, null, null],
          width: null,
          aspect: null,
          circularity: null,
          morphotypes: Object.create(null),
          taxa: [],
          hypotheses: [],
          lineages: [],
        },
        lengths: [],
        widths: [],
        aspects: [],
        circularities: [],
      };
      groups.set(key, g);
    }
    g.row.imageIds.push(e.id);
    for (const [field, value] of [
      ["taxa", meta.taxon],
      ["hypotheses", meta.hypothesis],
      ["lineages", meta.lineage],
    ] as const) {
      if (value.trim() && !g.row[field].includes(value.trim()))
        g.row[field].push(value.trim());
    }
    const scale = e.calibration?.umPerPixel;
    for (const o of objects) {
      g.row.n++;
      if (scale && Number.isFinite(scale) && scale > 0) {
        g.row.calibratedN++;
        g.lengths.push(o.length * scale);
        g.widths.push(o.width * scale);
      }
      g.aspects.push(o.aspect);
      g.circularities.push(o.circularity);
      const label = morphotypeOf(e, o.id);
      g.row.morphotypes[label] = (g.row.morphotypes[label] ?? 0) + 1;
    }
  }
  return [...groups.values()].map((g) => ({
    ...g.row,
    length: [
      quantile(g.lengths, 0.25),
      quantile(g.lengths, 0.5),
      quantile(g.lengths, 0.75),
    ] as Summary["length"],
    width: quantile(g.widths, 0.5),
    aspect: quantile(g.aspects, 0.5),
    circularity: quantile(g.circularities, 0.5),
  }));
}

export type LeakageGroup = {
  id: string;
  imageIds: string[];
  partitions: string[];
  specimens: string[];
};
// 共享标本、母群体、论文、批次或原图 SHA256 的关联传递闭包，不按骨针随机拆分。
export function leakageGroups(images: ImageEntry[]): LeakageGroup[] {
  const parent = images.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  const keys = new Map<string, number>();
  images.forEach((e, i) => {
    const m = studyOf(e);
    const links = [
      ["specimen", e.specimen],
      ["colony", m.colony],
      ["publication", m.publication],
      ["batch", m.batch],
      ["hash", e.sourceHash ?? ""],
    ];
    for (const [kind, raw] of links) {
      if (!raw.trim()) continue;
      const key = kind + ":" + raw.trim(),
        previous = keys.get(key);
      if (previous === undefined) keys.set(key, i);
      else parent[find(i)] = find(previous);
    }
  });
  const sets = new Map<number, ImageEntry[]>();
  images.forEach((e, i) => {
    const key = find(i);
    sets.set(key, [...(sets.get(key) ?? []), e]);
  });
  return [...sets.values()].map((entries) => ({
    id: "group:" + entries.map((e) => e.id).sort()[0],
    imageIds: entries.map((e) => e.id),
    specimens: [
      ...new Set(entries.map((e) => e.specimen.trim()).filter(Boolean)),
    ],
    partitions: [
      ...new Set(
        entries
          .filter((e) => !e.synthetic)
          .map((e) => studyOf(e).partition)
          .filter((p) => p !== "unassigned" && p !== "exclude"),
      ),
    ],
  }));
}
export type AuditIssue = { level: "block" | "warn"; message: string };
export function auditStudy(images: ImageEntry[]) {
  const issues: AuditIssue[] = [];
  const real = images.filter(
    (e) => !e.synthetic && studyOf(e).partition !== "exclude",
  );
  const groups = leakageGroups(images);
  const add = (level: AuditIssue["level"], message: string) =>
    issues.push({ level, message });
  if (!real.length)
    add("block", "没有纳入研究的真实图像；合成示例不用于生物学分析。");
  for (const [field, label] of [
    ["specimen", "标本编号"],
    ["colony", "母群体编号"],
    ["tissue", "组织区域"],
    ["source", "图像来源"],
    ["sampling", "取样方式"],
    ["batch", "成像 / 制片批次"],
  ] as const) {
    const missing = real.filter((e) => {
      const value =
        field === "specimen" || field === "tissue"
          ? e[field]
          : studyOf(e)[field];
      return !value.trim() || value === "unknown" || value === "未指定";
    });
    if (missing.length) add("block", `${missing.length} 张图像缺少${label}。`);
  }
  if (
    real.some(
      (e) =>
        studyOf(e).source === "publication" && !studyOf(e).publication.trim(),
    )
  )
    add("block", "论文图版缺少 publication ID / DOI，无法检查出版物泄漏。");
  const hashes = new Set<string>();
  let duplicates = 0;
  for (const e of real) {
    if (e.sourceHash && hashes.has(e.sourceHash)) duplicates++;
    if (e.sourceHash) hashes.add(e.sourceHash);
  }
  if (duplicates)
    add(
      "block",
      `${duplicates} 张完全相同的原图重复导入；汇总仅保留第一份。请将重复项排除或移除后再验证。`,
    );
  if (real.some((e) => !e.sourceHash))
    add(
      "block",
      "部分原图尚无 SHA256，完全重复检查不完整；另存项目再打开可补算。",
    );
  if (real.some((e) => !e.calibration))
    add("warn", "未校准骨针不参与 μm 尺寸汇总，只参与无量纲形状统计。");
  if (real.some((e) => !completeObjects(e).length))
    add("block", "部分纳入图像尚无已确认完整的骨针。");
  if (
    real.some(
      (e) =>
        studyOf(e).sampling !== "systematic" ||
        studyOf(e).source === "publication",
    )
  )
    add(
      "warn",
      "挑选图版与取样不明的 morphotype 比例仅描述展示样本，不能估计群体频率。",
    );
  const bySpecimen = new Map<string, ImageEntry[]>();
  real
    .filter((e) => e.specimen.trim())
    .forEach((e) =>
      bySpecimen.set(e.specimen.trim(), [
        ...(bySpecimen.get(e.specimen.trim()) ?? []),
        e,
      ]),
    );
  for (const [specimen, entries] of bySpecimen)
    for (const [field, label] of [
      ["colony", "母群体"],
      ["taxon", "既有鉴定"],
      ["hypothesis", "候选分组"],
      ["lineage", "分子谱系"],
    ] as const) {
      if (
        new Set(entries.map((e) => studyOf(e)[field].trim()).filter(Boolean))
          .size > 1
      )
        add("block", `标本 ${specimen} 的${label}记录不一致。`);
    }
  for (const group of groups)
    if (group.partitions.length > 1)
      add(
        "block",
        `关联组 ${group.specimens.join(" / ") || group.id} 跨训练 / 验证 / 测试集合，存在泄漏。`,
      );
  if (real.some((e) => studyOf(e).partition === "unassigned"))
    add("block", "仍有图像未分配训练 / 验证 / 测试用途。");
  for (const partition of ["train", "validation", "test"] as const)
    if (!real.some((e) => studyOf(e).partition === partition))
      add(
        "block",
        `缺少${PARTITION_LABELS[partition]}集；不能导出可训练划分。`,
      );
  const colonyCount = new Set(
    real.map((e) => studyOf(e).colony.trim()).filter(Boolean),
  ).size;
  if (colonyCount < 3)
    add(
      "warn",
      "独立母群体不足 3 个，仅适合流程试用，不能验证跨群体泛化。3 个也不代表样本量充足。",
    );
  const taxa = new Map<string, Set<string>>();
  for (const e of real) {
    const m = studyOf(e);
    if (m.taxon.trim()) {
      const set = taxa.get(m.taxon.trim()) ?? new Set();
      if (m.colony.trim()) set.add(m.colony.trim());
      taxa.set(m.taxon.trim(), set);
    }
  }
  for (const [taxon, colonies] of taxa)
    if (colonies.size < 2)
      add(
        "warn",
        `${taxon} 只有 ${colonies.size} 个已标识母群体，物种标签与标本效应无法分离。`,
      );
  add(
    "warn",
    "检查仅覆盖已填写的关联与字节相同原图；重拍、裁剪、重编码和同一骨针重复拍摄仍须人工核对。",
  );
  return {
    issues,
    groups,
    colonyCount,
    canExportSplit: !issues.some((i) => i.level === "block"),
  };
}
export function tabular(rows: unknown[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((v) => {
            let s = String(v ?? "");
            if (/^[=+@\-\t\r]/.test(s)) s = "'" + s;
            return '"' + s.replaceAll('"', '""') + '"';
          })
          .join(","),
      )
      .join("\r\n")
  );
}
export function summaryCSV(rows: Summary[]) {
  return tabular([
    [
      "specimen",
      "tissue",
      "source",
      "sampling",
      "images_n",
      "confirmed_n",
      "calibrated_n",
      "length_um_q25",
      "length_um_median",
      "length_um_q75",
      "width_um_median",
      "aspect_median",
      "circularity_median",
      "morphotype_counts",
      "prior_taxon_labels",
      "candidate_hypotheses",
      "molecular_lineages",
    ],
    ...rows.map((r) => [
      r.specimen,
      r.tissue,
      r.source,
      r.sampling,
      r.imageIds.length,
      r.n,
      r.calibratedN,
      ...r.length,
      r.width,
      r.aspect,
      r.circularity,
      JSON.stringify(r.morphotypes),
      r.taxa.join(" | "),
      r.hypotheses.join(" | "),
      r.lineages.join(" | "),
    ]),
  ]);
}
