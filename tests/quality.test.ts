import { describe, it, expect } from "vitest";
import {
  components,
  closeMask,
  screenCompleteCandidates,
  measureLabels,
} from "../src/engine";
import { confirmedEntry } from "../src/review";
import { DEFAULTS } from "../src/types";
import type { ImageEntry } from "../src/types";
function disk(m: Uint8Array, w: number, cx: number, cy: number, r: number) {
  for (let y = 0; y < m.length / w; y++)
    for (let x = 0; x < w; x++)
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) m[y * w + x] = 1;
}
describe("conservative completeness screening", () => {
  it("keeps an isolated disk as pending, removes border groups and corner annotation", () => {
    const w = 300,
      h = 200,
      m = new Uint8Array(w * h);
    disk(m, w, 80, 70, 25);
    disk(m, w, 0, 120, 30);
    for (let y = 188; y < 197; y++)
      for (let x = 255; x < 295; x++) m[y * w + x] = 1;
    const q = screenCompleteCandidates(components(m, w, h, 50, false), w, h);
    expect(q.objects).toHaveLength(1);
    expect(q.approvedIds).toEqual([]);
    expect(q.rejected).toHaveLength(2);
    expect(q.rejected!.some((r) => r.reasons.includes("角落标注区域"))).toBe(
      true,
    );
    expect(q.objects[0].solidity).toBeGreaterThan(0.94);
  });
  it("retains touching bodies with a review hint instead of inventing a split", () => {
    const w = 240,
      h = 150,
      m = new Uint8Array(w * h);
    disk(m, w, 85, 75, 33);
    disk(m, w, 144, 75, 33);
    const q = screenCompleteCandidates(components(m, w, h, 50, false), w, h);
    expect(q.objects).toHaveLength(1);
    expect(q.rejected).toHaveLength(0);
    expect(q.labels.some(Boolean)).toBe(true);
    expect(q.reviewHints?.[q.objects[0].id]).toContain("接触");
    expect(q.approvedIds).toEqual([]);
  });
  it("does not erase evidence that a component touches the boundary during closing", () => {
    const w = 90,
      h = 70,
      m = new Uint8Array(w * h);
    disk(m, w, 0, 30, 18);
    closeMask(m, w, h, 2);
    expect(components(m, w, h, 1, false).objects[0].border).toBe(true);
  });
  it("closes a tiny outline gap without filling a large separation", () => {
    const w = 70,
      h = 60,
      m = new Uint8Array(w * h);
    for (let y = 10; y < 45; y++)
      for (let x = 10; x < 40; x++)
        if (x < 13 || x >= 37 || y < 13 || y >= 42) m[y * w + x] = 1;
    m[10 * w + 24] = m[11 * w + 24] = m[12 * w + 24] = 0;
    closeMask(m, w, h, 1);
    expect(m[11 * w + 24]).toBe(1);
    expect(m[11 * w + 50]).toBe(0);
  });
});
describe("confirmed-only export gate", () => {
  function entry(): ImageEntry {
    const labels = new Int32Array(80 * 50);
    for (let y = 10; y < 25; y++)
      for (let x = 10; x < 20; x++) labels[y * 80 + x] = 1;
    for (let y = 10; y < 25; y++)
      for (let x = 40; x < 55; x++) labels[y * 80 + x] = 2;
    return {
      id: "fixture",
      name: "fixture.png",
      width: 80,
      height: 50,
      data: new Uint8ClampedArray(80 * 50 * 4),
      url: "",
      original: new Blob(),
      synthetic: true,
      params: { ...DEFAULTS },
      specimen: "",
      tissue: "",
      notes: { 1: "one", 2: "two" },
      undo: [],
      analysis: {
        labels,
        objects: measureLabels(labels, 80, 50),
        threshold: 0,
        approvedIds: [],
      },
    };
  }
  it("exports no objects without explicit review, including legacy projects", () => {
    const e = entry();
    delete e.analysis!.approvedIds;
    expect(confirmedEntry(e).analysis!.objects).toHaveLength(0);
    expect(confirmedEntry(e).analysis!.labels.some(Boolean)).toBe(false);
  });
  it("filters masks and notes consistently and leaves the working project unchanged", () => {
    const e = entry();
    e.analysis!.approvedIds = [2];
    const f = confirmedEntry(e);
    expect(f.analysis!.objects.map((o) => o.id)).toEqual([2]);
    expect(f.analysis!.labels.includes(1)).toBe(false);
    expect(f.notes).toEqual({ 2: "two" });
    expect(e.analysis!.labels.includes(1)).toBe(true);
  });
  it("cannot export a rejected or border object even if approval was imported", () => {
    const e = entry();
    e.analysis!.approvedIds = [1, 2];
    e.analysis!.rejected = [
      { id: 1, bbox: [10, 10, 10, 15], reasons: ["疑似遮挡"] },
    ];
    e.analysis!.objects[1].border = true;
    expect(confirmedEntry(e).analysis!.objects).toHaveLength(0);
  });
});
