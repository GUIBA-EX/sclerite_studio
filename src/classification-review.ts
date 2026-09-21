import { annotation, independentGroups, planDataset } from "./classification";
import type {
  Annotation,
  Category,
  ClassifierModel,
  ClassRow,
  DatasetPlan,
  Task,
} from "./classification";
import type { ImageEntry } from "./types";

type HumanLabel = Pick<Annotation, "label" | "acceptedModel">;
export type LabelChange = {
  image: string;
  key: string;
  before: HumanLabel;
  after: HumanLabel;
};
export type LabelAction = { name: string; task: Task; changes: LabelChange[] };
export const humanLabel = (a?: Annotation): HumanLabel => ({
  label: a?.label,
  acceptedModel: a?.acceptedModel,
});
export const sameLabel = (a: HumanLabel, b: HumanLabel) =>
  a.label === b.label && a.acceptedModel === b.acceptedModel;

// 只恢复人工字段，保留随后生成的预测、实例 UUID 和来源记录。
export function applyLabelAction(
  images: ImageEntry[],
  action: LabelAction,
  redo: boolean,
): ImageEntry[] {
  for (const c of action.changes) {
    const data = images.find((e) => e.id === c.image)?.classification;
    const a = data?.annotations[c.key];
    const target = redo ? c.after : c.before;
    if (
      !a ||
      !sameLabel(a, redo ? c.before : c.after) ||
      (target.label &&
        !data?.categories.some(
          (k) => k.id === target.label && k.task === action.task,
        ))
    )
      throw new Error("标签或类别已改变，这条撤销记录不再适用。");
  }
  return images.map((e) => {
    const changes = action.changes.filter((c) => c.image === e.id);
    if (!changes.length || !e.classification) return e;
    const annotations = { ...e.classification.annotations };
    for (const c of changes)
      annotations[c.key] = {
        ...annotations[c.key],
        ...(redo ? c.after : c.before),
      };
    return { ...e, classification: { ...e.classification, annotations } };
  });
}

export function trainingAudit(
  rows: ClassRow[],
  task: Task,
  cats: Category[],
  formal: boolean,
  model: ClassifierModel | null,
) {
  const labeled = rows.filter((r) => annotation(r, task)?.label);
  const errors: string[] = [],
    warnings: string[] = [];
  const sources = new Map<string, Set<string>>();
  for (const r of labeled) {
    if (!r.entry.sourceHash) continue;
    const ids = sources.get(r.entry.sourceHash) ?? new Set<string>();
    ids.add(r.entry.id);
    sources.set(r.entry.sourceHash, ids);
  }
  const duplicates = [...sources.values()].filter((ids) => ids.size > 1).length;
  if (duplicates)
    errors.push(
      `${duplicates} 组重复原图同时带有训练标签，请只保留一份照片的标签。`,
    );
  if (rows.length > labeled.length)
    warnings.push(
      `${rows.length - labeled.length} 枚尚未标注，不参与本次训练。`,
    );
  let plan: DatasetPlan | undefined;
  try {
    plan = planDataset(rows, task, cats, formal);
    if (model?.task === task && model.formal) {
      const tests = model.samples.filter((s) => s.partition === "test");
      if (
        plan.rows.some(
          (r) =>
            tests.some(
              (s) =>
                s.source === r.entry.sourceHash ||
                s.group === plan!.groups.get(r.key),
            ) && plan!.partitions.get(plan!.groups.get(r.key)!) !== "test",
        )
      )
        errors.push("当前模型的锁定测试标本不能转入训练或验证。");
    }
  } catch (e) {
    errors.push(e instanceof Error ? e.message : String(e));
  }
  if (!formal)
    warnings.push("试用模型不提供独立准确率，不能据此判断物种鉴定能力。");
  const groups = independentGroups(labeled);
  const classes = cats.map((c) => {
    const rs = labeled.filter((r) => annotation(r, task)?.label === c.id);
    return {
      ...c,
      count: rs.length,
      specimens: new Set(
        rs.map((r) => r.entry.classification?.specimenId).filter(Boolean),
      ).size,
      groups: rs.every((r) => groups.has(r.key))
        ? new Set(rs.map((r) => groups.get(r.key))).size
        : null,
    };
  });
  return {
    plan,
    errors,
    warnings,
    classes,
    count: labeled.length,
    missingSpecimens: new Set(
      labeled
        .filter((r) => !r.entry.classification?.specimenId)
        .map((r) => r.entry.id),
    ).size,
  };
}

// 仅记录训练输入与标签。排版、选择和模型建议不影响快照。
export async function datasetSignature(
  rows: ClassRow[],
  task: Task,
  cats: Category[],
  plan?: DatasetPlan,
) {
  const data = {
    task,
    classes: cats
      .map((c) => [c.id, c.name])
      .sort((a, b) => a[0].localeCompare(b[0])),
    rows: rows
      .filter((r) => annotation(r, task)?.label)
      .map((r) => ({
        key: r.key,
        uuid: annotation(r, task)!.uuid,
        label: annotation(r, task)!.label,
        source: r.entry.sourceHash ?? "",
        specimen: r.entry.classification?.specimenId ?? "",
        colony: r.entry.study?.colony?.trim() ?? "",
        publication: r.entry.study?.publication?.trim() ?? "",
        sourceType: r.entry.study?.source ?? "unknown",
        synthetic: !!r.entry.synthetic,
        partition: plan
          ? plan.partitions.get(plan.groups.get(r.key)!)
          : !r.entry.study?.partition ||
              r.entry.study.partition === "unassigned"
            ? "train"
            : r.entry.study.partition,
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
  };
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(data)),
  );
  return [...new Uint8Array(bytes)]
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}

export function modelFreshness(
  model: ClassifierModel,
  images: ImageEntry[],
  signature: string,
) {
  const identities = new Set(
    images.flatMap((e) =>
      Object.values(e.classification?.annotations ?? {}).map((a) => a.uuid),
    ),
  );
  if (!model.samples.some((s) => identities.has(s.object))) return "external";
  if (!model.dataset_signature) return "unknown";
  return model.dataset_signature === signature ? "current" : "outdated";
}
