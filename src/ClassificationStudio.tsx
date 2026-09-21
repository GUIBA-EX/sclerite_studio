import { tr, useLanguage } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Tags,
  Trash2,
  Undo2,
  Redo2,
  X,
} from "lucide-react";
import type { ImageEntry } from "./types";
import ObjectPreview from "./ObjectPreview";
import { saveBlob } from "./io";
import { parseStudy } from "./species";
import {
  annotation,
  categoriesOf,
  cropPacket,
  emptyClassification,
  defaultEncoders,
  featureIdentity,
  modelEncoder,
  predictionBest,
  resultsCsv,
  rowsOf,
} from "./classification";
import type {
  Annotation,
  Category,
  ClassifierModel,
  ClassRow,
  Sample,
  Task,
  EncoderInfo,
} from "./classification";
import "./classification.css";
import {
  applyLabelAction,
  datasetSignature,
  humanLabel,
  modelFreshness,
  sameLabel,
  trainingAudit,
} from "./classification-review";
import type { LabelAction, LabelChange } from "./classification-review";

const token = (r: ClassRow) => `${r.entry.id}:${r.key}`;
export default function ClassificationStudio({
  images,
  activeId,
  visible: tabVisible,
  onChange,
  onBusy,
  onProcess,
}: {
  images: ImageEntry[];
  activeId: string;
  visible: boolean;
  onChange: (fn: (e: ImageEntry) => ImageEntry) => void;
  onBusy: (busy: boolean) => void;
  onProcess: () => void;
}) {
  useLanguage();
  const [task, setTask] = useState<Task>("morphotype"),
    [rows, setRows] = useState<ClassRow[]>([]),
    [preparing, setPreparing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set()),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState("");
  const [newName, setNewName] = useState(""),
    [category, setCategory] = useState(""),
    [page, setPage] = useState(0);
  const [model, setModel] = useState<ClassifierModel | null>(null),
    [formal, setFormal] = useState(false);
  const [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [job, setJob] = useState("");
  const [progress, setProgress] = useState({ completed: 0, total: 0 }),
    [specimenName, setSpecimenName] = useState("");
  const [photoId, setPhotoId] = useState(activeId),
    [preview, setPreview] = useState<ClassRow | null>(null);
  const [backend, setBackend] = useState<"cpu" | "coreml">("cpu");
  const [encoder, setEncoder] = useState("mobilenetv4-small");
  const [encoders, setEncoders] = useState<EncoderInfo[]>(defaultEncoders);
  const [autoRegularization, setAutoRegularization] = useState(true);
  const [preparedFeatures, setPreparedFeatures] = useState<Set<string>>(
    new Set(),
  );
  const [scope, setScope] = useState("all"),
    [rename, setRename] = useState<Category | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [history, setHistory] = useState<LabelAction[]>([]),
    [future, setFuture] = useState<LabelAction[]>([]);
  const [signature, setSignature] = useState("");
  const auditDialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!auditOpen) return;
    const previous = document.activeElement as HTMLElement | null;
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = auditDialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
      );
      if (!items?.length) return;
      const first = items[0],
        last = items[items.length - 1];
      if (
        !auditDialog.current?.contains(document.activeElement) ||
        (e.shiftKey && document.activeElement === first)
      ) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", trap);
    return () => {
      window.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [auditOpen]);
  const selectionAnchor = useRef<string | null>(null);
  const cancelled = useRef(false),
    modelInput = useRef<HTMLInputElement>(null),
    native = isTauri();
  const cats = useMemo(() => categoriesOf(images, task), [images, task]);
  const active =
    images.find((e) => e.id === photoId) ??
    images.find((e) => e.id === activeId) ??
    images[0];
  useEffect(() => {
    setPhotoId(activeId);
  }, [activeId]);
  useEffect(() => {
    let live = true;
    setPreparing(true);
    void rowsOf(images)
      .then((r) => {
        if (live) {
          setRows(r);
          setPreparing(false);
        }
      })
      .catch((e) => {
        if (live) {
          setError(String(e));
          setPreparing(false);
        }
      });
    return () => {
      live = false;
    };
  }, [images]);
  useEffect(() => {
    let live = true;
    if (native) {
      void invoke<ClassifierModel | null>("classifier_current", {
        encoder,
        task,
      })
        .then((m) => {
          if (live) {
            setModel(m);
            if (m)
              setBackend(/Mac/.test(navigator.platform) ? m.backend : "cpu");
          }
        })
        .catch((e) => {
          if (live) setError(String(e));
        });
    }
    return () => {
      live = false;
    };
  }, [native, encoder, task]);
  useEffect(() => {
    let live = true;
    if (native)
      void invoke<EncoderInfo[]>("classifier_encoders")
        .then((items) => {
          if (live) setEncoders(items);
        })
        .catch((e) => {
          if (live) setError(`无法读取特征模型清单：${String(e)}`);
        });
    return () => {
      live = false;
    };
  }, [native]);
  useEffect(() => {
    if (!native) return;
    const off = listen<{ phase: string; completed: number; total: number }>(
      "classifier-progress",
      (e) => {
        setJob(e.payload.phase);
        setProgress(e.payload);
      },
    );
    return () => {
      void off.then((f) => f());
    };
  }, [native]);
  useEffect(() => {
    setPage(0);
    setSelected(new Set());
  }, [task, filter, query, scope]);
  const filtered = rows.filter((r) => {
    const a = annotation(r, task);
    return (
      (scope === "all" || r.entry.id === scope) &&
      (filter === "all" ||
        (filter === "unlabeled"
          ? !a?.label
          : filter === "predicted"
            ? !!a?.prediction && !a.label
            : filter === "current"
              ? r.entry.id === active?.id
              : a?.label === filter)) &&
      (!query ||
        `${r.entry.name} ${r.entry.specimen} ${r.object.id}`
          .toLowerCase()
          .includes(query.toLowerCase()))
    );
  });
  const totalPages = Math.max(1, Math.ceil(filtered.length / 48)),
    pageIndex = Math.min(page, totalPages - 1),
    visible = filtered.slice(pageIndex * 48, (pageIndex + 1) * 48);
  const chosen = filtered.filter((r) => selected.has(token(r)));
  const labeled = rows.filter((r) => annotation(r, task)?.label).length;
  const specimenIds = [
    ...new Set(
      images
        .map((e) => e.classification?.specimenId)
        .filter((v): v is string => !!v),
    ),
  ];
  const disabled = !!job || preparing;
  const taskModel =
    model?.task === task && modelEncoder(model) === encoder ? model : null;
  const selectedEncoder = encoders.find((e) => e.id === encoder);
  const preparedCount = rows.filter((r) =>
    preparedFeatures.has(featureIdentity(r.key, encoder, backend)),
  ).length;
  const audit = useMemo(
    () => trainingAudit(rows, task, cats, formal, taskModel),
    [rows, task, cats, formal, taskModel],
  );
  const geometry = images
    .map(
      (e) =>
        `${e.id}:${e.analysis?.revision}:${e.analysis?.classificationEpoch}:${e.analysis?.approvedIds?.join(",")}`,
    )
    .join("|");
  useEffect(() => {
    setHistory([]);
    setFuture([]);
  }, [geometry]);
  useEffect(() => {
    let live = true;
    setSignature("");
    void datasetSignature(rows, task, cats)
      .then((s) => {
        if (live) setSignature(s);
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [rows, task, cats]);
  const freshness =
    taskModel && signature && !preparing
      ? modelFreshness(taskModel, images, signature)
      : null;
  const undoAction = [...history].reverse().find((a) => a.task === task),
    redoAction = [...future].reverse().find((a) => a.task === task);
  function restoreLabels(redo: boolean) {
    const action = redo ? redoAction : undoAction;
    if (!action || action.task !== task || disabled) return;
    try {
      const restored = new Map(
        applyLabelAction(images, action, redo).map((e) => [e.id, e]),
      );
      onChange((e) => restored.get(e.id) ?? e);
      if (redo) {
        setFuture((f) => f.filter((a) => a !== action));
        setHistory((h) => [...h, action]);
      } else {
        setHistory((h) => h.filter((a) => a !== action));
        setFuture((f) => [...f, action]);
      }
      setStatus(
        `${redo ? "已重做" : "已撤销"}：${action.name}（${action.changes.length} 枚）。模型建议保持不变。`,
      );
    } catch (e) {
      setError(String(e));
      setHistory([]);
      setFuture([]);
    }
  }
  const missingSpecimens = new Set(
    rows
      .filter(
        (r) =>
          annotation(r, task)?.label && !r.entry.classification?.specimenId,
      )
      .map((r) => r.entry.id),
  ).size;
  const classesWithSamples = cats.filter((c) =>
    rows.some((r) => annotation(r, task)?.label === c.id),
  ).length;
  const trainHint =
    cats.length < 2
      ? "先建立至少两个类别"
      : classesWithSamples < cats.length
        ? "请为每个类别标注完整骨针"
        : missingSpecimens
          ? `还有 ${missingSpecimens} 张训练照片未指定标本`
          : !labeled
            ? "请先确认人工类别"
            : "标签已就绪；先训练试用模型检查流程";
  const canTrain =
    cats.length >= 2 &&
    classesWithSamples === cats.length &&
    !missingSpecimens &&
    labeled > 0;
  useEffect(() => {
    if (!tabVisible) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPreview(null);
        setRename(null);
        setAuditOpen(false);
        return;
      }
      if (
        disabled ||
        rename ||
        preview ||
        auditOpen ||
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(new Set(filtered.map(token)));
      }
      if (
        (e.metaKey || e.ctrlKey) &&
        ["z", "y"].includes(e.key.toLowerCase())
      ) {
        e.preventDefault();
        restoreLabels(e.shiftKey || e.key.toLowerCase() === "y");
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [
    tabVisible,
    disabled,
    filtered,
    rename,
    preview,
    auditOpen,
    history,
    future,
    images,
    task,
  ]);

  function renameCategory() {
    if (!rename) return;
    const name = rename.name.trim();
    if (!name || cats.some((c) => c.id !== rename.id && c.name === name)) {
      setError("类别名称不能为空或与已有类别重复。");
      return;
    }
    onChange((e) =>
      e.classification
        ? {
            ...e,
            classification: {
              ...e.classification,
              categories: e.classification.categories.map((c) =>
                c.id === rename.id ? { ...c, name } : c,
              ),
            },
          }
        : e,
    );
    setRename(null);
    setStatus("类别名称已更新，标签身份和模型类别顺序未改变。");
  }

  function patchAnnotations(
    targets: ClassRow[],
    fn: (r: ClassRow, a: Annotation) => Annotation,
    actionName?: string,
  ) {
    const changes: LabelChange[] = [];
    const updates = new Map<string, Annotation>();
    for (const r of targets) {
      const key = `${task}:${r.key}`;
      const before = r.entry.classification?.annotations[key];
      const after = fn(
        r,
        before ?? { uuid: crypto.randomUUID(), objectId: r.object.id, task },
      );
      updates.set(token(r), after);
      if (actionName && !sameLabel(humanLabel(before), humanLabel(after)))
        changes.push({
          image: r.entry.id,
          key,
          before: humanLabel(before),
          after: humanLabel(after),
        });
    }
    if (changes.length) {
      setHistory((h) =>
        [...h, { name: actionName!, task, changes }].slice(-20),
      );
      setFuture([]);
    }
    const byImage = new Map<string, ClassRow[]>();
    targets.forEach((r) =>
      byImage.set(r.entry.id, [...(byImage.get(r.entry.id) ?? []), r]),
    );
    onChange((e) => {
      const rs = byImage.get(e.id);
      if (!rs) return e;
      const data = e.classification ?? emptyClassification(),
        annotations = { ...data.annotations };
      for (const r of rs) {
        const key = `${task}:${r.key}`;
        annotations[key] = updates.get(token(r))!;
      }
      const known = new Set(data.categories.map((c) => c.id));
      return {
        ...e,
        classification: {
          ...data,
          annotations,
          categories: [
            ...data.categories,
            ...cats.filter((c) => !known.has(c.id)),
          ],
        },
      };
    });
  }
  function addCategory() {
    const name = newName.trim();
    if (!name) return;
    if (cats.some((c) => c.name === name)) {
      setError("这个类别已存在。");
      return;
    }
    if (cats.length >= 100) {
      setError("每个任务最多 100 个类别。");
      return;
    }
    const c: Category = { id: crypto.randomUUID(), name, task };
    onChange((e) => ({
      ...e,
      classification: {
        ...(e.classification ?? emptyClassification()),
        categories: [...(e.classification?.categories ?? []), c],
      },
    }));
    setCategory(c.id);
    setNewName("");
  }
  function assign(id: string) {
    patchAnnotations(
      chosen,
      (_r, a) => ({
        ...a,
        label: id || undefined,
        acceptedModel: undefined,
      }),
      id ? "确认类别" : "清除类别",
    );
    setStatus(
      id
        ? `已确认 ${chosen.length} 枚的人工类别；没有改动模型建议。`
        : `已清除 ${chosen.length} 枚的人工类别。`,
    );
  }
  function accept() {
    const eligible = chosen.filter((r) => {
      const p = annotation(r, task)?.prediction;
      return p && p.model === taskModel?.id;
    });
    patchAnnotations(
      eligible,
      (_r, a) => ({
        ...a,
        label: predictionBest(a.prediction!).id,
        acceptedModel: a.prediction!.model,
      }),
      "接受模型建议",
    );
    setStatus(
      `已人工接受 ${eligible.length} 枚建议。测试集标签仍不会自动加入训练。`,
    );
  }
  function setSpecimen(id: string, name?: string) {
    if (!active) return;
    onChange((e) =>
      e.id !== active.id
        ? e
        : {
            ...e,
            specimen:
              name ??
              images.find((i) => i.classification?.specimenId === id)
                ?.specimen ??
              "",
            classification: {
              ...(e.classification ?? emptyClassification()),
              specimenId: id || undefined,
            },
          },
    );
  }
  async function extract(
    list: ClassRow[],
    useBackend: string,
    useEncoder = encoder,
  ): Promise<Map<string, string>> {
    const keys = new Map<string, string>();
    let cached = 0;
    for (let i = 0; i < list.length; i++) {
      if (cancelled.current)
        throw new Error("已取消；旧模型和已有标签未改变。");
      const r = list[i];
      setJob("提取骨针特征");
      setProgress({ completed: i, total: list.length });
      const result = await invoke<{ key: string; cached: boolean }>(
        "classifier_feature",
        cropPacket(r.entry, r.object),
        {
          headers: {
            "x-sclerite-backend": useBackend,
            "x-sclerite-encoder": useEncoder,
          },
        },
      );
      keys.set(token(r), result.key);
      if (result.cached) cached++;
      setPreparedFeatures((old) =>
        new Set(old).add(featureIdentity(r.key, useEncoder, useBackend)),
      );
    }
    setProgress({ completed: list.length, total: list.length });
    setStatus(`已提取 ${list.length} 枚特征（缓存命中 ${cached} 枚）。`);
    return keys;
  }
  async function prepareFeatures() {
    await withJob("准备全部完整骨针特征", async () => {
      await extract(rows, backend);
    });
  }
  async function withJob(name: string, run: () => Promise<void>) {
    if (job) return;
    cancelled.current = false;
    setCancelling(false);
    setError("");
    setJob(name);
    onBusy(true);
    setProgress({ completed: 0, total: 0 });
    try {
      await run();
    } catch (e) {
      setError(String(e));
    } finally {
      setJob("");
      onBusy(false);
    }
  }
  async function train() {
    await withJob("检查训练标签", async () => {
      const checked = trainingAudit(rows, task, cats, formal, taskModel);
      if (checked.errors.length || !checked.plan)
        throw new Error(
          checked.errors.join("\n") || "没有符合条件的训练骨针。",
        );
      const plan = checked.plan;
      const trainingSignature = await datasetSignature(rows, task, cats, plan);
      const keys = await extract(plan.rows, backend);
      if (cancelled.current) throw new Error("已取消");
      const samples: Sample[] = plan.rows.map((r) => ({
        key: keys.get(token(r))!,
        object: annotation(r, task)!.uuid,
        source: r.entry.sourceHash!,
        label: annotation(r, task)!.label!,
        group: plan.groups.get(r.key)!,
        partition: plan.partitions.get(plan.groups.get(r.key)!)!,
      }));
      setJob("训练分类层");
      setProgress({ completed: 0, total: 200 });
      const next = await invoke<ClassifierModel>("classifier_train", {
        data: {
          task,
          classes: cats.map(({ id, name }) => ({ id, name })),
          samples,
          formal: plan.formal,
          backend,
          encoder,
          auto_regularization: plan.formal && autoRegularization,
          dataset_signature: trainingSignature,
        },
      });
      setModel(next);
      if (plan.formal) {
        const parts = new Map(
          plan.rows.map((r) => [
            r.entry.id,
            plan.partitions.get(plan.groups.get(r.key)!)!,
          ]),
        );
        onChange((e) =>
          parts.has(e.id)
            ? {
                ...e,
                study: { ...parseStudy(e.study), partition: parts.get(e.id)! },
              }
            : e,
        );
      }
      setStatus(
        `模型已自动保存。${plan.reason}；${next.regularization?.selected_on === "validation" ? `验证集选择 λ=${next.regularization.lambda}；` : "固定正则强度；"}${next.head.converged ? "优化已收敛" : "已达到停止条件但未收敛，请检查数据"}。`,
      );
    });
  }
  function mergeModelCategories(m: ClassifierModel) {
    onChange((e) => {
      const data = e.classification ?? emptyClassification(),
        existing = new Set(data.categories.map((c) => c.id));
      return {
        ...e,
        classification: {
          ...data,
          categories: [
            ...data.categories,
            ...m.classes
              .filter((c) => !existing.has(c.id))
              .map((c) => ({ ...c, task: m.task })),
          ],
        },
      };
    });
  }
  async function predict() {
    if (!taskModel) return;
    await withJob("准备预测", async () => {
      const targets = chosen.length ? chosen : filtered;
      const keys = await extract(targets, backend, modelEncoder(taskModel));
      if (cancelled.current)
        throw new Error("已取消，未写入不完整的预测批次。");
      setJob("计算分类建议");
      const scores = await invoke<number[][]>("classifier_predict", {
        model: taskModel,
        keys: targets.map((r) => keys.get(token(r))!),
      });
      if (cancelled.current)
        throw new Error("已取消，未写入不完整的预测批次。");
      const predictions = new Map(targets.map((r, i) => [token(r), scores[i]]));
      mergeModelCategories(taskModel);
      patchAnnotations(targets, (r, a) => ({
        ...a,
        prediction: {
          model: taskModel.id,
          classes: taskModel.classes.map((c) => c.id),
          scores: predictions.get(token(r))!,
          date: new Date().toISOString(),
        },
      }));
      setStatus(
        `已预测 ${targets.length} 枚，所有建议均需人工复核；没有覆盖人工标签。`,
      );
    });
  }
  async function load(file: File) {
    await withJob("校验模型包", async () => {
      if (file.size > 128_000_000) throw new Error("模型包超过 128 MB。");
      const next = await invoke<ClassifierModel>(
        "classifier_import",
        await file.arrayBuffer(),
      );
      setModel(next);
      setTask(next.task);
      setEncoder(modelEncoder(next));
      setBackend(/Mac/.test(navigator.platform) ? next.backend : "cpu");
      mergeModelCategories(next);
      setStatus("模型校验并加载完成，可离线批量预测。");
    });
  }
  async function exportModel() {
    if (!model) return;
    await withJob("导出完整模型", async () => {
      const bytes = await invoke<ArrayBuffer>("classifier_export", { model });
      await saveBlob(
        new Blob([bytes], { type: "application/zip" }),
        `sclerite-model-${model.id.slice(0, 8)}.zip`,
      );
      setStatus(
        "已导出编码器、分类层、类别和评估清单；包内包含训练标本标识，请审慎分享。",
      );
    });
  }
  return (
    <section className="classification-studio" aria-label={tr("骨针分类")}>
      <input
        ref={modelInput}
        type="file"
        accept=".zip"
        hidden
        data-testid="model-input"
        onChange={(e) => {
          if (e.target.files?.[0]) void load(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <header className="classification-heading">
        <div>
          <p className="eyebrow">SCLERITE CLASSIFICATION</p>
          <h1>
            {tr("分类")}{" "}
            <span className="tag">{tr("人工标签 · 可复核预测")}</span>
          </h1>
          <p>
            {task === "morphotype"
              ? tr("确认完整 → 整理形态标签 → 训练与复核")
              : tr("确认完整 → 指定已知物种与独立标本 → 训练与复核")}
          </p>
        </div>
        <div className="classification-count">
          <b>
            {labeled}
            <small>{tr("已标注")}</small>
          </b>
          <b>
            {rows.length}
            <small>{tr("完整骨针")}</small>
          </b>
          <b>
            {specimenIds.length}
            <small>{tr("标本")}</small>
          </b>
        </div>
      </header>
      <div className="classification-layout">
        <aside className="classification-labels">
          <label className="class-field">
            {tr("分类任务")}
            <select
              aria-label={tr("分类任务")}
              disabled={disabled}
              value={task}
              onChange={(e) => {
                setTask(e.target.value as Task);
                setCategory("");
              }}
            >
              <option value="morphotype">{tr("形态类型")}</option>
              <option value="species">{tr("已知物种标签")}</option>
            </select>
          </label>
          <div className="class-section-heading">
            <strong>{tr("类别")}</strong>
            <span>{cats.length}</span>
          </div>
          <button
            className={
              filter === "all" ? "class-filter active" : "class-filter"
            }
            onClick={() => setFilter("all")}
          >
            {tr("全部完整骨针")} <b>{rows.length}</b>
          </button>
          <button
            className={
              filter === "unlabeled" ? "class-filter active" : "class-filter"
            }
            onClick={() => setFilter("unlabeled")}
          >
            {tr("未标注")} <b>{rows.length - labeled}</b>
          </button>
          <button
            className={
              filter === "predicted" ? "class-filter active" : "class-filter"
            }
            onClick={() => setFilter("predicted")}
          >
            {tr("建议待复核")}{" "}
            <b>
              {
                rows.filter(
                  (r) =>
                    annotation(r, task)?.prediction &&
                    !annotation(r, task)?.label,
                ).length
              }
            </b>
          </button>
          <div className="class-category-list">
            {cats.map((c) => {
              const rs = rows.filter(
                  (r) => annotation(r, task)?.label === c.id,
                ),
                groups = new Set(
                  rs
                    .map((r) => r.entry.classification?.specimenId)
                    .filter(Boolean),
                );
              return (
                <div key={c.id} className="class-category">
                  <button
                    className={
                      filter === c.id ? "class-filter active" : "class-filter"
                    }
                    onClick={() => {
                      setFilter(c.id);
                      setCategory(c.id);
                    }}
                  >
                    <span>
                      <i />
                      {c.name}
                      <small>
                        {groups.size} {tr("标本 ·")} {rs.length} {tr("枚")}
                      </small>
                    </span>
                  </button>
                  <button
                    className="class-rename-button"
                    title={tr("重命名 {0}", c.name)}
                    aria-label={tr("重命名 {0}", c.name)}
                    disabled={disabled}
                    onClick={() => setRename({ ...c })}
                  >
                    <Pencil size={13} />
                  </button>
                  {!rs.length && (
                    <button
                      title={tr("删除空类别 {0}", c.name)}
                      aria-label={tr("删除空类别 {0}", c.name)}
                      disabled={
                        disabled ||
                        images.some((e) =>
                          Object.values(
                            e.classification?.annotations ?? {},
                          ).some((a) => a.label === c.id),
                        ) ||
                        !!taskModel?.classes.some((k) => k.id === c.id)
                      }
                      onClick={() =>
                        onChange((e) =>
                          e.classification
                            ? {
                                ...e,
                                classification: {
                                  ...e.classification,
                                  categories:
                                    e.classification.categories.filter(
                                      (k) => k.id !== c.id,
                                    ),
                                },
                              }
                            : e,
                        )
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <form
            className="class-add"
            onSubmit={(e) => {
              e.preventDefault();
              addCategory();
            }}
          >
            <input
              aria-label={tr("新类别名称")}
              placeholder={
                task === "morphotype" ? tr("如 spindle / club") : tr("物种名称")
              }
              maxLength={80}
              value={newName}
              disabled={disabled || !images.length}
              onChange={(e) => setNewName(e.target.value)}
            />
            <button
              type="submit"
              title={tr("添加类别")}
              aria-label={tr("添加类别")}
              disabled={disabled || !newName.trim() || !images.length}
            >
              <Plus size={18} />
            </button>
          </form>
          <details className="class-source" open>
            <summary>{tr("照片与标本")}</summary>
            <label className="class-field">
              {tr("照片")}
              <select
                aria-label={tr("分类照片")}
                value={active?.id ?? ""}
                disabled={disabled}
                onChange={(e) => setPhotoId(e.target.value)}
              >
                <option value="" disabled>
                  {tr("导入照片后设置")}
                </option>
                {images.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="class-field">
              {tr("所属标本")}
              <select
                aria-label={tr("所属标本")}
                value={active?.classification?.specimenId ?? ""}
                disabled={disabled || !active}
                onChange={(e) => setSpecimen(e.target.value)}
              >
                <option value="">{tr("未指定")}</option>
                {specimenIds.map((id) => (
                  <option key={id} value={id}>
                    {images.find((e) => e.classification?.specimenId === id)
                      ?.specimen || id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            <form
              className="class-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (specimenName.trim()) {
                  setSpecimen(crypto.randomUUID(), specimenName.trim());
                  setSpecimenName("");
                }
              }}
            >
              <input
                aria-label={tr("新标本名称")}
                placeholder={tr("新标本编号")}
                maxLength={80}
                value={specimenName}
                disabled={disabled || !active}
                onChange={(e) => setSpecimenName(e.target.value)}
              />
              <button
                type="submit"
                aria-label={tr("创建标本")}
                disabled={disabled || !active || !specimenName.trim()}
              >
                <Plus size={16} />
              </button>
            </form>
            <p>
              {tr("同一标本的多张照片请选择同一编号，不按文件名自动推断。")}
            </p>
            {chosen.length > 0 && active?.classification?.specimenId && (
              <button
                className="class-source-apply"
                disabled={disabled}
                onClick={() => {
                  const ids = new Set(chosen.map((r) => r.entry.id));
                  onChange((e) =>
                    ids.has(e.id)
                      ? {
                          ...e,
                          specimen: active.specimen,
                          classification: {
                            ...(e.classification ?? emptyClassification()),
                            specimenId: active.classification!.specimenId,
                          },
                        }
                      : e,
                  );
                  setStatus(
                    `已将当前标本应用到选中骨针的 ${ids.size} 张来源照片。`,
                  );
                }}
              >
                {tr("将此标本用于选中的")}{" "}
                {new Set(chosen.map((r) => r.entry.id)).size} {tr("张照片")}
              </button>
            )}
            {active?.study?.partition &&
              active.study.partition !== "unassigned" && (
                <p>
                  {tr("分区：")}
                  {active.study.partition}
                  {tr("（锁定）")}
                </p>
              )}
          </details>
        </aside>
        <div className="classification-review">
          <div className="class-review-toolbar">
            <button
              aria-label={tr("撤销标注")}
              title={
                undoAction?.task === task
                  ? tr("撤销：{0} · ⌘/Ctrl Z", undoAction.name)
                  : tr("撤销标注 · 最近 20 步")
              }
              disabled={disabled || !undoAction || undoAction.task !== task}
              onClick={() => restoreLabels(false)}
            >
              <Undo2 size={17} />
            </button>
            <button
              aria-label={tr("重做标注")}
              title={tr("重做标注 · ⌘/Ctrl Shift Z")}
              disabled={disabled || !redoAction || redoAction.task !== task}
              onClick={() => restoreLabels(true)}
            >
              <Redo2 size={17} />
            </button>
            <button
              className="button select-all"
              disabled={disabled || !filtered.length}
              onClick={() =>
                setSelected(
                  chosen.length === filtered.length
                    ? new Set()
                    : new Set(filtered.map(token)),
                )
              }
            >
              {chosen.length === filtered.length && filtered.length
                ? tr("取消全选")
                : tr("全选列表")}
              <span>{filtered.length}</span>
            </button>
            <label className="class-search">
              <Search size={15} />
              <input
                aria-label={tr("搜索分类骨针")}
                placeholder={tr("照片 / 标本")}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <button
              title={tr("导出分类结果 CSV")}
              aria-label={tr("导出分类结果 CSV")}
              disabled={!rows.length || disabled}
              onClick={() =>
                void saveBlob(
                  new Blob([resultsCsv(rows, task, cats)], {
                    type: "text/csv;charset=utf-8",
                  }),
                  "sclerite-classification.csv",
                ).catch((e) => setError(String(e)))
              }
            >
              <Download size={18} />
            </button>
          </div>
          <div className="class-batch">
            <span>
              {tr("已选")} <b>{chosen.length}</b> {tr("枚")}
            </span>
            <select
              aria-label={tr("赋予类别")}
              value={category}
              disabled={disabled}
              onChange={(e) => setCategory(e.target.value)}
            >
              <option value="">{tr("选择人工类别")}</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              className="button primary"
              disabled={disabled || !chosen.length || !category}
              onClick={() => assign(category)}
            >
              <Check size={14} />
              {tr("确认类别")}
            </button>
            <button
              title={tr("清除选中人工标签")}
              aria-label={tr("清除选中人工标签")}
              disabled={disabled || !chosen.length}
              onClick={() => assign("")}
            >
              <X size={15} />
            </button>
          </div>
          <div className="class-scope-row">
            <label>
              {tr("来源")}
              <select
                aria-label={tr("筛选来源照片")}
                value={scope}
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="all">{tr("全部照片")}</option>
                {images.map((e, i) => (
                  <option key={e.id} value={e.id}>
                    {i + 1} · {e.name}
                  </option>
                ))}
              </select>
            </label>
            <span>
              {filter === "all"
                ? tr("完整骨针")
                : filter === "unlabeled"
                  ? tr("未标注")
                  : filter === "predicted"
                    ? tr("建议待复核")
                    : cats.find((c) => c.id === filter)?.name}{" "}
              · {filtered.length} {tr("枚")}
            </span>
          </div>
          <div className="class-grid" aria-label={tr("完整骨针列表")}>
            {!rows.length && !preparing && (
              <div className="class-empty">
                <Tags size={32} />
                <h2>{tr("先确认完整骨针")}</h2>
                <p>{tr("在图像处理页勾选完整对象，再来整理类别和训练。")}</p>
                <button className="button secondary" onClick={onProcess}>
                  {tr("前往图像处理")}
                </button>
              </div>
            )}
            {!!rows.length && !filtered.length && (
              <div className="class-empty">
                <p>{tr("当前筛选下没有骨针。")}</p>
                <button
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                    setScope("all");
                  }}
                >
                  {tr("显示全部")}
                </button>
              </div>
            )}
            {visible.map((r) => {
              const a = annotation(r, task),
                p = a?.prediction,
                best = p ? predictionBest(p) : undefined,
                selectedRow = selected.has(token(r)),
                stale = p && p.model !== taskModel?.id;
              return (
                <article
                  key={token(r)}
                  className={`class-card ${selectedRow ? "selected" : ""}`}
                >
                  <button
                    className="class-card-select"
                    aria-label={tr(
                      "选择 {0} 骨针 {1}",
                      r.entry.name,
                      r.object.id,
                    )}
                    aria-pressed={selectedRow}
                    disabled={disabled}
                    onClick={(e) => {
                      const anchor = selectionAnchor.current;
                      setSelected((old) => {
                        const s =
                          e.metaKey || e.ctrlKey
                            ? new Set(old)
                            : new Set<string>();
                        if (e.shiftKey && anchor) {
                          const a = filtered.findIndex(
                              (item) => token(item) === anchor,
                            ),
                            b = filtered.indexOf(r);
                          if (a >= 0) {
                            filtered
                              .slice(Math.min(a, b), Math.max(a, b) + 1)
                              .forEach((item) => s.add(token(item)));
                            return s;
                          }
                        }
                        if (
                          old.has(token(r)) &&
                          (e.metaKey || e.ctrlKey || old.size === 1)
                        )
                          s.delete(token(r));
                        else s.add(token(r));
                        return s;
                      });
                      selectionAnchor.current = token(r);
                    }}
                  >
                    <ObjectPreview
                      entry={r.entry}
                      ids={[r.object.id]}
                      thumbnail
                    />
                    <span className="class-check">
                      {selectedRow && <Check size={13} />}
                    </span>
                    <span className="class-object-id">
                      {images.findIndex((e) => e.id === r.entry.id) + 1} · #
                      {r.object.id}
                    </span>
                  </button>
                  <div className="class-card-info">
                    <span title={r.entry.name}>{r.entry.name}</span>
                    <strong>
                      {cats.find((c) => c.id === a?.label)?.name ??
                        tr("未标注")}
                    </strong>
                    <span
                      className="class-specimen-label"
                      title={r.entry.specimen}
                    >
                      {r.entry.classification?.specimenId
                        ? r.entry.specimen
                        : tr("标本待指定")}
                    </span>
                    {best && (
                      <small className={stale ? "stale" : "suggestion"}>
                        {stale ? tr("旧模型") : tr("建议")} ·{" "}
                        {cats.find((c) => c.id === best.id)?.name ??
                          taskModel?.classes.find((c) => c.id === best.id)
                            ?.name ??
                          tr("未知类别")}{" "}
                        <b>{(best.score * 100).toFixed(1)}%</b>
                      </small>
                    )}
                    <button
                      onClick={() => setPreview(r)}
                      title={tr("放大复核")}
                    >
                      {tr("查看原图")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
          <footer className="class-review-footer">
            <span
              title={tr(
                "Command / Ctrl + A 全选筛选后的列表；Shift 点击选择连续范围",
              )}
            >
              {tr("⌘ / Ctrl 多选 · Shift 连选")}
            </span>
            <div>
              <button
                aria-label={tr("分类上一页")}
                disabled={pageIndex === 0}
                onClick={() => setPage(pageIndex - 1)}
              >
                <ChevronLeft size={16} />
              </button>
              {pageIndex + 1} / {totalPages}
              <button
                aria-label={tr("分类下一页")}
                disabled={pageIndex + 1 >= totalPages}
                onClick={() => setPage(pageIndex + 1)}
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </footer>
        </div>
        <aside className="classification-model">
          <div className="class-section-heading">
            <strong>{tr("分类器")}</strong>
            <span className="class-model-dot" />
          </div>
          <div className="class-model-card">
            <Tags size={24} />
            <h2>
              {taskModel
                ? tr("MobileNetV4 + 轻量分类层")
                : tr("建立自己的分类器")}
            </h2>
            <p>
              {taskModel
                ? tr(
                    "{0} 类 · {1} 枚训练骨针",
                    taskModel.classes.length,
                    taskModel.samples.filter((s) => s.partition === "train")
                      .length,
                  )
                : tr("可先准备特征；标注至少两个类别后即可训练。")}
            </p>
            {taskModel && (
              <>
                <span
                  className={`class-model-state ${taskModel.formal ? "evaluated" : ""}`}
                >
                  {taskModel.formal
                    ? tr("包含独立测试结果")
                    : tr("试用 · 未独立验证")}
                </span>
                <small>
                  {tr("模型")} {taskModel.id.slice(0, 8)} ·{" "}
                  {taskModel.backend === "cpu" ? "CPU" : "Core ML CPU/GPU"}
                </small>
                <small>
                  {tr("训练于")}{" "}
                  {new Date(taskModel.created * 1000).toLocaleString()}
                </small>
                <p
                  className={`class-freshness ${freshness === "outdated" ? "outdated" : ""}`}
                  role="status"
                >
                  {freshness === "outdated"
                    ? tr(
                        "标签或训练数据已更新。旧模型仍可预测，但尚未包含这些修改。",
                      )
                    : freshness === "current"
                      ? tr("模型与当前训练标签一致")
                      : freshness === "external"
                        ? tr("当前项目不是该模型的训练集，可直接预测。")
                        : freshness === "unknown"
                          ? tr("旧模型未记录数据快照，无法核对是否过期。")
                          : tr("正在核对模型与训练数据…")}
                </p>
                {!taskModel.head.converged && (
                  <p className="class-warning">{tr("优化尚未收敛")}</p>
                )}
              </>
            )}
          </div>
          {!native && (
            <p className="class-warning">
              {tr("浏览器可整理标签。模型训练、加载和预测需在桌面版运行。")}
            </p>
          )}
          <button
            className="button secondary class-main-action"
            disabled={
              !native || disabled || !rows.length || !selectedEncoder?.available
            }
            onClick={() => void prepareFeatures()}
          >
            {tr("准备特征")}
          </button>
          <p className="class-readiness" data-testid="feature-readiness">
            {tr("本次已确认缓存")} {preparedCount}/{rows.length}{" "}
            {tr(
              "枚。包括未标注骨针，不受列表筛选影响；重开后再次准备会复用磁盘缓存。",
            )}
          </p>
          <button
            className="button primary class-main-action"
            disabled={!native || disabled || !selectedEncoder?.available}
            title={tr(trainHint)}
            onClick={() => setAuditOpen(true)}
          >
            {job && <LoaderCircle className="spin" size={16} />}
            {tr("训练分类器")}
          </button>
          <p className={`class-readiness ${canTrain ? "ready" : ""}`}>
            {canTrain && <Check size={12} />} {tr(trainHint)}
          </p>
          <button
            className="class-export-model"
            disabled={disabled}
            onClick={() => setAuditOpen(true)}
          >
            {tr("查看训练前检查")}
          </button>
          <div className="class-model-actions">
            <button
              className="button secondary"
              disabled={!native || disabled}
              onClick={() => modelInput.current?.click()}
            >
              <FolderOpen size={15} />
              {tr("加载模型")}
            </button>
            <button
              className="button secondary"
              disabled={!native || disabled || !taskModel || !filtered.length}
              onClick={() => void predict()}
            >
              {tr("预测")}{" "}
              {chosen.length
                ? tr("选中 {0} 枚", chosen.length)
                : tr("当前列表")}
            </button>
          </div>
          <button
            className="button secondary class-main-action"
            disabled={
              disabled ||
              !taskModel ||
              !chosen.some(
                (r) => annotation(r, task)?.prediction?.model === taskModel.id,
              )
            }
            onClick={accept}
          >
            <Check size={15} />
            {tr("接受选中建议")}
          </button>
          <details className="class-training-options">
            <summary>{tr("训练与验证设置")}</summary>
            <label className="class-field">
              {tr("特征模型")}
              <select
                aria-label={tr("特征模型")}
                value={encoder}
                disabled={disabled}
                onChange={(e) => {
                  setEncoder(e.target.value);
                  if (e.target.value !== "mobilenetv4-small") setBackend("cpu");
                  setStatus(
                    "标签与数据划分保留；不同特征模型的分类器分别保存。",
                  );
                }}
              >
                {encoders.map((e) => (
                  <option key={e.id} value={e.id} disabled={!e.available}>
                    {tr(e.name)}
                    {e.available ? "" : tr(" · 尚未安装验证")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={formal}
                disabled={disabled}
                onChange={(e) => setFormal(e.target.checked)}
              />
              {tr("按独立标本分组评估")}
            </label>
            <p>
              {tr(
                "每类至少 3 个独立组；同一原图、标本、群体和出版物不跨分区。不足时请使用试用模型。",
              )}
            </p>
            <label>
              <input
                type="checkbox"
                checked={autoRegularization}
                disabled={disabled || !formal}
                onChange={(e) => setAutoRegularization(e.target.checked)}
              />
              {tr("用验证集选择正则强度")}
            </label>
            <p>
              {formal && autoRegularization
                ? tr(
                    "仅比较 3 个候选值，测试集不参与选择。同分时保留较强正则。",
                  )
                : tr("当前使用固定 λ=0.001，不进行自动调参。")}
            </p>
            <label className="class-field">
              {tr("运行后端")}
              <select
                value={backend}
                disabled={disabled}
                onChange={(e) => setBackend(e.target.value as typeof backend)}
              >
                <option value="cpu">{tr("CPU · 默认参考后端")}</option>
                {/Mac/.test(navigator.platform) && (
                  <option value="coreml" disabled={encoder === "dinov3-vits16"}>
                    {tr("Core ML · CPU/GPU（实验）")}
                  </option>
                )}
              </select>
            </label>
            <p>
              {tr("冻结")} {tr(selectedEncoder?.name ?? "")} ·{" "}
              {selectedEncoder?.dim}{" "}
              {tr(
                "维 · 轻量逻辑回归。NPU 不启用。改标签只重训分类层；改图像或 mask 需重新准备特征。",
              )}
            </p>
            {encoder === "dinov3-vits16" && (
              <p>
                {tr(
                  "DINOv3 当前使用 CPU；首次准备较慢，之后复用缓存。Meta 许可随应用及模型包提供。",
                )}
              </p>
            )}
          </details>
          {taskModel?.regularization && (
            <details className="class-evaluation">
              <summary>
                {tr("分类器设置 · λ=")}
                {taskModel.regularization.lambda}
              </summary>
              <p>
                {taskModel.regularization.selected_on === "validation"
                  ? tr("由验证集 Macro-F1 选择，不使用测试集")
                  : tr("固定正则强度（未自动选择）")}
              </p>
              {taskModel.regularization.candidates.map((c) => (
                <p key={c.lambda}>
                  λ={c.lambda} {tr("· 验证 F1")}{" "}
                  {(100 * c.validation_macro_f1).toFixed(1)}%
                  {c.converged ? "" : tr(" · 未收敛，未参与选择")}
                </p>
              ))}
            </details>
          )}
          {taskModel?.formal && (
            <details className="class-evaluation">
              <summary>{tr("独立评估结果")}</summary>
              {Object.entries(taskModel.evaluation).map(([p, m]) => (
                <div key={p}>
                  <strong>
                    {p === "test" ? tr("测试集") : tr("验证集")} macro-F1{" "}
                    {(m.macro_f1 * 100).toFixed(1)}%
                  </strong>
                  <p>
                    {m.groups} {tr("组 ·")} {m.count}{" "}
                    {tr("枚；行是真值，列是预测")}
                  </p>
                  <div className="class-confusion">
                    <table>
                      <thead>
                        <tr>
                          <th />
                          <>
                            {taskModel.classes.map((c) => (
                              <th key={c.id}>{c.name}</th>
                            ))}
                          </>
                        </tr>
                      </thead>
                      <tbody>
                        {m.confusion.map((row, i) => (
                          <tr key={i}>
                            <th>{taskModel.classes[i].name}</th>
                            {row.map((n, j) => (
                              <td key={j}>{n}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
              <p>{tr("少量独立标本的结果仍不代表可靠物种界定。")}</p>
            </details>
          )}
          {taskModel && (
            <button
              className="class-export-model"
              disabled={disabled}
              onClick={() => void exportModel()}
            >
              <Download size={14} />
              {tr("导出完整模型包")}
            </button>
          )}
          <p className="class-footnote">
            {tr("预测分数不是物种真实概率。模型建议不会自动覆盖人工类别。")}
          </p>
        </aside>
      </div>
      {(job || status || error || preparing) && (
        <div className={`class-status ${error ? "error" : ""}`} role="status">
          {job ? (
            <>
              <LoaderCircle className="spin" size={16} />
              <span>
                {tr(job)}
                {progress.total
                  ? ` · ${progress.completed}/${progress.total}`
                  : ""}
              </span>
              <button
                disabled={cancelling}
                onClick={() => {
                  cancelled.current = true;
                  setCancelling(true);
                  void invoke("classifier_cancel");
                }}
              >
                {cancelling ? tr("正在取消…") : tr("取消任务")}
              </button>
            </>
          ) : (
            <>
              <span>
                {tr(error || (preparing ? "检查完整骨针身份…" : status))}
              </span>
              {error && (
                <button
                  aria-label={tr("关闭分类提示")}
                  onClick={() => setError("")}
                >
                  <X size={16} />
                </button>
              )}
            </>
          )}
        </div>
      )}
      {auditOpen && (
        <div className="modal-backdrop" onClick={() => setAuditOpen(false)}>
          <div
            ref={auditDialog}
            className="dialog class-audit-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={tr("训练前检查")}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dialog-close"
              aria-label={tr("关闭训练前检查")}
              autoFocus
              onClick={() => setAuditOpen(false)}
            >
              <X size={20} />
            </button>
            <h2>{tr("训练前检查")}</h2>
            <p>
              {tr("本次使用全部已确认的人工标签，不受列表筛选或选中范围影响。")}
            </p>
            <label className="class-audit-mode">
              <input
                type="checkbox"
                checked={formal}
                disabled={disabled}
                onChange={(e) => setFormal(e.target.checked)}
              />
              {tr("按独立标本分组评估")}
            </label>
            <div className="class-audit-summary">
              <b>
                {audit.count} {tr("枚已标注")}
              </b>
              <span>
                {cats.length} {tr("类")}
              </span>
              <span>
                {audit.missingSpecimens} {tr("张缺少标本编号")}
              </span>
            </div>
            <div className="class-confusion">
              <table>
                <thead>
                  <tr>
                    <th>{tr("类别")}</th>
                    <th>{tr("骨针")}</th>
                    <th>{tr("标本")}</th>
                    <th>{tr("独立组")}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.classes.map((c) => (
                    <tr key={c.id}>
                      <th>{c.name}</th>
                      <td>{c.count}</td>
                      <td>{c.specimens}</td>
                      <td>{c.groups ?? tr("待检查")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              {tr(
                "同一原图、标本、群体或出版物合并为不可拆分组；标本数量不一定等于独立组数量。",
              )}
            </p>
            {audit.plan && !audit.errors.length && (
              <div className="class-audit-pass">
                {tr("检查通过 ·")} {tr(audit.plan.reason)}
                <br />
                {(["train", "validation", "test"] as const)
                  .map((p, i) =>
                    tr(
                      "{0} {1} 枚",
                      tr(["训练", "验证", "测试"][i]),
                      audit.plan!.rows.filter(
                        (r) =>
                          audit.plan!.partitions.get(
                            audit.plan!.groups.get(r.key)!,
                          ) === p,
                      ).length,
                    ),
                  )
                  .join(" · ")}
              </div>
            )}
            {audit.errors.length > 0 && (
              <div className="class-audit-errors" role="alert">
                <strong>{tr("需先解决")}</strong>
                <ul>
                  {audit.errors.map((s) => (
                    <li key={s}>{tr(s)}</li>
                  ))}
                </ul>
              </div>
            )}
            {audit.warnings.length > 0 && (
              <ul className="class-audit-warnings">
                {audit.warnings.map((s) => (
                  <li key={s}>{tr(s)}</li>
                ))}
              </ul>
            )}
            {!native && <p>{tr("浏览器仅检查数据；请在桌面版开始训练。")}</p>}
            <div className="class-audit-actions">
              <button
                className="button secondary"
                onClick={() => setAuditOpen(false)}
              >
                {tr("返回整理标签")}
              </button>
              <button
                className="button primary"
                disabled={
                  !native || disabled || !!audit.errors.length || !audit.plan
                }
                onClick={() => {
                  setAuditOpen(false);
                  void train();
                }}
              >
                {tr("开始训练")}
              </button>
            </div>
          </div>
        </div>
      )}
      {preview && (
        <div className="modal-backdrop" onClick={() => setPreview(null)}>
          <div
            className="dialog class-preview-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dialog-close"
              aria-label={tr("关闭骨针预览")}
              onClick={() => setPreview(null)}
            >
              <X size={20} />
            </button>
            <h2>
              {preview.entry.name} · #{preview.object.id}
            </h2>
            <ObjectPreview
              entry={preview.entry}
              ids={[preview.object.id]}
              overlay
            />
            <p>
              {tr("原始照片及实例边界。分类输入仅保留该枚骨针，背景填灰。")}
            </p>
          </div>
        </div>
      )}
      {rename && (
        <div className="modal-backdrop" onClick={() => setRename(null)}>
          <form
            className="dialog class-rename-dialog"
            role="dialog"
            aria-label={tr("重命名类别")}
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              renameCategory();
            }}
          >
            <h2>{tr("重命名类别")}</h2>
            <input
              autoFocus
              aria-label={tr("类别新名称")}
              maxLength={80}
              value={rename.name}
              onChange={(e) => setRename({ ...rename, name: e.target.value })}
            />
            <p>{tr("只更新项目中的名称，不修改已保存模型的类别顺序。")}</p>
            <div>
              <button
                type="button"
                className="button secondary"
                onClick={() => setRename(null)}
              >
                {tr("取消")}
              </button>
              <button
                className="button primary"
                type="submit"
                disabled={!rename.name.trim()}
              >
                {tr("保存名称")}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
