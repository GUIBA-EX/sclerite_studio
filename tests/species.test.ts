import { describe, it, expect } from "vitest";
import {
  auditStudy,
  completeObjects,
  EMPTY_STUDY,
  leakageGroups,
  parseStudy,
  quantile,
  summarizeStudy,
  summaryCSV,
  tabular,
} from "../src/species";
import type { ImageEntry, Sclerite } from "../src/types";
import { DEFAULTS } from "../src/types";

const object = (id: number, length = 100): Sclerite => ({
  id,
  length,
  width: 20,
  area: 1000,
  perimeter: 200,
  aspect: length / 20,
  circularity: 0.3,
  cx: 10,
  cy: 10,
  bbox: [0, 0, 10, 10],
  border: false,
  solidity: 0.9,
});
function entry(id: string, patch: Partial<ImageEntry> = {}): ImageEntry {
  return {
    id,
    name: id + ".png",
    data: new Uint8ClampedArray(),
    original: new Blob(),
    width: 20,
    height: 20,
    url: "",
    synthetic: false,
    specimen: id,
    tissue: "polyp",
    notes: { 1: "spindle" },
    undo: [],
    params: { ...DEFAULTS },
    sourceHash: id,
    calibration: {
      start: { x: 0, y: 0 },
      end: { x: 10, y: 0 },
      distanceUm: 20,
      umPerPixel: 2,
    },
    study: {
      ...EMPTY_STUDY,
      colony: "col-" + id,
      batch: "batch-" + id,
      source: "microscopy",
      sampling: "systematic",
    },
    analysis: {
      objects: [object(1), object(2, 200)],
      approvedIds: [1, 2],
      labels: new Int32Array(),
      threshold: 20,
    },
    ...patch,
  };
}
describe("study metadata and scientific boundaries", () => {
  it("keeps old projects unknown and rejects malformed values", () => {
    expect(parseStudy(undefined)).toEqual(EMPTY_STUDY);
    expect(parseStudy({ taxon: "D. cf. australis" }).taxon).toBe(
      "D. cf. australis",
    );
    expect(() => parseStudy({ partition: "approved_species" })).toThrow();
    expect(() => parseStudy({ colony: 42 })).toThrow();
    expect(() => parseStudy([])).toThrow();
  });
  it("uses only complete confirmed nonborder and nonrejected objects", () => {
    const e = entry("A");
    e.analysis!.objects.push({ ...object(3), border: true }, object(4));
    e.analysis!.approvedIds = [1, 3, 4, 999];
    e.analysis!.rejected = [
      { id: 4, bbox: [0, 0, 1, 1], reasons: ["rejected"] },
    ];
    expect(completeObjects(e).map((o) => o.id)).toEqual([1]);
  });
  it("reports linear quartiles of calibrated measurements, not confidence intervals", () => {
    const [r] = summarizeStudy([entry("A")]);
    expect(r.length).toEqual([250, 300, 350]);
    expect(r.width).toBe(40);
    expect(r.n).toBe(2);
    expect(r.calibratedN).toBe(2);
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([3], 0.25)).toBe(3);
  });
  it("never mixes pixels into physical lengths", () => {
    const a = entry("A"),
      b = entry("B", { specimen: "A", calibration: undefined });
    b.analysis!.objects[0].length = 99999;
    const [r] = summarizeStudy([a, b]);
    expect(r.n).toBe(4);
    expect(r.calibratedN).toBe(2);
    expect(r.length[1]).toBe(300);
    expect(summarizeStudy([b])[0].length).toEqual([null, null, null]);
  });
  it("stratifies tissues, origins and sampling; images are not independent specimens", () => {
    const a = entry("A"),
      b = entry("B", { specimen: "A" }),
      c = entry("C", { specimen: "A", tissue: "stalk" }),
      d = entry("D", { specimen: "A" });
    d.study!.source = "publication";
    d.study!.sampling = "selected";
    const rows = summarizeStudy([a, b, c, d]);
    expect(rows).toHaveLength(3);
    expect(rows[0].imageIds).toHaveLength(2);
    expect(rows[0].n).toBe(4);
  });
  it("excludes demo, missing metadata, excluded entries and byte-identical images", () => {
    const a = entry("A"),
      excluded = entry("X");
    excluded.study!.partition = "exclude";
    const rows = summarizeStudy([
      a,
      entry("B", { sourceHash: a.sourceHash }),
      entry("C", { synthetic: true }),
      entry("D", { specimen: "" }),
      entry("E", { tissue: "未指定" }),
      excluded,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].n).toBe(2);
  });
  it("retains explicit unknown morphotypes and arbitrary labels safely", () => {
    const a = entry("A", { notes: { 1: "__proto__", 2: "未确定" } });
    expect(summarizeStudy([a])[0].morphotypes["__proto__"]).toBe(1);
    expect(summarizeStudy([a], "未确定")[0].n).toBe(1);
    expect(summarizeStudy([a], "spindle")).toHaveLength(0);
  });
});
describe("leakage audit", () => {
  it("takes the transitive closure of specimen, colony, publication, batch and image links", () => {
    const es = ["A", "B", "C", "D", "E", "F"].map((id) => entry(id));
    es[1].specimen = "A";
    es[2].study!.colony = es[1].study!.colony;
    es[2].study!.publication = es[3].study!.publication = "doi:1";
    es[3].study!.batch = es[4].study!.batch;
    es[4].sourceHash = es[5].sourceHash;
    expect(leakageGroups(es)).toHaveLength(1);
    expect(leakageGroups(es)[0].imageIds).toHaveLength(6);
  });
  it("does not join blank identifiers", () => {
    const es = ["A", "B"].map((id) =>
      entry(id, {
        specimen: "",
        sourceHash: undefined,
        study: { ...EMPTY_STUDY },
      }),
    );
    expect(leakageGroups(es)).toHaveLength(2);
  });
  it("blocks any connected group crossing train/test", () => {
    const a = entry("A"),
      b = entry("B");
    a.study!.partition = "train";
    b.study!.partition = "test";
    b.study!.batch = a.study!.batch;
    const audit = auditStudy([a, b]);
    expect(audit.canExportSplit).toBe(false);
    expect(audit.issues.some((i) => i.message.includes("存在泄漏"))).toBe(true);
  });
  it("blocks missing provenance and inconsistent specimen identity", () => {
    const a = entry("A"),
      b = entry("B", { specimen: "A" });
    a.study!.source = "publication";
    const audit = auditStudy([a, b]);
    expect(audit.issues.some((i) => i.message.includes("publication ID"))).toBe(
      true,
    );
    expect(audit.issues.some((i) => i.message.includes("不一致"))).toBe(true);
  });
  it("allows an explicitly separated full metadata split without claiming biological validation", () => {
    const es = ["A", "B", "C"].map((id) => entry(id));
    es[0].study!.partition = "train";
    es[1].study!.partition = "validation";
    es[2].study!.partition = "test";
    const audit = auditStudy(es);
    expect(audit.canExportSplit).toBe(true);
    expect(audit.colonyCount).toBe(3);
    expect(audit.groups).toHaveLength(3);
    expect(audit.issues.some((i) => i.message.includes("人工核对"))).toBe(true);
  });
  it("blocks absent confirmations and duplicates, and warns about single-colony classes", () => {
    const a = entry("A");
    a.study!.taxon = "Species 1";
    a.analysis!.approvedIds = [];
    const b = entry("B", { sourceHash: a.sourceHash });
    const messages = auditStudy([a, b])
      .issues.map((i) => i.message)
      .join("\n");
    expect(messages).toContain("重复导入");
    expect(messages).toContain("尚无已确认");
    expect(messages).toContain("无法分离");
  });
  it("exports BOM CSV, explicit units and formula-safe user text", () => {
    expect(tabular([['=HYPERLINK("x")', "a,b"]])).toContain("'=HYPERLINK");
    expect(summaryCSV(summarizeStudy([entry("A")]))).toContain(
      "length_um_median",
    );
    expect(summaryCSV([]).charCodeAt(0)).toBe(0xfeff);
  });
});
