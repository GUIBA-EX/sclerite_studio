import type { Analysis } from "./types";

export type PackedLabels = { length: number; runs: Uint32Array };
export type HistoryEntry = { analysis: Omit<Analysis, "labels">; packed: PackedLabels; notes: Record<string, string> };
const cache = new WeakMap<Int32Array, PackedLabels>();

export function packLabels(labels: Int32Array): PackedLabels {
  const found = cache.get(labels);
  if (found) return found;
  const runs: number[] = [];
  for (let i = 0; i < labels.length;) {
    const value = labels[i];
    let end = i + 1;
    while (end < labels.length && labels[end] === value) end++;
    runs.push(value >>> 0, end - i);
    i = end;
  }
  const packed = { length: labels.length, runs: Uint32Array.from(runs) };
  cache.set(labels, packed);
  return packed;
}
export function unpackLabels(packed: PackedLabels): Int32Array {
  const labels = new Int32Array(packed.length);
  let offset = 0;
  if (packed.runs.length % 2) throw new Error("Invalid packed labels");
  for (let i = 0; i < packed.runs.length; i += 2) {
    const count = packed.runs[i + 1];
    if (!count || offset + count > labels.length) throw new Error("Invalid label run");
    labels.fill(packed.runs[i] | 0, offset, offset + count);
    offset += count;
  }
  if (offset !== labels.length) throw new Error("Invalid label length");
  cache.set(labels, packed);
  return labels;
}
export function snapshot(analysis: Analysis, notes: Record<string, string>): HistoryEntry {
  const { labels, ...rest } = analysis;
  return { analysis: rest, packed: packLabels(labels), notes };
}
export function restore(entry: HistoryEntry): { analysis: Analysis; notes: Record<string, string> } {
  return { analysis: { ...entry.analysis, labels: unpackLabels(entry.packed) }, notes: entry.notes };
}
export function pushHistory(stack: HistoryEntry[], entry: HistoryEntry, limit: number): HistoryEntry[] {
  return [...stack, entry].slice(-limit);
}
export function historyBytes(stack: HistoryEntry[]): number {
  return [...new Set(stack.map(entry => entry.packed))].reduce((sum, p) => sum + p.runs.byteLength, 0);
}
