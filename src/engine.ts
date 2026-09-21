import type { Analysis, Parameters, Point, Sclerite } from "./types";
import { splitMask } from "./autosplit.ts";

// 局部均值用于扣除光镜照明梯度，积分图使计算量不随窗口大小增长。
export function foregroundSignal(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  p: Parameters,
): Uint8Array {
  const n = w * h,
    gray = new Uint8Array(n),
    signal = new Uint8Array(n);
  for (let i = 0; i < n; i++)
    gray[i] = Math.round(
      0.2126 * rgba[i * 4] +
        0.7152 * rgba[i * 4 + 1] +
        0.0722 * rgba[i * 4 + 2],
    );
  if (!p.backgroundRadius) {
    for (let i = 0; i < n; i++)
      signal[i] = p.polarity === "dark" ? 255 - gray[i] : gray[i];
    return signal;
  }
  const stride = w + 1,
    integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let sum = 0;
    for (let x = 0; x < w; x++) {
      sum += gray[y * w + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + sum;
    }
  }
  const r = p.backgroundRadius;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r),
        x1 = Math.min(w, x + r + 1),
        y0 = Math.max(0, y - r),
        y1 = Math.min(h, y + r + 1);
      const mean =
        (integral[y1 * stride + x1] -
          integral[y0 * stride + x1] -
          integral[y1 * stride + x0] +
          integral[y0 * stride + x0]) /
        ((x1 - x0) * (y1 - y0));
      signal[y * w + x] = Math.max(
        0,
        Math.min(
          255,
          Math.round(
            p.polarity === "dark"
              ? mean - gray[y * w + x]
              : gray[y * w + x] - mean,
          ),
        ),
      );
    }
  return signal;
}

export function otsu(signal: Uint8Array): number {
  const hist = new Uint32Array(256);
  for (const v of signal) hist[v]++;
  let total = 0;
  for (let i = 0; i < 256; i++) total += i * hist[i];
  let sum = 0,
    count = 0,
    best = -1,
    threshold = 0;
  for (let i = 0; i < 255; i++) {
    count += hist[i];
    sum += i * hist[i];
    if (!count) continue;
    if (count === signal.length) break;
    const a = sum / count,
      b = (total - sum) / (signal.length - count),
      score = count * (signal.length - count) * (a - b) ** 2;
    if (score > best) {
      best = score;
      threshold = i;
    }
  }
  return threshold;
}

