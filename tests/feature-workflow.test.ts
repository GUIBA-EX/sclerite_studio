import { describe, it, expect } from "vitest";
import {
  featureIdentity,
  modelEncoder,
  defaultEncoders,
} from "../src/classification";
import type { ClassifierModel } from "../src/classification";

describe("frozen feature identity", () => {
  it("keeps labels and partitions outside the feature contract", () => {
    const key = featureIdentity("same-crop", "mobilenetv4-small", "cpu");
    for (const metadata of [
      { label: "a", partition: "train" },
      { label: "b", partition: "test" },
    ]) {
      expect({ ...metadata, key }.key).toBe(key);
    }
    expect(
      featureIdentity("changed-mask", "mobilenetv4-small", "cpu"),
    ).not.toBe(key);
    expect(featureIdentity("same-crop", "dinov3-vits16", "cpu")).not.toBe(key);
    expect(
      featureIdentity("same-crop", "mobilenetv4-small", "coreml"),
    ).not.toBe(key);
  });
  it("reads legacy model identity without pretending DINO is installed", () => {
    expect(modelEncoder({} as ClassifierModel)).toBe("mobilenetv4-small");
    expect(modelEncoder({ encoder: "dinov3-vits16" } as ClassifierModel)).toBe(
      "dinov3-vits16",
    );
    expect(
      defaultEncoders.find((e) => e.id === "dinov3-vits16")?.available,
    ).toBe(false);
  });
});
