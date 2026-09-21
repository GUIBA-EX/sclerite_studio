import { describe, it, expect } from "vitest";
import { layoutOriginal, pageScales } from "../src/plateLayout";
import { rotatedSize, DEFAULT_PLATE_SETTINGS, parsePlate } from "../src/plate";
import type { PlateItem } from "../src/plate";
const item: PlateItem = {
  key: "a",
  image: "data:image/png;base64,AAAA",
  sourceName: "a.jpg",
  sourceId: "a",
  instanceId: 1,
  sourceWidth: 200,
  sourceHeight: 100,
  reviewHint: "",
  x: 0,
  y: 0,
  width: 200,
  height: 100,
  angle: 0,
  label: "A-1",
};
describe("original-size joint layout", () => {
  it("preserves original pixel sizes rather than filling individual cells", () => {
    const r = layoutOriginal(
      [item, { ...item, key: "b", sourceWidth: 800, sourceHeight: 400 }],
      DEFAULT_PLATE_SETTINGS,
    );
    expect(r[0].width).toBe(100);
    expect(r[1].width).toBe(400);
    const bars = pageScales(r).bars;
    expect(bars).toHaveLength(1);
    expect(bars[0].label).toContain("px");
    expect(bars[0].length / parseFloat(bars[0].label)).toBeCloseTo(0.5);
  });
  it("uses common physical scale across differently calibrated photos", () => {
    const r = layoutOriginal(
      [
        { ...item, umPerPixel: 0.5 },
        { ...item, key: "b", sourceId: "b", umPerPixel: 2 },
      ],
      DEFAULT_PLATE_SETTINGS,
    );
    expect(r[1].width / r[0].width).toBeCloseTo(4);
    const b = pageScales(r).bars[0];
    expect(b.label).toContain("μm");
    expect(b.length / parseFloat(b.label)).toBeCloseTo(
      r[0].width / (r[0].sourceWidth * 0.5),
    );
  });
  it("separates calibrated and uncalibrated sources, never inventing micrometers", () => {
    const r = layoutOriginal(
      [
        { ...item, umPerPixel: 0.5 },
        { ...item, key: "b", sourceId: "b" },
      ],
      DEFAULT_PLATE_SETTINGS,
    );
    expect(r[0].page).not.toBe(r[1].page);
    expect(pageScales([r[1]]).bars[0].label).toContain("px");
  });
  it("paginates 200 objects without loss, overlap, per-page resizing or footer intrusion", () => {
    const input = Array.from({ length: 200 }, (_, n) => ({
      ...item,
      key: String(n),
      sourceId: String(n % 7),
      instanceId: n + 1,
      sourceWidth: 180 + (n % 11) * 20,
      sourceHeight: 80 + (n % 9) * 40,
      angle: n % 90,
    }));
    for (const grouped of [true, false]) {
      const r = layoutOriginal(input, {
        ...DEFAULT_PLATE_SETTINGS,
        groupBySource: grouped,
      });
      expect(r).toHaveLength(200);
      expect(new Set(r.map((i) => i.page)).size).toBeGreaterThan(1);
      for (const i of r) {
        expect(i.width / i.sourceWidth).toBeCloseTo(0.5);
        const b = rotatedSize(i);
        expect(i.x - b.width / 2).toBeGreaterThanOrEqual(31.9999);
        expect(i.y + b.height / 2 + 56).toBeLessThanOrEqual(744.001);
      }
      for (let n = 0; n < r.length; n++)
        for (let m = n + 1; m < r.length; m++)
          if (r[n].page === r[m].page) {
            const a = r[n],
              b = r[m],
              as = rotatedSize(a),
              bs = rotatedSize(b);
            const separated =
              Math.abs(a.x - b.x) >=
                (Math.max(80, as.width) + Math.max(80, bs.width)) / 2 - 1e-6 ||
              a.y + as.height / 2 + 56 <= b.y - bs.height / 2 ||
              b.y + bs.height / 2 + 56 <= a.y - as.height / 2;
            expect(separated).toBe(true);
          }
    }
  });
  it("shrinks an oversized item only with its entire unit group", () => {
    const r = layoutOriginal(
      [item, { ...item, key: "big", sourceWidth: 10000, sourceHeight: 5000 }],
      DEFAULT_PLATE_SETTINGS,
    );
    expect(r[0].width / item.sourceWidth).toBeCloseTo(r[1].width / 10000);
    expect(r[0].width / item.sourceWidth).toBeLessThan(0.5);
  });
  it("switches to truthful object bars after manual scaling", () => {
    const r = layoutOriginal(
      [
        { ...item, umPerPixel: 0.5 },
        { ...item, key: "b", umPerPixel: 0.5 },
      ],
      DEFAULT_PLATE_SETTINGS,
    );
    r[1] = { ...r[1], width: r[1].width * 2, height: r[1].height * 2 };
    const bars = pageScales(r).bars;
    expect(bars).toHaveLength(2);
    for (let n = 0; n < 2; n++)
      expect(bars[n].length / parseFloat(bars[n].label)).toBeCloseTo(
        r[n].width / (r[n].sourceWidth * 0.5),
      );
    expect(pageScales(r, false).bars).toHaveLength(0);
  });
  it("validates pages and preserves saved settings", () => {
    const p = {
      schema: "sclerite-plate/1",
      width: 1200,
      height: 900,
      items: [{ ...item, page: 2 }],
      settings: DEFAULT_PLATE_SETTINGS,
    };
    expect(parsePlate(p).items[0].page).toBe(2);
    const { showSourceNotes: _legacyMissing, ...legacySettings } =
      DEFAULT_PLATE_SETTINGS;
    expect(
      parsePlate({ ...p, settings: legacySettings }).settings?.showSourceNotes,
    ).toBe(true);
    expect(
      parsePlate({
        ...p,
        settings: { ...legacySettings, showSourceNotes: false },
      }).settings?.showSourceNotes,
    ).toBe(false);
    expect(() =>
      parsePlate({
        ...p,
        settings: { ...legacySettings, showSourceNotes: "false" },
      }),
    ).toThrow();
    expect(() => parsePlate({ ...p, items: [{ ...item, page: 0 }] })).toThrow();
    expect(() =>
      parsePlate({ ...p, settings: { sizeMode: "fake" } }),
    ).toThrow();
  });
});
