import { describe, expect, it } from "vitest";
import { historyBytes, packLabels, pushHistory, restore, snapshot, unpackLabels } from "../src/history";
import fixtures from "./fixtures/mr0145-split.json";

describe("compressed history", () => {
  it("round trips empty, zero, signed, maximum and mixed labels", () => {
    for (const values of [[], [0], [0, 0, 1, 1, 2147483647, -1], Array.from({ length: 8192 }, (_, i) => (i * 997) % 37)]) {
      const input = Int32Array.from(values);
      expect(unpackLabels(packLabels(input))).toEqual(input);
      expect(packLabels(input)).toBe(packLabels(input));
    }
  });
  it("round trips real microscopy masks", () => {
    for (const fixture of fixtures) {
      const labels = new Int32Array(fixture.w * fixture.h);
      let offset = 0, value = 0;
      for (const run of fixture.rle) { labels.fill(value, offset, offset + run); offset += run; value = 1 - value; }
      expect(offset).toBe(labels.length);
      const restored = unpackLabels(packLabels(labels));
      expect(restored.every((value, index) => value === labels[index])).toBe(true);
    }
  });
  it("compresses sparse images and reuses shared snapshots", () => {
    const labels = new Int32Array(4000 * 3000);
    for (let i = 0; i < 20; i++) for (let y = i * 100; y < i * 100 + 50; y++) labels.fill(i + 1, y * 4000 + 100, y * 4000 + 200);
    const analysis = { labels, objects: [], threshold: 0 }, notes = {};
    const a = snapshot(analysis, notes), b = snapshot({ ...analysis }, notes);
    expect(a.packed).toBe(b.packed);
    expect(historyBytes([a, b])).toBeLessThan(labels.byteLength * 0.01);
    const restored = unpackLabels(a.packed);
    expect(restored.every((value, index) => value === labels[index])).toBe(true);
  });
  it("preserves identity when restored once through undo and redo", () => {
    const a = { labels: Int32Array.of(1), objects: [], threshold: 0 };
    const b = { labels: Int32Array.of(2), objects: [], threshold: 1 };
    const notes = {};
    let undo = pushHistory([], snapshot(a, notes), 5);
    const prior = restore(undo.at(-1)!);
    const expected = prior.analysis;
    const future = snapshot(b, notes);
    undo = undo.slice(0, -1);
    expect(prior.analysis).toBe(expected);
    const next = restore(future);
    undo = pushHistory(undo, snapshot(prior.analysis, prior.notes), 20);
    expect(restore(undo.at(-1)!).analysis.labels).toEqual(a.labels);
    expect(next.analysis.labels).toEqual(b.labels);
  });
});
