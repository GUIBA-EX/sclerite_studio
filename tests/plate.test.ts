import { describe, it, expect } from "vitest";
import {
  arrange,
  arrangeUniform,
  isUniform,
  moveItems,
  alignItems,
  constrainItem,
  parsePlate,
  maskAxis,
  uprightItem,
  rotatedSize,
} from "../src/plate";
import type { PlateItem } from "../src/plate";
const item: PlateItem = {
  key: "a",
  image: "data:image/png;base64,AAAA",
  sourceName: "x.png",
  sourceId: "x",
  instanceId: 1,
  sourceWidth: 100,
  sourceHeight: 80,
  reviewHint: "",
  x: 200,
  y: 200,
  width: 100,
  height: 80,
  angle: 0,
  label: "a",
};
describe("editable plate", () => {
  it("ignores invalid pointer deltas and rejects invalid saved coordinates", () => {
    const items = [item];
    expect(moveItems(items, ["a"], NaN, 10)).toBe(items);
    expect(moveItems(items, ["a"], 10, Infinity)).toBe(items);
    expect(() =>
      parsePlate({
        schema: "sclerite-plate/1",
        width: 1200,
        height: 900,
        items: [{ ...item, x: null }],
      }),
    ).toThrow();
  });
  it("estimates mask long axes independent of image brightness and rotates vertically", () => {
    for (const angle of [-70, -30, 0, 35, 89]) {
      const rgba = new Uint8ClampedArray(101 * 101 * 4),
        a = (angle * Math.PI) / 180;
      for (let y = 0; y < 101; y++)
        for (let x = 0; x < 101; x++) {
          const u = (x - 50) * Math.cos(a) + (y - 50) * Math.sin(a),
            v = -(x - 50) * Math.sin(a) + (y - 50) * Math.cos(a);
          if ((u * u) / 1600 + (v * v) / 64 <= 1)
            rgba[(y * 101 + x) * 4 + 3] = 255;
        }
      const axis = maskAxis(rgba, 101, 101);
      expect(Math.abs(axis.longAxisAngle - angle)).toBeLessThan(1);
      const straight = uprightItem({ ...item, ...axis });
      expect(
        Math.abs(
          Math.cos(((straight.angle + axis.longAxisAngle) * Math.PI) / 180),
        ),
      ).toBeLessThan(1e-10);
      const again = uprightItem(straight);
      expect(again.angle).toBe(straight.angle);
    }
  });
  it("does not invent stable axes for round or empty masks", () => {
    const rgba = new Uint8ClampedArray(51 * 51 * 4);
    expect(maskAxis(rgba, 51, 51).axisStrength).toBe(0);
    for (let y = 0; y < 51; y++)
      for (let x = 0; x < 51; x++)
        if ((x - 25) ** 2 + (y - 25) ** 2 <= 400)
          rgba[(y * 51 + x) * 4 + 3] = 255;
    const axis = maskAxis(rgba, 51, 51);
    expect(axis.axisStrength).toBeLessThan(0.12);
    expect(uprightItem({ ...item, angle: 32, ...axis }).angle).toBe(32);
  });
  it("keeps manual angles and fits rotated footprints and horizontal labels on the page", () => {
    const source = Array.from({ length: 20 }, (_, n) => ({
      ...item,
      key: String(n),
      sourceWidth: 120,
      sourceHeight: 600,
      angle: n * 17 - 170,
      umPerPixel: 0.5 + n / 10,
    }));
    for (const result of [arrange(source), arrangeUniform(source)]) {
      for (let n = 0; n < result.length; n++) {
        const i = result[n],
          box = rotatedSize(i);
        expect(i.angle).toBe(source[n].angle);
        expect(i.x - box.width / 2).toBeGreaterThanOrEqual(20);
        expect(i.x + box.width / 2).toBeLessThanOrEqual(1180);
        expect(i.y - box.height / 2).toBeGreaterThanOrEqual(20);
        expect(i.y + box.height / 2 + 36).toBeLessThanOrEqual(880);
      }
    }
    expect(isUniform(arrangeUniform(source))).toBe(true);
  });
  it("defaults old plates to white and validates persisted background and axes", () => {
    const p = {
      schema: "sclerite-plate/1",
      width: 1200,
      height: 900,
      items: [item],
    };
    expect(parsePlate(p).background).toBe("white");
    expect(parsePlate({ ...p, background: "black" }).background).toBe("black");
    expect(() => parsePlate({ ...p, background: "red" })).toThrow();
    expect(() =>
      parsePlate({ ...p, items: [{ ...item, longAxisAngle: NaN }] }),
    ).toThrow();
  });
  it("requires calibration and keeps a common physical display scale", () => {
    expect(() => arrangeUniform([item])).toThrow();
    const result = arrangeUniform([
      { ...item, umPerPixel: 0.5 },
      { ...item, key: "b", umPerPixel: 2 },
    ]);
    expect(isUniform(result)).toBe(true);
    expect(result[1].width / result[0].width).toBeCloseTo(4);
    expect(
      isUniform([{ ...result[0], width: result[0].width * 1.1 }, result[1]]),
    ).toBe(false);
  });
  it("moves a group without changing spacing at the page boundary", () => {
    const source = [item, { ...item, key: "b", x: 500 }];
    const moved = moveItems(source, ["a", "b"], 10000, -10000);
    expect(moved[1].x - moved[0].x).toBe(300);
    expect(moved[0].width).toBe(item.width);
    expect(moved[1].x + moved[1].width / 2).toBeLessThan(1200);
    expect(moved[0].y - moved[0].height / 2).toBeGreaterThan(0);
  });
  it("aligns and distributes only the selected objects", () => {
    const source = [
      item,
      { ...item, key: "b", x: 400, y: 250 },
      { ...item, key: "c", x: 800, y: 300 },
      { ...item, key: "d", x: 700 },
    ];
    const aligned = alignItems(source, ["a", "b", "c"], "align");
    expect(aligned.slice(0, 3).map((i) => i.y)).toEqual([250, 250, 250]);
    const spaced = alignItems(aligned, ["a", "b", "c"], "distribute");
    expect(spaced.slice(0, 3).map((i) => i.x)).toEqual([200, 500, 800]);
    expect(spaced[3]).toBe(source[3]);
  });
  it("centers a single object", () => {
    expect(arrange([item])[0].x).toBe(600);
  });
  it("arranges up to 200 objects without changing source geometry", () => {
    for (const n of [1, 2, 6, 30, 200]) {
      const a = arrange(
        Array.from({ length: n }, (_, i) => ({ ...item, key: String(i) })),
      );
      expect(a.length).toBe(n);
      for (const o of a) {
        expect(o.width).toBeGreaterThan(0);
        expect(o.height).toBeGreaterThan(0);
        expect(o.sourceWidth).toBe(100);
        expect(o.x - o.width / 2).toBeGreaterThanOrEqual(0);
        expect(o.y + o.height / 2 + 24).toBeLessThan(900);
      }
    }
  });
  it("constrains moved, rotated and oversized objects to the page", () => {
    const o = constrainItem({
      ...item,
      x: -500,
      y: 3000,
      width: 4000,
      height: 3200,
      angle: 90,
    });
    expect(o.x).toBeGreaterThan(0);
    expect(o.y).toBeLessThan(900);
    expect(o.height).toBeLessThan(1200);
  });
  it("validates format and rejects duplicate keys, external images and invalid dimensions", () => {
    const p = {
      schema: "sclerite-plate/1",
      width: 1200,
      height: 900,
      items: [item],
    };
    expect(parsePlate(p).items[0].label).toBe("a");
    expect(() => parsePlate({ ...p, items: [item, item] })).toThrow();
    expect(() =>
      parsePlate({
        ...p,
        items: [{ ...item, image: "https://example.com/x.png" }],
      }),
    ).toThrow();
    expect(() =>
      parsePlate({ ...p, items: [{ ...item, width: -2 }] }),
    ).toThrow();
  });
});