export function fillEnclosedHoles(
  mask: Uint8Array,
  w: number,
  h: number,
): void {
  const seen = new Uint8Array(mask.length),
    queue = new Int32Array(mask.length);
  let head = 0,
    tail = 0;
  const add = (i: number) => {
    if (!mask[i] && !seen[i]) {
      seen[i] = 1;
      queue[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    add(x);
    add((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    add(y * w);
    add(y * w + w - 1);
  }
  while (head < tail) {
    const i = queue[head++],
      x = i % w;
    if (x) add(i - 1);
    if (x < w - 1) add(i + 1);
    if (i >= w) add(i - w);
    if (i < mask.length - w) add(i + w);
  }
  for (let i = 0; i < mask.length; i++) if (!mask[i] && !seen[i]) mask[i] = 1;
}

function cross(o: Point, a: Point, b: Point) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}
function convexHull(points: Point[]): Point[] {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: Point[] = [],
    upper: Point[] = [];
  for (const p of points) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    )
      lower.pop();
    lower.push(p);
  }
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    )
      upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

// 在像素单元的外边界上求凸包；长度为最大Feret径，宽度为其垂直投影宽。
function feret(hull: Point[]): [number, number] {
  if (hull.length < 2) return [1, 1];
  let j = 1,
    best = 0,
    dx = 1,
    dy = 0;
  const consider = (a: Point, b: Point) => {
    const x = b.x - a.x,
      y = b.y - a.y,
      d = x * x + y * y;
    if (d > best) {
      best = d;
      dx = x;
      dy = y;
    }
  };
  for (let i = 0; i < hull.length; i++) {
    const next = (i + 1) % hull.length;
    while (
      Math.abs(cross(hull[i], hull[next], hull[(j + 1) % hull.length])) >
      Math.abs(cross(hull[i], hull[next], hull[j])) + 1e-9
    )
      j = (j + 1) % hull.length;
    consider(hull[i], hull[j]);
    consider(hull[next], hull[j]);
  }
  const length = Math.sqrt(best);
  let min = Infinity,
    max = -Infinity;
  for (const p of hull) {
    const v = (-dy * p.x + dx * p.y) / length;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return [length, max - min];
}

export function measureLabels(
  labels: Int32Array,
  w: number,
  h: number,
): Sclerite[] {
  const stats = new Map<
    number,
    {
      area: number;
      sx: number;
      sy: number;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      boundary: Point[];
      perimeter: number;
    }
  >();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        id = labels[i];
      if (!id) continue;
      let s = stats.get(id);
      if (!s) {
        s = {
          area: 0,
          sx: 0,
          sy: 0,
          x0: x,
          y0: y,
          x1: x,
          y1: y,
          boundary: [],
          perimeter: 0,
        };
        stats.set(id, s);
      }
      s.area++;
      s.sx += x + 0.5;
      s.sy += y + 0.5;
      s.x0 = Math.min(s.x0, x);
      s.y0 = Math.min(s.y0, y);
      s.x1 = Math.max(s.x1, x);
      s.y1 = Math.max(s.y1, y);
      if (
        x === 0 ||
        x === w - 1 ||
        y === 0 ||
        y === h - 1 ||
        labels[i - 1] !== id ||
        labels[i + 1] !== id ||
        labels[i - w] !== id ||
        labels[i + w] !== id
      ) {
        s.boundary.push(
          { x, y },
          { x: x + 1, y },
          { x, y: y + 1 },
          { x: x + 1, y: y + 1 },
        );
      }
    }
  // Marching-squares周长，保留独立实例之间的边界。
  for (let y = -1; y < h; y++)
    for (let x = -1; x < w; x++) {
      const get = (xx: number, yy: number) =>
        xx < 0 || yy < 0 || xx >= w || yy >= h ? 0 : labels[yy * w + xx];
      const cells = [
        get(x, y),
        get(x + 1, y),
        get(x + 1, y + 1),
        get(x, y + 1),
      ];
      if (
        cells[0] === cells[1] &&
        cells[1] === cells[2] &&
        cells[2] === cells[3]
      )
        continue;
      const ids = new Set(cells);
      ids.delete(0);
      for (const id of ids) {
        const bits = cells.map((v) => v === id),
          n = bits.filter(Boolean).length;
        stats.get(id)!.perimeter +=
          n === 1 || n === 3
            ? Math.SQRT1_2
            : n === 2
              ? bits[0] === bits[2]
                ? Math.SQRT2
                : 1
              : 0;
      }
    }
  return [...stats]
    .sort((a, b) => a[0] - b[0])
    .map(([id, s]) => {
      const hull = convexHull(s.boundary);
      const [length, width] = feret(hull);
      const hullArea =
        Math.abs(
          hull.reduce((sum, a, i) => {
            const b = hull[(i + 1) % hull.length];
            return sum + a.x * b.y - a.y * b.x;
          }, 0),
        ) / 2;
      return {
        id,
        area: s.area,
        perimeter: s.perimeter,
        length,
        width,
        aspect: length / width,
        circularity: Math.min(
          1,
          (4 * Math.PI * s.area) / (s.perimeter * s.perimeter),
        ),
        cx: s.sx / s.area,
        cy: s.sy / s.area,
        bbox: [s.x0, s.y0, s.x1 - s.x0 + 1, s.y1 - s.y0 + 1],
        border: s.x0 === 0 || s.y0 === 0 || s.x1 === w - 1 || s.y1 === h - 1,
        solidity: hullArea ? Math.min(1, s.area / hullArea) : 0,
      };
    });
}

export function components(
  mask: Uint8Array,
  w: number,
  h: number,
  minArea: number,
  excludeBorder: boolean,
): Analysis {
  const labels = new Int32Array(mask.length),
    queue = new Int32Array(mask.length);
  let nextId = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || labels[i]) continue;
    let head = 0,
      tail = 1,
      border = false;
    queue[0] = i;
    labels[i] = -1;
    while (head < tail) {
      const at = queue[head++],
        x = at % w,
        y = Math.floor(at / w);
      border ||= x === 0 || y === 0 || x === w - 1 || y === h - 1;
      for (let yy = Math.max(0, y - 1); yy <= Math.min(h - 1, y + 1); yy++)
        for (let xx = Math.max(0, x - 1); xx <= Math.min(w - 1, x + 1); xx++) {
          const ni = yy * w + xx;
          if (mask[ni] && !labels[ni]) {
            labels[ni] = -1;
            queue[tail++] = ni;
          }
        }
    }
    const id = tail >= minArea && !(excludeBorder && border) ? ++nextId : -1;
    for (let k = 0; k < tail; k++) labels[queue[k]] = id;
  }
  for (let i = 0; i < labels.length; i++) if (labels[i] < 0) labels[i] = 0;
  return { labels, objects: measureLabels(labels, w, h), threshold: 0 };
}

