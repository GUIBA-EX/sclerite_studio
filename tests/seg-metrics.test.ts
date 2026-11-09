import { expect, it } from "vitest";
import { segmentationMetrics } from "./seg-metrics";

it("measures matches, splits, merges and false positives", () => {
  const m = (g: number[], p: number[]) => segmentationMetrics(Int32Array.from(g), Int32Array.from(p), 6, 1).all;
  expect(m([0,1,1,1,1,0], [0,2,2,2,2,0])).toMatchObject({tp:1,fp:0,fn:0,f1:1,meanIoU:1});
  expect(m([0,1,1,1,0,0], [0,0,2,2,2,0])).toMatchObject({tp:1,meanIoU:0.5});
  expect(m([0,1,1,1,1,0], [0,2,2,3,3,0])).toMatchObject({tp:1,fp:1,oversegmented:1});
  expect(m([0,1,1,2,2,0], [0,3,3,3,3,0])).toMatchObject({tp:1,fn:1,undersegmented:1});
  expect(m([0,0,0,0,0,0], [0,3,3,0,0,0])).toMatchObject({tp:0,fp:1,fn:0});
});
it("ignores predictions covering only border ground truth in the non-border scope", () => {
  const gt=Int32Array.from([1,1,0,0,0,0,0,2,2,0,0,0,0,0,0,0,0,0,0,0]);
  const pred=Int32Array.from([3,3,0,0,0,0,0,4,4,0,0,0,0,0,0,0,0,0,0,0]);
  expect(segmentationMetrics(gt,pred,5,4).withoutBorder).toMatchObject({tp:1,fp:0,fn:0});
});
