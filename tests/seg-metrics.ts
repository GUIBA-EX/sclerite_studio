export type SegMetrics = { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number; meanIoU: number | null; undersegmented: number; oversegmented: number };

export function segmentationMetrics(gt: Int32Array, pred: Int32Array, width: number, height: number): { all: SegMetrics; withoutBorder: SegMetrics } {
  if (width < 1 || height < 1 || gt.length !== width * height || pred.length !== gt.length) throw new Error("Invalid label dimensions");
  const gSizes = new Map<number, number>(), pSizes = new Map<number, number>(), border = new Set<number>();
  const intersections = new Map<number, Map<number, number>>();
  for (let i = 0; i < gt.length; i++) {
    const g = gt[i], p = pred[i];
    if (g < 0 || p < 0) throw new Error("Negative labels are invalid");
    if (g) {
      gSizes.set(g, (gSizes.get(g) ?? 0) + 1);
      if (i < width || i >= width * (height - 1) || i % width === 0 || i % width === width - 1) border.add(g);
    }
    if (p) pSizes.set(p, (pSizes.get(p) ?? 0) + 1);
    if (g && p) {
      if (!intersections.has(g)) intersections.set(g, new Map());
      const row = intersections.get(g)!;
      row.set(p, (row.get(p) ?? 0) + 1);
    }
  }
  function evaluate(excludeBorder: boolean): SegMetrics {
    const gs = [...gSizes.keys()].filter(g => !excludeBorder || !border.has(g));
    const ignoredPred = new Set<number>();
    if (excludeBorder) {
      const withValid = new Set<number>();
      for (const g of gs) for (const p of intersections.get(g)?.keys() ?? []) withValid.add(p);
      for (const g of border) for (const p of intersections.get(g)?.keys() ?? []) if (!withValid.has(p)) ignoredPred.add(p);
    }
    const ps = [...pSizes.keys()].filter(p => !ignoredPred.has(p));
    const pairs: {g: number; p: number; iou: number}[] = [];
    for (const g of gs) for (const [p, count] of intersections.get(g) ?? []) {
      const iou = count / (gSizes.get(g)! + pSizes.get(p)! - count);
      if (iou >= 0.5) pairs.push({ g, p, iou });
    }
    pairs.sort((a, b) => b.iou - a.iou || a.g - b.g || a.p - b.p);
    const usedG = new Set<number>(), usedP = new Set<number>();
    let iouSum = 0;
    for (const pair of pairs) if (!usedG.has(pair.g) && !usedP.has(pair.p)) { usedG.add(pair.g); usedP.add(pair.p); iouSum += pair.iou; }
    let undersegmented = 0, oversegmented = 0;
    for (const p of ps) if (gs.filter(g => (intersections.get(g)?.get(p) ?? 0) / gSizes.get(g)! >= 0.2).length >= 2) undersegmented++;
    for (const g of gs) if ([...(intersections.get(g)?.values() ?? [])].filter(n => n / gSizes.get(g)! >= 0.2).length >= 2) oversegmented++;
    const tp = usedG.size, fp = ps.length - tp, fn = gs.length - tp;
    const precision = tp + fp ? tp / (tp + fp) : 0, recall = tp + fn ? tp / (tp + fn) : 0;
    return { tp, fp, fn, precision, recall, f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0, meanIoU: tp ? iouSum / tp : null, undersegmented, oversegmented };
  }
  return { all: evaluate(false), withoutBorder: evaluate(true) };
}
