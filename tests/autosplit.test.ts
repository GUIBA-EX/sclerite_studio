import { describe, it, expect } from "vitest";
import { splitMask } from "../src/autosplit";
import { autoSplitAnalysis, components } from "../src/engine";
import { DEFAULTS } from "../src/types";
import fixtures from "./fixtures/mr0145-split.json";
const params = {
  prominence: 0.3,
  minRadiusRatio: 0.25,
  minArea: 100,
  maxAspect: 3,
};
describe("marker-controlled contact splitting", () => {
  it("partitions touching disks without adding or deleting visible foreground", () => {
    const w = 150,
      h = 100,
      m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (
          (x - 50) ** 2 + (y - 50) ** 2 < 25 ** 2 ||
          (x - 95) ** 2 + (y - 50) ** 2 < 25 ** 2
        )
          m[y * w + x] = 1;
    const r = splitMask(m, w, h, params);
    expect(r.count).toBe(2);
    for (let i = 0; i < m.length; i++)
      expect(Number(r.labels[i] > 0)).toBe(m[i]);
    expect(r.labels).toEqual(splitMask(m, w, h, params).labels);
    const a = components(m, w, h, 100, false),
      b = autoSplitAnalysis({ ...a, approvedIds: [1] }, w, h, {
        ...DEFAULTS,
        minArea: 100,
      });
    expect(b.objects).toHaveLength(2);
    expect(b.approvedIds).toEqual([]);
    expect(b.splitEvents?.[0].parentId).toBe(1);
    expect(b.splitEvents?.[0].childIds).toEqual([1, 2]);
  });
  it("does not auto-rescue a border contact group or split elongated objects", () => {
    const w = 120,
      h = 90,
      m = new Uint8Array(w * h);
    for (let y = 25; y < 50; y++)
      for (let x = 0; x < 100; x++) m[y * w + x] = 1;
    const a = components(m, w, h, 20, false),
      b = autoSplitAnalysis(a, w, h, { ...DEFAULTS, minArea: 20 });
    expect(b.labels).toEqual(a.labels);
    expect(b.splitEvents).toEqual([]);
  });
  it("rolls back a split if any child is smaller than the minimum", () => {
    const w = 150,
      h = 100,
      m = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (
          (x - 50) ** 2 + (y - 50) ** 2 < 25 ** 2 ||
          (x - 95) ** 2 + (y - 50) ** 2 < 25 ** 2
        )
          m[y * w + x] = 1;
    expect(splitMask(m, w, h, { ...params, minArea: 2500 }).count).toBe(1);
  });
  for (const f of fixtures)
    it(`real mask ${f.image} #${f.id}: ${f.expected} part(s), foreground preserved`, () => {
      const m = new Uint8Array(f.w * f.h);
      let index = 0,
        value = 0;
      for (const run of f.rle) {
        m.fill(value, index, index + run);
        index += run;
        value = 1 - value;
      }
      expect(index).toBe(m.length);
      const r = splitMask(m, f.w, f.h, { ...params, minArea: 1500 });
      expect(r.count).toBe(f.expected);
      let original = 0,
        after = 0;
      for (let i = 0; i < m.length; i++) {
        original += m[i];
        after += Number(r.labels[i] > 0);
        if (!m[i]) expect(r.labels[i]).toBe(0);
      }
      expect(after).toBe(original);
    });
});
