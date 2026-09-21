import { describe, expect, it } from "vitest";
import {
  annotation,
  cropPacket,
  emptyClassification,
  parseClassification,
  planDataset,
  rowsOf,
} from "../src/classification";
import type { Category, ClassRow } from "../src/classification";
import type { ImageEntry } from "../src/types";
import { DEFAULTS } from "../src/types";
import {
  applyLabelAction,
  datasetSignature,
  modelFreshness,
  trainingAudit,
} from "../src/classification-review";
import type { ClassifierModel } from "../src/classification";
const cats: Category[] = [
  { id: "a", name: "A", task: "morphotype" },
  { id: "b", name: "B", task: "morphotype" },
];
function entry(n = 1): ImageEntry {
  return {
    id: String(n),
    name: `image${n}`,
    sourceHash: String(n).padStart(64, "0"),
    width: 2,
    height: 2,
    data: new Uint8ClampedArray([
      80, 90, 100, 255, 200, 200, 200, 255, 80, 90, 100, 255, 0, 0, 0, 255,
    ]),
    original: new Blob(),
    url: "",
    synthetic: false,
    params: DEFAULTS,
    specimen: `S${n}`,
    tissue: "",
    notes: {},
    undo: [],
    classification: {
      ...emptyClassification(),
      categories: cats,
      specimenId: `specimen${n}`,
    },
    analysis: {
      classificationEpoch: "epoch1",
      revision: "r1",
      labels: new Int32Array([1, 0, 1, 0]),
      objects: [
        {
          id: 1,
          area: 2,
          perimeter: 6,
          length: 2,
          width: 1,
          aspect: 2,
          circularity: 0.7,
          cx: 0,
          cy: 1,
          bbox: [0, 0, 1, 2],
          border: false,
          solidity: 1,
        },
      ],
      threshold: 10,
      approvedIds: [1],
    },
  };
}
async function labeled(n: number, label: string) {
  const e = entry(n),
    r = (await rowsOf([e]))[0];
  e.classification!.annotations[`morphotype:${r.key}`] = {
    uuid: `uuid${n}`,
    objectId: 1,
    task: "morphotype",
    label,
  };
  return r;
}
describe("classification identity and data boundaries", () => {
  it("undoes human fields without losing newer predictions; rejects conflicting history", async () => {
    const r = await labeled(1, "a"),
      key = `morphotype:${r.key}`;
    const action = {
      name: "确认类别",
      task: "morphotype" as const,
      changes: [
        {
          image: r.entry.id,
          key,
          before: { label: undefined, acceptedModel: undefined },
          after: { label: "a", acceptedModel: undefined },
        },
      ],
    };
    r.entry.classification!.annotations[key].prediction = {
      model: "new-model",
      classes: ["a", "b"],
      scores: [0.8, 0.2],
      date: "now",
    };
    const undone = applyLabelAction([r.entry], action, false);
    expect(undone[0].classification!.annotations[key].label).toBeUndefined();
    expect(undone[0].classification!.annotations[key].prediction?.model).toBe(
      "new-model",
    );
    expect(
      applyLabelAction(undone, action, true)[0].classification!.annotations[key]
        .label,
    ).toBe("a");
    expect(() => applyLabelAction(undone, action, false)).toThrow();
    expect(r.entry.classification!.annotations[key].label).toBe("a");
  });
  it("audits missing classes, specimens, duplicate originals and formal eligibility", async () => {
    const a = await labeled(1, "a"),
      b = await labeled(2, "b");
    expect(
      trainingAudit([a, b], "morphotype", cats, false, null).errors,
    ).toEqual([]);
    expect(
      trainingAudit([a, b], "morphotype", cats, true, null).errors.join(),
    ).toContain("3 个独立");
    b.entry.sourceHash = a.entry.sourceHash;
    expect(
      trainingAudit([a, b], "morphotype", cats, false, null).errors.join(),
    ).toContain("重复原图");
    b.entry.classification!.specimenId = undefined;
    expect(
      trainingAudit([a, b], "morphotype", cats, false, null).missingSpecimens,
    ).toBe(1);
    expect(
      trainingAudit([a], "morphotype", cats, false, null).errors.length,
    ).toBeGreaterThan(0);
  });
  it("snapshots are order independent, ignore prediction/display changes and detect label changes", async () => {
    const a = await labeled(1, "a"),
      b = await labeled(2, "b"),
      rows = [a, b];
    const initial = await datasetSignature(rows, "morphotype", cats);
    expect(
      await datasetSignature([b, a], "morphotype", [...cats].reverse()),
    ).toBe(initial);
    a.entry.specimen = "display rename";
    annotation(a, "morphotype")!.prediction = {
      model: "m",
      classes: ["a", "b"],
      scores: [0.4, 0.6],
      date: "now",
    };
    expect(await datasetSignature(rows, "morphotype", cats)).toBe(initial);
    annotation(a, "morphotype")!.label = "b";
    expect(await datasetSignature(rows, "morphotype", cats)).not.toBe(initial);
    annotation(a, "morphotype")!.label = "a";
    expect(await datasetSignature(rows, "morphotype", cats)).toBe(initial);
    a.entry.classification!.specimenId = "changed";
    expect(await datasetSignature(rows, "morphotype", cats)).not.toBe(initial);
  });
  it("formal snapshot matches persisted effective partitions", async () => {
    const rows = await Promise.all(
      [1, 2, 3, 4, 5, 6].map((n) => labeled(n, n <= 3 ? "a" : "b")),
    );
    const plan = planDataset(rows, "morphotype", cats, true);
    const initial = await datasetSignature(rows, "morphotype", cats, plan);
    const { parseStudy } = await import("../src/species");
    for (const r of rows)
      r.entry.study = {
        ...parseStudy(r.entry.study),
        partition: plan.partitions.get(plan.groups.get(r.key)!)!,
      };
    expect(await datasetSignature(rows, "morphotype", cats)).toBe(initial);
  });
  it("distinguishes current, outdated, external and legacy models", async () => {
    const a = await labeled(1, "a");
    const signature = await datasetSignature([a], "morphotype", cats);
    const model = {
      samples: [{ object: "uuid1" }],
      dataset_signature: signature,
    } as ClassifierModel;
    expect(modelFreshness(model, [a.entry], signature)).toBe("current");
    expect(modelFreshness(model, [a.entry], "changed")).toBe("outdated");
    annotation(a, "morphotype")!.label = undefined;
    expect(modelFreshness(model, [a.entry], "changed")).toBe("outdated");
    expect(modelFreshness(model, [], signature)).toBe("external");
    expect(
      modelFreshness(
        { ...model, dataset_signature: undefined },
        [a.entry],
        signature,
      ),
    ).toBe("unknown");
  });
  it("audit enforces protected tests and ignores an unrelated model task", async () => {
    const a = await labeled(1, "a"),
      b = await labeled(2, "b");
    const model = {
      task: "morphotype",
      formal: true,
      samples: [
        { partition: "test", source: a.entry.sourceHash, group: "specimen1" },
      ],
    } as ClassifierModel;
    expect(
      trainingAudit([a, b], "morphotype", cats, false, model).errors.join(),
    ).toContain("锁定测试");
    expect(
      trainingAudit([a, b], "morphotype", cats, false, {
        ...model,
        task: "species",
      }).errors,
    ).toEqual([]);
  });
  it("uses original binary masked pixels and only approved complete objects", async () => {
    const e = entry(),
      packet = cropPacket(e, e.analysis!.objects[0]);
    expect(packet.length).toBe(16);
    expect([...packet.slice(8, 12)]).toEqual([80, 90, 100, 255]);
    e.analysis!.approvedIds = [];
    expect(await rowsOf([e])).toHaveLength(0);
    e.analysis!.approvedIds = [1];
    e.analysis!.objects[0].border = true;
    expect(await rowsOf([e])).toHaveLength(0);
  });
  it("does not reuse human labels after a new mask or segmentation epoch", async () => {
    const r = await labeled(1, "a"),
      e = r.entry;
    expect(annotation(r, "morphotype")?.label).toBe("a");
    const edited = {
      ...e,
      analysis: {
        ...e.analysis!,
        labels: new Int32Array([1, 0, 0, 0]),
        revision: "r2",
      },
    };
    const row = (await rowsOf([edited]))[0];
    expect(row.key).not.toBe(r.key);
    expect(annotation(row, "morphotype")).toBeUndefined();
    const reset = {
      ...e,
      analysis: {
        ...e.analysis!,
        labels: e.analysis!.labels.slice(),
        classificationEpoch: "epoch2",
      },
    };
    expect((await rowsOf([reset]))[0].key).not.toBe(r.key);
  });
  it("round-trips annotations; rejects malformed predictions", async () => {
    const r = await labeled(1, "a");
    expect(
      parseClassification(JSON.parse(JSON.stringify(r.entry.classification))),
    ).toEqual(r.entry.classification);
    const data = structuredClone(r.entry.classification!);
    data.annotations[`morphotype:${r.key}`].prediction = {
      model: "m",
      classes: ["a", "b"],
      scores: [0.9, 0.9],
      date: "now",
    };
    expect(() => parseClassification(data)).toThrow();
  });
  it("single-specimen data can only train a trial model", async () => {
    const a = await labeled(1, "a"),
      b = await labeled(2, "b");
    b.entry.classification!.specimenId = "specimen1";
    expect(planDataset([a, b], "morphotype", cats, false).formal).toBe(false);
    expect(() => planDataset([a, b], "morphotype", cats, true)).toThrow(/至少/);
  });
  it("reproducible grouped partitions cover all classes without leakage", async () => {
    const rows: ClassRow[] = [];
    for (let i = 1; i <= 12; i++)
      rows.push(await labeled(i, i <= 6 ? "a" : "b"));
    const p = planDataset(rows, "morphotype", cats, true),
      q = planDataset(rows, "morphotype", cats, true);
    expect(p.formal).toBe(true);
    expect(p.partitions).toEqual(q.partitions);
    for (const c of cats)
      expect(
        new Set(
          rows
            .filter((r) => annotation(r, "morphotype")!.label === c.id)
            .map((r) => p.partitions.get(p.groups.get(r.key)!)),
        ),
      ).toEqual(new Set(["train", "validation", "test"]));
    rows[1].entry.sourceHash = rows[0].entry.sourceHash;
    const dedup = planDataset(rows, "morphotype", cats, true);
    expect(dedup.groups.get(rows[0].key)).toBe(dedup.groups.get(rows[1].key));
  });
  it("never trains predictions or silently imports held-out data", async () => {
    const a = await labeled(1, "a"),
      b = await labeled(2, "b");
    b.entry.study = {
      colony: "",
      taxon: "",
      hypothesis: "",
      lineage: "",
      evidence: "",
      publication: "",
      batch: "",
      locality: "",
      source: "microscopy",
      sampling: "unknown",
      partition: "test",
    };
    expect(() => planDataset([a, b], "morphotype", cats, false)).toThrow(
      /锁定/,
    );
    delete b.entry.classification!.annotations[`morphotype:${b.key}`].label;
    expect(() => planDataset([a, b], "morphotype", cats, false)).toThrow(
      /两个类别/,
    );
  });
});
