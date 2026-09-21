import { describe, it, expect } from "vitest";
import {
  components,
  fillEnclosedHoles,
  measureLabels,
  segment,
  splitTouched,
  stroke,
} from "../src/engine";
import { DEFAULTS } from "../src/types";
const rect = (
  mask: Uint8Array,
  w: number,
  x: number,
  y: number,
  rw: number,
  rh: number,
) => {
  for (let yy = y; yy < y + rh; yy++)
    for (let xx = x; xx < x + rw; xx++) mask[yy * w + xx] = 1;
};
describe("independent instance geometry", () => {
  it("detects two rectangles, removes dust, measures full pixel-cell area and Feret", () => {
    const m = new Uint8Array(120 * 80);
    rect(m, 120, 10, 10, 40, 12);
    rect(m, 120, 70, 30, 12, 30);
    m[65] = 1;
    const a = components(m, 120, 80, 10, true);
    expect(a.objects).toHaveLength(2);
    expect(a.objects[0].area).toBe(480);
    expect(a.objects[0].bbox).toEqual([10, 10, 40, 12]);
    expect(a.objects[0].length).toBeCloseTo(Math.hypot(40, 12), 6);
  });
  it("excludes only border-touching components", () => {
    const m = new Uint8Array(60 * 50);
    rect(m, 60, 0, 2, 10, 10);
    rect(m, 60, 25, 10, 12, 12);
    expect(components(m, 60, 50, 5, true).objects).toHaveLength(1);
    expect(components(m, 60, 50, 5, false).objects).toHaveLength(2);
  });
  it("fills enclosed holes without bridging exterior gaps", () => {
    const m = new Uint8Array(40 * 40);
    rect(m, 40, 5, 5, 20, 20);
    for (let y = 10; y < 15; y++)
      for (let x = 10; x < 15; x++) m[y * 40 + x] = 0;
    fillEnclosedHoles(m, 40, 40);
    expect(m[12 * 40 + 12]).toBe(1);
    expect(m[0]).toBe(0);
    expect(components(m, 40, 40, 1, false).objects[0].area).toBe(400);
  });
  it("retains old IDs and splits only the cut object", () => {
    const m = new Uint8Array(100 * 60);
    rect(m, 100, 5, 5, 50, 20);
    rect(m, 100, 70, 35, 12, 12);
    const a = components(m, 100, 60, 1, false);
    stroke(a.labels, 100, 60, { x: 30, y: 0 }, { x: 30, y: 30 }, 1.5, 0);
    const split = splitTouched(a.labels, 100, 60, [1]);
    const objects = measureLabels(split, 100, 60);
    expect(objects).toHaveLength(3);
    expect(split[40 * 100 + 75]).toBe(2);
    expect(objects.map((o) => o.id)).toEqual([1, 2, 3]);
  });
  it("computes a circularity near one for a raster disk", () => {
    const labels = new Int32Array(150 * 150);
    for (let y = 0; y < 150; y++)
      for (let x = 0; x < 150; x++)
        if ((x - 75) ** 2 + (y - 75) ** 2 <= 40 ** 2) labels[y * 150 + x] = 1;
    const [o] = measureLabels(labels, 150, 150);
    expect(o.area).toBeGreaterThan(4900);
    expect(o.length).toBeGreaterThan(80);
    expect(o.length).toBeLessThan(83);
    expect(o.circularity).toBeGreaterThan(0.85);
    expect(o.circularity).toBeLessThanOrEqual(1);
  });
});
describe("light microscopy segmentation", () => {
  it("subtracts a lighting gradient and detects dark objects", () => {
    const w = 200,
      h = 100,
      data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const inside =
            (x >= 20 && x < 60 && y >= 35 && y < 50) ||
            (x >= 125 && x < 170 && y >= 60 && y < 72),
          v = 150 + x * 0.4 - (inside ? 100 : 0),
          i = (y * w + x) * 4;
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
      }
    const a = segment(data, w, h, {
      ...DEFAULTS,
      backgroundRadius: 18,
      minArea: 40,
    });
    expect(a.objects).toHaveLength(2);
    expect(a.objects[0].area).toBe(600);
    expect(a.objects[1].area).toBe(540);
  });
  it("supports bright foreground with fixed threshold", () => {
    const w = 40,
      h = 30,
      data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        data[i] =
          data[i + 1] =
          data[i + 2] =
            x >= 10 && x < 25 && y >= 10 && y < 20 ? 200 : 10;
        data[i + 3] = 255;
      }
    const a = segment(data, w, h, {
      ...DEFAULTS,
      polarity: "bright",
      backgroundRadius: 0,
      automatic: false,
      threshold: 100,
      minArea: 10,
    });
    expect(a.objects).toHaveLength(1);
    expect(a.objects[0].area).toBe(150);
  });
  it("returns zero objects for a uniform field", () => {
    const d = new Uint8ClampedArray(100 * 100 * 4).fill(220);
    const a = segment(d, 100, 100, DEFAULTS);
    expect(a.objects).toHaveLength(0);
  });
});
