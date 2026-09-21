import {
  segment,
  measureLabels,
  splitTouched,
  screenCompleteCandidates,
} from "./engine";
import type { Parameters } from "./types";
const scope = self as unknown as Worker;
scope.onmessage = (
  event: MessageEvent<{
    requestId: string;
    imageId: string;
    kind: "segment" | "measure" | "split";
    data?: Uint8ClampedArray;
    labels?: Int32Array;
    width: number;
    height: number;
    params: Parameters;
    ids?: number[];
    threshold?: number;
  }>,
) => {
  const m = event.data;
  try {
    const labels =
      m.kind === "split"
        ? splitTouched(m.labels!, m.width, m.height, m.ids ?? [])
        : m.labels;
    let result =
      m.kind === "segment"
        ? segment(m.data!, m.width, m.height, m.params)
        : {
            labels: labels!,
            objects: measureLabels(labels!, m.width, m.height),
            threshold: m.threshold ?? 0,
          };
    if (m.kind !== "segment" && m.params.completeOnly)
      result = screenCompleteCandidates(result, m.width, m.height, m.data);
    scope.postMessage({ requestId: m.requestId, imageId: m.imageId, result }, [
      result.labels.buffer as ArrayBuffer,
    ]);
  } catch (error) {
    scope.postMessage({
      requestId: m.requestId,
      imageId: m.imageId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
