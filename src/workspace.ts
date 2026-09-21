import type { Parameters } from "./types";
export function parameterKey(p: Parameters): string {
  return JSON.stringify(
    Object.keys(p)
      .sort()
      .map((k) => [k, p[k as keyof Parameters]]),
  );
}
