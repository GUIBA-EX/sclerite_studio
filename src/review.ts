import type { ImageEntry } from "./types";

// 唯一的结果导出入口：未人工确认、贴边和已拒绝的实例不得进入结果。
export function confirmedEntry(entry: ImageEntry): ImageEntry {
  if (!entry.analysis) return entry;
  const a = entry.analysis,
    approved = new Set(a.approvedIds ?? []),
    rejected = new Set((a.rejected ?? []).map((o) => o.id));
  const objects = a.objects.filter(
    (o) => approved.has(o.id) && !o.border && !rejected.has(o.id),
  );
  const ids = new Set(objects.map((o) => o.id)),
    labels = a.labels.slice();
  for (let i = 0; i < labels.length; i++)
    if (!ids.has(labels[i])) labels[i] = 0;
  return {
    ...entry,
    notes: Object.fromEntries(
      Object.entries(entry.notes).filter(([id]) => ids.has(Number(id))),
    ),
    analysis: { ...a, objects, labels, approvedIds: [...ids] },
  };
}