export function segment(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  p: Parameters,
): Analysis {
  const signal = foregroundSignal(data, w, h, p),
    threshold = p.automatic ? otsu(signal) : p.threshold;
  const mask = Uint8Array.from(signal, (v) => (v > threshold ? 1 : 0));
  if (p.closingRadius) closeMask(mask, w, h, p.closingRadius);
  if (p.fillHoles) fillEnclosedHoles(mask, w, h);
  const analysis = {
    ...components(
      mask,
      w,
      h,
      p.minArea,
      p.completeOnly ? false : p.excludeBorder,
    ),
    threshold,
    approvedIds: [],
  };
  const screened = p.completeOnly
    ? screenCompleteCandidates(analysis, w, h, data)
    : analysis;
  return p.autoSplit ? autoSplitAnalysis(screened, w, h, p) : screened;
}

export function autoSplitAnalysis(
  a: Analysis,
  w: number,
  h: number,
  p: Parameters,
  onlyIds?: number[],
): Analysis {
  const labels = a.labels.slice(),
    hints = { ...a.reviewHints },
    events: NonNullable<Analysis["splitEvents"]> = [];
  let nextId = Math.max(
    0,
    ...a.objects.map((o) => o.id),
    ...(a.rejected ?? []).map((o) => o.id),
  );
  for (const o of a.objects) {
    if (onlyIds && !onlyIds.includes(o.id)) continue;
    // 截断与极细长对象不自动拆开；防止把一枚带刺长骨针切成多段。
    if (o.border || o.aspect > 3) continue;
    const [ox, oy, bw, bh] = o.bbox,
      rw = bw + 2,
      rh = bh + 2,
      mask = new Uint8Array(rw * rh);
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++)
        if (a.labels[(oy + y) * w + ox + x] === o.id)
          mask[(y + 1) * rw + x + 1] = 1;
    const r = splitMask(mask, rw, rh, {
      prominence: p.splitProminence,
      minRadiusRatio: p.splitRadiusRatio,
      minArea: p.minArea,
      maxAspect: 3,
    });
    if (r.count < 2) continue;
    const ids = [o.id, ...Array.from({ length: r.count - 1 }, () => ++nextId)];
    for (let y = 0; y < bh; y++)
      for (let x = 0; x < bw; x++) {
        const v = r.labels[(y + 1) * rw + x + 1];
        if (v) labels[(oy + y) * w + ox + x] = ids[v - 1];
      }
    for (const id of ids)
      hints[id] = `自动切分自 #${o.id}；切分边界待复核，不保证完整`;
    events.push({
      parentId: o.id,
      childIds: ids,
      prominence: p.splitProminence,
      radiusRatio: p.splitRadiusRatio,
      seeds: r.seeds.map((s) => ({ ...s, x: s.x + ox - 1, y: s.y + oy - 1 })),
    });
  }
  return {
    ...a,
    labels,
    objects: measureLabels(labels, w, h),
    reviewHints: hints,
    approvedIds: [],
    splitEvents: [...(a.splitEvents ?? []), ...events],
  };
}

