// 距离地形的持久峰 + 标记控制分水岭。只重新分配可见前景，不补画遮挡部分。
export type SplitSettings = {
  prominence: number;
  minRadiusRatio: number;
  maxAspect: number;
  minArea: number;
};
export type SplitResult = {
  labels: Int32Array;
  count: number;
  seeds: { x: number; y: number; radius: number; prominence: number }[];
  reason: string;
};
export function splitMask(
  mask: Uint8Array,
  w: number,
  h: number,
  p: SplitSettings,
): SplitResult {
  const n = mask.length,
    d = new Int32Array(n),
    parent = new Int32Array(n),
    peak = new Int32Array(n),
    next = new Int32Array(n);
  parent.fill(-1);
  next.fill(-1);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mask[i])
        d[i] = Math.min(
          d[i - 1] + 3,
          d[i - w] + 3,
          d[i - w - 1] + 4,
          d[i - w + 1] + 4,
        );
    }
  let max = 0;
  for (let y = h - 2; y > 0; y--)
    for (let x = w - 2; x > 0; x--) {
      const i = y * w + x;
      if (mask[i])
        d[i] = Math.min(
          d[i],
          d[i + 1] + 3,
          d[i + w] + 3,
          d[i + w - 1] + 4,
          d[i + w + 1] + 4,
        );
      max = Math.max(max, d[i]);
    }
  const single = (reason: string): SplitResult => ({
    labels: Int32Array.from(mask, (v) => (v ? 1 : 0)),
    count: 1,
    seeds: [],
    reason,
  });
  if (max < 6) return single("目标过细");
  const heads = new Int32Array(max + 1);
  heads.fill(-1);
  for (let i = n - 1; i >= 0; i--)
    if (d[i]) {
      next[i] = heads[d[i]];
      heads[d[i]] = i;
    }
  const root = (a: number) => {
    let r = a;
    while (parent[r] !== r) r = parent[r];
    while (parent[a] !== a) {
      const b = parent[a];
      parent[a] = r;
      a = b;
    }
    return r;
  };
  const peaks: { index: number; height: number; prominence: number }[] = [];
  const neighbors = [-w - 1, -w, -w + 1, -1, 1, w - 1, w, w + 1];
  let highest = 0;
  for (let level = max; level > 0; level--)
    for (let i = heads[level]; i >= 0; i = next[i]) {
      parent[i] = i;
      peak[i] = i;
      if (d[i] > d[highest]) highest = i;
      for (const off of neighbors) {
        const j = i + off;
        if (j < 0 || j >= n || parent[j] < 0) continue;
        let a = root(i),
          b = root(j);
        if (a === b) continue;
        if (
          d[peak[a]] < d[peak[b]] ||
          (d[peak[a]] === d[peak[b]] && peak[a] > peak[b])
        )
          [a, b] = [b, a];
        const low = peak[b],
          height = d[low],
          prom = (height - level) / height;
        if (
          prom >= p.prominence &&
          height >= max * p.minRadiusRatio &&
          height >= 6
        )
          peaks.push({ index: low, height, prominence: prom });
        parent[b] = a;
      }
    }
  peaks.push({ index: highest, height: max, prominence: 1 });
  peaks.sort((a, b) => a.index - b.index);
  if (peaks.length < 2) return single("未发现足够窄的接触颈部");
  if (peaks.length > 16) return single("峰数量过多，保留人工处理");
  const labels = new Int32Array(n),
    tails = new Int32Array(max + 1);
  heads.fill(-1);
  tails.fill(-1);
  next.fill(-1);
  const enqueue = (i: number, level: number) => {
    if (tails[level] >= 0) next[tails[level]] = i;
    else heads[level] = i;
    tails[level] = i;
    next[i] = -1;
  };
  peaks.forEach((pk, k) => {
    labels[pk.index] = k + 1;
    enqueue(pk.index, pk.height);
  });
  for (let level = max; level > 0; level--)
    while (heads[level] >= 0) {
      const i = heads[level];
      heads[level] = next[i];
      if (heads[level] < 0) tails[level] = -1;
      for (const off of neighbors) {
        const j = i + off;
        if (j < 0 || j >= n || !d[j] || labels[j]) continue;
        labels[j] = labels[i];
        enqueue(j, Math.min(level, d[j]));
      }
    }
  const sizes = new Int32Array(peaks.length + 1);
  for (const v of labels) sizes[v]++;
  if ([...sizes.slice(1)].some((size) => size < p.minArea))
    return single("子对象小于最小面积，撤回切分");
  return {
    labels,
    count: peaks.length,
    seeds: peaks.map((pk) => ({
      x: pk.index % w,
      y: Math.floor(pk.index / w),
      radius: pk.height / 3,
      prominence: pk.prominence,
    })),
    reason: "auto-watershed-visible-foreground",
  };
}
