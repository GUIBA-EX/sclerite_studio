import { expect, it } from "vitest";
import { recoveryPlan } from "../src/recovery";
import type { ImageEntry } from "../src/types";

it("plans only changed images, changed originals and obsolete keys", () => {
  const blob = new Blob(["image"]);
  const first = { id: "a", original: blob } as ImageEntry;
  const other = { id: "b", original: blob } as ImageEntry;
  const changed = { ...first, notes: { "1": "ok" } };
  const plan = recoveryPlan([changed, other], new Map([["a", first], ["b", other]]),
    new Map([["a", blob], ["b", blob]]), ["image:a", "original:a", "image:gone", "original:gone", "manifest"]);
  expect(plan.images).toEqual([changed]);
  expect(plan.originals).toEqual([]);
  expect(plan.remove).toEqual(["image:gone", "original:gone"]);
});