// 小尺度闭运算只闭合细小轮廓缺口；不能重建遮挡区域。
export function closeMask(
  mask: Uint8Array,
  w: number,
  h: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(4, Math.floor(radius)));
  if (!r) return;
  const pass = (input: Uint8Array, horizontal: boolean, dilate: boolean) => {
    const output = new Uint8Array(input.length);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let value = dilate ? 0 : 1;
        for (let k = -r; k <= r; k++) {
          const xx = horizontal ? Math.max(0, Math.min(w - 1, x + k)) : x;
          const yy = horizontal ? y : Math.max(0, Math.min(h - 1, y + k));
          if (dilate ? input[yy * w + xx] === 1 : input[yy * w + xx] === 0) {
            value = dilate ? 1 : 0;
            break;
          }
        }
        output[y * w + x] = value;
      }
    return output;
  };
  mask.set(
    pass(
      pass(pass(pass(mask, true, true), false, true), true, false),
      false,
      false,
    ),
  );
}

// 距离变换内核分裂只能提示粘连，不能证明遮挡；天然分叶骨针也可能被保守排除。
function separatedCores(labels: Int32Array, w: number, o: Sclerite): boolean {
  const [ox, oy, bw, bh] = o.bbox;
  const step = Math.max(1, Math.ceil(Math.max(bw, bh) / 180));
  const cw = Math.ceil(bw / step) + 2,
    ch = Math.ceil(bh / step) + 2,
    d = new Float32Array(cw * ch);
  for (let y = 1; y < ch - 1; y++)
    for (let x = 1; x < cw - 1; x++)
      if (
        labels[
          (oy + Math.min(bh - 1, (y - 1) * step)) * w +
            ox +
            Math.min(bw - 1, (x - 1) * step)
        ] === o.id
      )
        d[y * cw + x] = 1e6;
  for (let y = 1; y < ch - 1; y++)
    for (let x = 1; x < cw - 1; x++) {
      const i = y * cw + x;
      if (d[i])
        d[i] = Math.min(
          d[i],
          d[i - 1] + 1,
          d[i - cw] + 1,
          d[i - cw - 1] + Math.SQRT2,
          d[i - cw + 1] + Math.SQRT2,
        );
    }
  let max = 0;
  for (let y = ch - 2; y > 0; y--)
    for (let x = cw - 2; x > 0; x--) {
      const i = y * cw + x;
      if (d[i])
        d[i] = Math.min(
          d[i],
          d[i + 1] + 1,
          d[i + cw] + 1,
          d[i + cw + 1] + Math.SQRT2,
          d[i + cw - 1] + Math.SQRT2,
        );
      max = Math.max(max, d[i]);
    }
  if (max < 4) return false;
  const seen = new Uint8Array(d.length),
    queue = new Int32Array(d.length),
    sizes: number[] = [];
  for (let i = 0; i < d.length; i++)
    if (!seen[i] && d[i] >= max * 0.7) {
      let head = 0,
        tail = 1;
      queue[0] = i;
      seen[i] = 1;
      while (head < tail) {
        const at = queue[head++],
          x = at % cw,
          y = Math.floor(at / cw);
        for (let yy = y - 1; yy <= y + 1; yy++)
          for (let xx = x - 1; xx <= x + 1; xx++) {
            if (xx < 0 || yy < 0 || xx >= cw || yy >= ch) continue;
            const j = yy * cw + xx;
            if (!seen[j] && d[j] >= max * 0.7) {
              seen[j] = 1;
              queue[tail++] = j;
            }
          }
      }
      sizes.push(tail);
    }
  sizes.sort((a, b) => b - a);
  return sizes.length > 1 && sizes[1] >= Math.max(8, sizes[0] * 0.2);
}

export function screenCompleteCandidates(
  analysis: Analysis,
  w: number,
  h: number,
  data?: Uint8ClampedArray,
): Analysis {
  const rejected: NonNullable<Analysis["rejected"]> = [];
  const keep = new Set<number>();
  const reviewHints: Record<string, string> = {};
  for (const o of analysis.objects) {
    const [x, y, bw, bh] = o.bbox,
      reasons: string[] = [];
    // 接近边缘的整组对象丢弃，避免把与截断物接触的内部部分当作完整骨针。
    if (x <= 4 || y <= 4 || x + bw >= w - 4 || y + bh >= h - 4)
      reasons.push("贴边或截断");
    if (
      y + bh > h * 0.965 &&
      (x > w * 0.8 || x + bw < w * 0.2) &&
      bh < h * 0.08
    )
      reasons.push("角落标注区域");
    // 轮廓凹陷与多内核不能区分天然分叶和接触：保留，交由用户复核。
    if (
      o.solidity < (o.aspect >= 3 ? 0.68 : 0.8) ||
      separatedCores(analysis.labels, w, o)
    )
      reviewHints[o.id] = "多叶/接触待复核；未拆分时测量整个组合";
    if (!reasons.length && data) {
      let contrast = 0,
        samples = 0;
      const gray = (i: number) =>
        0.2126 * data[i * 4] +
        0.7152 * data[i * 4 + 1] +
        0.0722 * data[i * 4 + 2];
      for (let yy = y; yy < y + bh; yy += 2)
        for (let xx = x; xx < x + bw; xx += 2) {
          const i = yy * w + xx;
          if (analysis.labels[i] !== o.id) continue;
          for (const [dx, dy] of [
            [-1, 0],
            [1, 0],
            [0, -1],
            [0, 1],
          ]) {
            const nx = xx + dx,
              ny = yy + dy;
            if (
              nx < 0 ||
              ny < 0 ||
              nx >= w ||
              ny >= h ||
              analysis.labels[ny * w + nx] === o.id
            )
              continue;
            const outside =
              Math.max(0, Math.min(h - 1, yy + dy * 5)) * w +
              Math.max(0, Math.min(w - 1, xx + dx * 5));
            const inside =
              Math.max(0, Math.min(h - 1, yy - dy * 2)) * w +
              Math.max(0, Math.min(w - 1, xx - dx * 2));
            contrast += Math.abs(gray(outside) - gray(inside));
            samples++;
          }
        }
      if (samples && contrast / samples < 12)
        reasons.push("边缘低对比或疑似失焦");
    }
    if (reasons.length) rejected.push({ id: o.id, bbox: o.bbox, reasons });
    else keep.add(o.id);
  }
  const labels = analysis.labels.slice();
  for (let i = 0; i < labels.length; i++)
    if (!keep.has(labels[i])) labels[i] = 0;
  return {
    ...analysis,
    labels,
    objects: analysis.objects.filter((o) => keep.has(o.id)),
    approvedIds: [],
    reviewHints,
    rejected: [...(analysis.rejected ?? []), ...rejected],
  };
}

export function stroke(
  labels: Int32Array,
  w: number,
  h: number,
  a: Point,
  b: Point,
  r: number,
  id: number,
) {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let s = 0; s <= steps; s++) {
    const cx = a.x + ((b.x - a.x) * s) / steps,
      cy = a.y + ((b.y - a.y) * s) / steps;
    for (
      let y = Math.max(0, Math.floor(cy - r));
      y <= Math.min(h - 1, Math.ceil(cy + r));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(cx - r));
        x <= Math.min(w - 1, Math.ceil(cx + r));
        x++
      )
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) labels[y * w + x] = id;
  }
}

// 只拆分被切线触及的对象；其他对象ID不变，测量与人工标签保持对应。
export function splitTouched(
  labels: Int32Array,
  w: number,
  h: number,
  ids: number[],
): Int32Array {
  const output = labels.slice();
  let next = 0;
  for (const id of labels) next = Math.max(next, id);
  for (const id of ids) {
    const parts = components(
      Uint8Array.from(labels, (v) => (v === id ? 1 : 0)),
      w,
      h,
      1,
      false,
    );
    if (parts.objects.length < 2) continue;
    const largest = parts.objects.reduce((a, b) =>
      a.area > b.area ? a : b,
    ).id;
    const mapping = new Map(
      parts.objects.map((o) => [o.id, o.id === largest ? id : ++next]),
    );
    for (let i = 0; i < output.length; i++)
      if (parts.labels[i]) output[i] = mapping.get(parts.labels[i])!;
  }
  return output;
}
