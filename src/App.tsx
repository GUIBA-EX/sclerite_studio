import { LanguageSelect } from "./LanguageSelect";
import { tr, useLanguage } from "./i18n";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  CheckCheck,
  CircleHelp,
  Crosshair,
  Eraser,
  PanelLeft,
  PanelRight,
  PanelBottom,
  Redo2,
  Eye,
  FileImage,
  FileSpreadsheet,
  FolderOpen,
  Layers,
  LoaderCircle,
  Maximize2,
  MousePointer2,
  Paintbrush,
  Plus,
  Ruler,
  Save,
  ScanLine,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
  Combine,
  AlertCircle,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { COLORS, DEFAULTS } from "./types";
import type { Analysis, ImageEntry, Mode, Parameters, Point } from "./types";
import {
  csv,
  exportProject,
  importProject,
  loadImage,
  makeDemo,
  saveBlob,
} from "./io";
import { stroke, measureLabels } from "./engine";
import { parameterKey } from "./workspace";
import ObjectPreview from "./ObjectPreview";
import { DEFAULT_PLATE_SETTINGS } from "./plate";
import type { PlateItem, PlateBackground, PlateSettings } from "./plate";
import { readRecovery, writeRecovery, restoreRecovery } from "./recovery";
import type { Recovery } from "./recovery";
import PlateEditor from "./PlateEditor";
import ClassificationStudio from "./ClassificationStudio";
import appLogo from "../src-tauri/icons/128x128@2x.png";
import { IconButton, MOD } from "./ui";

type Job = { resolve: (r: Analysis) => void; reject: (e: Error) => void };
type WorkerRequest = {
  kind: "segment" | "measure" | "split";
  imageId: string;
  data?: Uint8ClampedArray;
  labels?: Int32Array;
  width: number;
  height: number;
  params: Parameters;
  ids?: number[];
  threshold?: number;
};
const fmt = (n: number, d = 1) =>
  Number.isFinite(n)
    ? n.toLocaleString("en-US", { maximumFractionDigits: d })
    : "—";
const tools: { id: Mode; icon: LucideIcon; label: string; tip: string }[] = [
  {
    id: "select",
    icon: MousePointer2,
    label: "选择",
    tip: `点击选择 · ${MOD} 点击多选 · 按住拖动平移`,
  },
  {
    id: "scale",
    icon: Ruler,
    label: "校准",
    tip: "沿比例尺拖动直线，然后输入实际长度",
  },
  {
    id: "cut",
    icon: Scissors,
    label: "切开",
    tip: "拖动切线拆开粘连骨针；会移除切线上的少量像素",
  },
  {
    id: "paint",
    icon: Paintbrush,
    label: "画笔",
    tip: "为选中骨针补画mask；未选中时创建新实例",
  },
  {
    id: "erase",
    icon: Eraser,
    label: "擦除",
    tip: "拖动擦除mask，自动拆分断开的区域",
  },
];

export default function App() {
  useLanguage();
  const [images, setImages] = useState<ImageEntry[]>([]),
    [activeId, setActiveId] = useState(""),
    [mode, setMode] = useState<Mode>("select");
  const [busy, setBusy] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<number[]>([]);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    run: () => void;
  } | null>(null);
  const [zoom, setZoom] = useState(1),
    [opacity, setOpacity] = useState(0.36),
    [brush, setBrush] = useState(9),
    [showMask, setShowMask] = useState(true),
    [showIds, setShowIds] = useState(true),
    [help, setHelp] = useState(false);
  const [peek, setPeek] = useState(false);
  const [tableOpen, setTableOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    try {
      return Math.max(
        170,
        Math.min(
          360,
          Number(localStorage.getItem("sclerite-sidebar-width")) || 210,
        ),
      );
    } catch {
      return 210;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("sclerite-sidebar-width", String(sidebarWidth));
    } catch {}
  }, [sidebarWidth]);
  const [future, setFuture] = useState<
    Record<
      string,
      {
        expected: Analysis | undefined;
        expectedNotes: ImageEntry["notes"];
        snapshots: ImageEntry["undo"];
      }
    >
  >({});
  const [panning, setPanning] = useState(false);
  const pan = useRef<{
    x: number;
    y: number;
    left: number;
    top: number;
    clickId?: number;
    moved?: boolean;
  } | null>(null);
  const [plateOpen, setPlateOpen] = useState(false);
  const [studioTab, setStudioTab] = useState<"process" | "classification">(
    "process",
  );
  const [classificationBusy, setClassificationBusy] = useState(false);
  const [plateItems, setPlateItems] = useState<PlateItem[]>([]);
  const [workspaceRevision, setWorkspaceRevision] = useState(0);
  const deletionDirty = useRef(false);
  const [plateSettings, setPlateSettings] = useState<PlateSettings>({
    ...DEFAULT_PLATE_SETTINGS,
  });
  const [plateBackground, setPlateBackground] =
    useState<PlateBackground>("white");
  const [savedToken, setSavedToken] = useState(0),
    [recovery, setRecovery] = useState<Recovery | null>(null),
    [recoveryReady, setRecoveryReady] = useState(false),
    [recoveryStatus, setRecoveryStatus] = useState("恢复副本准备中");
  const recoveryQueue = useRef(Promise.resolve());
  useEffect(() => {
    let alive = true;
    void readRecovery()
      .then((value) => {
        if (!alive) return;
        if (value?.images.length) {
          setRecovery(value);
          setRecoveryStatus("有上次工作可恢复");
        } else {
          setRecoveryReady(true);
          setRecoveryStatus("本地恢复已启用");
        }
      })
      .catch(() => {
        if (alive) {
          setRecoveryReady(true);
          setRecoveryStatus("本地恢复不可用，请手动保存");
        }
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!recoveryReady || !images.length || busy) return;
    setRecoveryStatus("等待保存恢复副本…");
    let current = true;
    const timer = setTimeout(() => {
      recoveryQueue.current = recoveryQueue.current
        .catch(() => {})
        .then(() =>
          writeRecovery(images, plateItems, plateBackground, plateSettings),
        );
      void recoveryQueue.current
        .then(() => {
          if (current) setRecoveryStatus("本地恢复副本已更新");
        })
        .catch(() => {
          if (current) setRecoveryStatus("恢复副本保存失败，请手动保存项目");
        });
    }, 3000);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [images, plateItems, plateBackground, plateSettings, recoveryReady, busy]);
  async function recover() {
    if (!recovery || busy) return;
    setBusy("恢复上次工作…");
    try {
      const loaded = await restoreRecovery(recovery);
      setImages(loaded);
      setActiveId(loaded[0]?.id ?? "");
      setPlateItems(recovery.items);
      setPlateSettings(recovery.settings ?? { ...DEFAULT_PLATE_SETTINGS });
      setPlateBackground(recovery.background === "black" ? "black" : "white");
      setSavedToken((n) => n + 1);
      setRecovery(null);
      setRecoveryReady(true);
      setNotice(
        "已恢复原图、mask、确认状态和版面；撤销历史不在恢复副本内。请保存项目作为正式备份。",
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
  }
  const [sidebarOpen, setSidebarOpen] = useState(
      () => window.innerWidth > 1200,
    ),
    [inspectorOpen, setInspectorOpen] = useState(true),
    [tableHeight, setTableHeight] = useState(() =>
      window.innerHeight < 820 ? 150 : 210,
    ),
    [reviewFilter, setReviewFilter] = useState("all");
  const [focusId, setFocusId] = useState<number | null>(null);
  const plateDirty = useRef(false);
  const onPlateDirty = useCallback((dirty: boolean) => {
    plateDirty.current = dirty;
  }, []);
  const [line, setLine] = useState<{ a: Point; b: Point } | null>(null),
    [scaleLine, setScaleLine] = useState<{ a: Point; b: Point } | null>(null),
    [scaleDistance, setScaleDistance] = useState("100");
  const [draft, setDraft] = useState<Int32Array | null>(null),
    [revision, setRevision] = useState(0),
    [viewerSize, setViewerSize] = useState({ w: 800, h: 600 });
  const fileInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    viewer = useRef<HTMLDivElement>(null),
    worker = useRef<Worker | null>(null),
    jobs = useRef(new Map<string, Job>()),
    imagesRef = useRef(images);
  const gesture = useRef<{
    start: Point;
    last: Point;
    labels?: Int32Array;
    id: number;
    touched: Set<number>;
  } | null>(null);
  const savedImages = useRef<ImageEntry[] | null>(null);
  imagesRef.current = images;
  const active = images.find((i) => i.id === activeId),
    objects = active?.analysis?.objects ?? [],
    selectedObject = objects.find((o) => o.id === selected[0]);
  const unit = active?.calibration ? "μm" : "px",
    factor = active?.calibration?.umPerPixel ?? 1,
    total = images.reduce((s, e) => s + (e.analysis?.objects.length ?? 0), 0);
  const approvedCount = images.reduce(
    (s, e) => s + (e.analysis?.approvedIds?.length ?? 0),
    0,
  );
  const visibleObjects = objects.filter((o) =>
    reviewFilter === "pending"
      ? !active?.analysis?.approvedIds?.includes(o.id)
      : reviewFilter === "approved"
        ? active?.analysis?.approvedIds?.includes(o.id)
        : reviewFilter === "split"
          ? active?.analysis?.splitEvents?.some((g) =>
              g.childIds.includes(o.id),
            )
          : true,
  );
  const selectedGroup = active?.analysis?.splitEvents?.find((g) =>
    g.childIds.includes(selected[0]),
  );
  const allVisibleSelected =
    visibleObjects.length > 0 &&
    visibleObjects.every((o) => selected.includes(o.id));
  const allSelectedApproved =
    selected.length > 0 &&
    selected.every((id) => active?.analysis?.approvedIds?.includes(id));
  const stale =
    !!active?.analysis &&
    active.analysis.parameterKey !== parameterKey(active.params);
  function selectObject(id: number) {
    setSelected([id]);
    setFocusId(id);
    document
      .querySelector(`[data-object-id="${id}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }
  function nextObject(direction: number) {
    if (!visibleObjects.length) return;
    const at = visibleObjects.findIndex((o) => o.id === selected[0]);
    selectObject(
      visibleObjects[
        Math.max(0, Math.min(visibleObjects.length - 1, at + direction))
      ].id,
    );
  }
  function revertGroup() {
    if (!active?.analysis || !selectedGroup || busy) return;
    const a = active.analysis,
      group = selectedGroup;
    const ids = new Set(group.childIds),
      labels = a.labels.slice();
    const target = group.childIds[0];
    for (let i = 0; i < labels.length; i++)
      if (ids.has(labels[i])) labels[i] = target;
    const hints = { ...a.reviewHints };
    for (const id of ids) delete hints[id];
    hints[target] = "已撤销自动切分；接触组合请复核";
    update(active.id, (e) => ({
      ...e,
      notes: Object.fromEntries(
        Object.entries(e.notes).filter(([id]) => !ids.has(Number(id))),
      ),
      analysis: {
        ...a,
        labels,
        objects: measureLabels(labels, e.width, e.height),
        revision: crypto.randomUUID(),
        reviewHints: hints,
        approvedIds: a.approvedIds?.filter((id) => !ids.has(id)),
        splitEvents: a.splitEvents?.filter((g) => g !== group),
      },
      undo: [...e.undo, { analysis: a, notes: e.notes }].slice(-5),
    }));
    selectObject(target);
    setNotice("已恢复该组接触组合；像素未增减，其他组的确认保持不变。");
  }
  function approveSelected(approve: boolean, targets = selected) {
    if (!active?.analysis || busy) return;
    update(active.id, (e) => {
      const a = e.analysis!;
      const ids = new Set(a.approvedIds ?? []);
      for (const id of targets) {
        if (approve && a.objects.some((o) => o.id === id && !o.border))
          ids.add(id);
        else ids.delete(id);
      }
      return {
        ...e,
        analysis: { ...a, approvedIds: [...ids] },
        undo: [...e.undo, { analysis: a, notes: e.notes }].slice(-20),
      };
    });
    setNotice(
      approve
        ? "已标记为人工确认完整。结果导出仅包含已确认对象。"
        : "已撤销完整确认，不再纳入结果导出。",
    );
  }

  useEffect(() => {
    const w = new Worker(new URL("./processor.worker.ts", import.meta.url), {
      type: "module",
    });
    worker.current = w;
    w.onmessage = (e) => {
      const job = jobs.current.get(e.data.requestId);
      if (!job) return;
      jobs.current.delete(e.data.requestId);
      e.data.error
        ? job.reject(new Error(e.data.error))
        : job.resolve(e.data.result);
    };
    w.onerror = () => {
      for (const j of jobs.current.values())
        j.reject(new Error("处理线程异常，请重新打开项目。"));
      jobs.current.clear();
    };
    return () => {
      w.terminate();
      for (const j of jobs.current.values()) j.reject(new Error("已取消"));
      jobs.current.clear();
    };
  }, []);
  const request = useCallback(
    (data: WorkerRequest) =>
      new Promise<Analysis>((resolve, reject) => {
        const id = crypto.randomUUID();
        jobs.current.set(id, { resolve, reject });
        worker.current!.postMessage({ ...data, requestId: id });
      }),
    [],
  );
  useEffect(() => {
    const node = viewer.current;
    if (!node) return;
    const obs = new ResizeObserver(([e]) =>
      setViewerSize({ w: e.contentRect.width, h: e.contentRect.height }),
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    setSelected([]);
    setDraft(null);
    setZoom(1);
    setFocusId(null);
    setLine(null);
    setScaleLine(null);
    gesture.current = null;
    pan.current = null;
    setPanning(false);
  }, [activeId]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    const dirty = () =>
      deletionDirty.current ||
      plateDirty.current ||
      (imagesRef.current.length > 0 &&
        imagesRef.current !== savedImages.current);
    const listener = (e: BeforeUnloadEvent) => {
      if (dirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", listener);
    let disposed = false,
      unlisten: (() => void) | undefined;
    if ("__TAURI_INTERNALS__" in window)
      void import("@tauri-apps/api/window")
        .then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          const off = await win.onCloseRequested((event) => {
            if (!dirty()) return;
            event.preventDefault();
            setConfirmation({
              message:
                "项目或版面有尚未保存的修改。保存项目会同时保存版面；本地恢复副本不能代替正式备份。确定退出？",
              run: () => {
                void win.destroy().catch((e) => setError(String(e)));
              },
            });
          });
          if (disposed) off();
          else unlisten = off;
        })
        .catch((e) => setError(`无法启用退出保护：${String(e)}`));
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("beforeunload", listener);
    };
  }, []);

  const update = (id: string, fn: (e: ImageEntry) => ImageEntry) =>
    setImages((old) => old.map((e) => (e.id === id ? fn(e) : e)));
  function removeImage(id: string) {
    if (busy) return;
    const entry = images.find((e) => e.id === id);
    if (!entry) return;
    const count = plateItems.filter((i) => i.sourceId === id).length;
    setConfirmation({
      message: `从当前工作空间移除“${entry.name}”？该照片的分割和确认记录${count ? `及排版中的 ${count} 枚对象` : ""}将一并移除。不会删除磁盘上的原始照片；已保存的项目文件不受影响。`,
      run: () => {
        const remaining = imagesRef.current.filter((e) => e.id !== id);
        const nextPlate = plateItems.filter((i) => i.sourceId !== id);
        deletionDirty.current = remaining.length > 0 || nextPlate.length > 0;
        setImages(remaining);
        setPlateItems(nextPlate);
        setWorkspaceRevision((n) => n + 1);
        setFuture((f) => {
          const next = { ...f };
          delete next[id];
          return next;
        });
        if (activeId === id) setActiveId(remaining[0]?.id ?? "");
        URL.revokeObjectURL(entry.url);
        recoveryQueue.current = recoveryQueue.current
          .catch(() => {})
          .then(() =>
            writeRecovery(remaining, nextPlate, plateBackground, plateSettings),
          );
        void recoveryQueue.current
          .then(() => setRecoveryStatus("本地恢复副本已更新"))
          .catch(() =>
            setRecoveryStatus("移除后的恢复副本保存失败，请保存项目"),
          );
        setNotice(
          `已从工作空间移除 ${entry.name}。原始照片和已保存的项目文件未删除。`,
        );
      },
    });
  }
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  async function importFiles(files: FileList | File[]) {
    if (imagesRef.current.length + files.length > 30) {
      setError(
        "每个项目最多30张图像。请先保存当前项目，再重新打开软件处理下一批。",
      );
      return;
    }
    if (busy) return;
    setBusy("读取图像…");
    setError("");
    let first = "";
    let errors: string[] = [];
    for (const file of Array.from(files))
      try {
        const image = await loadImage(file);
        setImages((old) => [...old, image]);
        first ||= image.id;
      } catch (e) {
        errors.push(
          `${file.name}：${e instanceof Error ? e.message : String(e)}`,
        );
      }
    if (first) {
      setActiveId(first);
      setNotice("图像已导入。先检查尺度，再运行分割。");
    }
    if (errors.length) setError(errors.join("\n"));
    setBusy("");
  }
  async function demo() {
    if (busy) return;
    if (images.length >= 30) {
      setError("每个项目最多30张图像。");
      return;
    }
    setBusy("生成演示图…");
    try {
      const image = await makeDemo();
      setImages((old) => [...old, image]);
      setActiveId(image.id);
      setNotice("演示图为合成测试数据；含12个模拟骨针，其中2枚相交。");
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
  }
  async function run(all = false, confirmed = false) {
    if (!active || busy) return;
    setError("");
    const targets = all ? images : [active];
    if (!confirmed && targets.some((e) => e.analysis)) {
      setConfirmation({
        message:
          "重新分割会替换现有mask，并清空对应形态备注。可撤销最近5次mask操作；建议先保存项目。",
        run: () => {
          void run(all, true);
        },
      });
      return;
    }
    try {
      for (let i = 0; i < targets.length; i++) {
        const entry = targets[i];
        setBusy(`分割 ${i + 1}/${targets.length} · ${entry.name}`);
        const analysis = await request({
          kind: "segment",
          imageId: entry.id,
          data: entry.data,
          width: entry.width,
          height: entry.height,
          params: entry.params,
        });
        update(entry.id, (e) => ({
          ...e,
          analysis: {
            ...analysis,
            classificationEpoch: crypto.randomUUID(),
            revision: crypto.randomUUID(),
            parameterKey: parameterKey(entry.params),
          },
          notes: {},
          undo: e.analysis
            ? [...e.undo, { analysis: e.analysis, notes: e.notes }].slice(-5)
            : [],
        }));
      }
      setSelected([]);
      setNotice(
        "自动处理完成。切分边界仍需复核；在测量表右侧勾选确认。真正遮挡对象请删除，不补全不可见轮廓。",
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
  }
  async function commit(labels: Int32Array, splitIds: number[] = []) {
    if (!active) return;
    const entry = active;
    setBusy("更新轮廓与测量…");
    try {
      const analysis = await request({
        kind: splitIds.length ? "split" : "measure",
        imageId: entry.id,
        labels,
        data: entry.data,
        width: entry.width,
        height: entry.height,
        params: entry.params,
        ids: splitIds,
        threshold: entry.analysis?.threshold,
      });
      update(entry.id, (e) => ({
        ...e,
        analysis: {
          ...analysis,
          classificationEpoch:
            e.analysis?.classificationEpoch ?? e.analysis?.revision ?? e.id,
          revision: crypto.randomUUID(),
          parameterKey: e.analysis?.parameterKey ?? parameterKey(e.params),
          approvedIds: [],
          splitEvents: [],
          rejected: [
            ...(e.analysis?.rejected ?? []),
            ...(analysis.rejected ?? []),
          ],
        },
        undo: e.analysis
          ? [...e.undo, { analysis: e.analysis, notes: e.notes }].slice(-5)
          : [],
      }));
      setSelected((ids) =>
        ids.filter((id) => analysis.objects.some((o) => o.id === id)),
      );
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
      setDraft(null);
    }
  }
  function undo() {
    if (!active || !active.undo.length || busy) return;
    const prior = active.undo.at(-1)!;
    if (active.analysis)
      setFuture((f) => ({
        ...f,
        [active.id]: {
          expected: prior.analysis,
          expectedNotes: prior.notes,
          snapshots: [
            ...(f[active.id]?.expected === active.analysis &&
            f[active.id]?.expectedNotes === active.notes
              ? f[active.id].snapshots
              : []),
            { analysis: active.analysis!, notes: active.notes },
          ],
        },
      }));
    update(active.id, (e) => ({
      ...e,
      analysis: e.undo.at(-1)!.analysis,
      notes: e.undo.at(-1)!.notes,
      undo: e.undo.slice(0, -1),
    }));
    setSelected([]);
  }
  function redo() {
    if (!active || busy) return;
    const f = future[active.id];
    if (
      !f?.snapshots.length ||
      f.expected !== active.analysis ||
      f.expectedNotes !== active.notes
    )
      return;
    const next = f.snapshots.at(-1)!;
    update(active.id, (e) => ({
      ...e,
      ...next,
      undo: e.analysis
        ? [...e.undo, { analysis: e.analysis, notes: e.notes }].slice(-20)
        : e.undo,
    }));
    setFuture((old) => ({
      ...old,
      [active.id]: {
        expected: next.analysis,
        expectedNotes: next.notes,
        snapshots: f.snapshots.slice(0, -1),
      },
    }));
    setSelected([]);
  }
  async function removeSelected() {
    if (!active?.analysis || !selected.length || busy) return;
    const ids = new Set(selected),
      labels = active.analysis.labels.slice();
    for (let i = 0; i < labels.length; i++)
      if (ids.has(labels[i])) labels[i] = 0;
    await commit(labels);
    setSelected([]);
  }
  async function merge() {
    if (!active?.analysis || selected.length < 2 || busy) return;
    const ids = new Set(selected),
      target = Math.min(...selected),
      labels = active.analysis.labels.slice();
    for (let i = 0; i < labels.length; i++)
      if (ids.has(labels[i])) labels[i] = target;
    await commit(labels);
    setSelected([target]);
    setNotice("实例已合并。分离碎片会作为同一个对象测量，请核查。");
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        plateOpen ||
        studioTab === "classification" ||
        confirmation ||
        error ||
        help ||
        busy
      )
        return;
      if (
        (e.target as HTMLElement)?.closest(
          "input,textarea,select,[contenteditable=true]",
        )
      )
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        setSelected(visibleObjects.map((o) => o.id));
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (images.length) void save(false);
        return;
      }
      if ((e.target as HTMLElement)?.closest("button")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        nextObject(e.key === "ArrowDown" ? 1 : -1);
      }
      if (e.code === "Space" && selected.length === 1) {
        e.preventDefault();
        const next =
          visibleObjects[
            visibleObjects.findIndex((o) => o.id === selected[0]) + 1
          ];
        approveSelected(true);
        if (next) selectObject(next.id);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === "Escape") {
        setSelected([]);
        setScaleLine(null);
        setHelp(false);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        void removeSelected();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  useEffect(() => {
    if (!canvas.current || !active) return;
    const c = canvas.current;
    c.width = active.width;
    c.height = active.height;
    const ctx = c.getContext("2d")!;
    const display = new Uint8ClampedArray(active.data),
      labels = draft ?? active.analysis?.labels,
      ids = new Set(selected);
    if (labels && showMask && !peek)
      for (let i = 0; i < labels.length; i++) {
        const id = labels[i];
        if (!id) continue;
        const color = COLORS[(id - 1) % COLORS.length],
          a = ids.has(id) ? Math.min(0.8, opacity + 0.22) : opacity;
        for (let ch = 0; ch < 3; ch++)
          display[i * 4 + ch] =
            display[i * 4 + ch] * (1 - a) +
            parseInt(color.slice(1 + ch * 2, 3 + ch * 2), 16) * a;
        const x = i % active.width,
          y = Math.floor(i / active.width);
        if (
          x === 0 ||
          y === 0 ||
          x === active.width - 1 ||
          y === active.height - 1 ||
          labels[i - 1] !== id ||
          labels[i + 1] !== id ||
          labels[i - active.width] !== id ||
          labels[i + active.width] !== id
        )
          for (let ch = 0; ch < 3; ch++)
            display[i * 4 + ch] = parseInt(
              color.slice(1 + ch * 2, 3 + ch * 2),
              16,
            );
        // 白色内部界线使相邻实例即便碰巧同色也能看清分界；不修改mask。
        if (
          [i - 1, i + 1, i - active.width, i + active.width].some(
            (j) =>
              j >= 0 && j < labels.length && labels[j] > 0 && labels[j] !== id,
          )
        )
          display[i * 4] = display[i * 4 + 1] = display[i * 4 + 2] = 255;
      }
    ctx.putImageData(new ImageData(display, active.width, active.height), 0, 0);
    if (peek) return;
    const fontSize = Math.max(15, active.width / 78);
    ctx.font = `600 ${fontSize}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const o of active.analysis?.objects ?? []) {
      if (selected.includes(o.id)) {
        ctx.strokeStyle = "#f8faf5";
        ctx.lineWidth = Math.max(2, active.width / 650);
        ctx.setLineDash([8, 5]);
        ctx.strokeRect(
          o.bbox[0] - 5,
          o.bbox[1] - 5,
          o.bbox[2] + 10,
          o.bbox[3] + 10,
        );
        ctx.setLineDash([]);
      }
      if (showIds) {
        const text = String(o.id).padStart(2, "0"),
          tw = ctx.measureText(text).width;
        ctx.fillStyle = "rgba(17,55,52,.92)";
        ctx.beginPath();
        ctx.roundRect(
          o.cx - tw / 2 - 7,
          o.cy - fontSize / 2 - 4,
          tw + 14,
          fontSize + 8,
          5,
        );
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(text, o.cx, o.cy);
      }
    }
  }, [active, draft, revision, opacity, showMask, showIds, selected, peek]);

  function point(e: React.PointerEvent<HTMLCanvasElement>): Point {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          active!.width - 1,
          ((e.clientX - r.left) / r.width) * active!.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          active!.height - 1,
          ((e.clientY - r.top) / r.height) * active!.height,
        ),
      ),
    };
  }
  function onDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!active || busy) return;
    if (e.button !== 0 && e.button !== 1) return;
    if (
      e.button === 1 ||
      (mode === "select" && !e.metaKey && !e.ctrlKey && !e.shiftKey)
    ) {
      const v = viewer.current!;
      pan.current = {
        x: e.clientX,
        y: e.clientY,
        left: v.scrollLeft,
        top: v.scrollTop,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
      if (e.button === 1) {
        e.preventDefault();
        setPanning(true);
        return;
      }
    }
    const p = point(e),
      id =
        active.analysis?.labels[
          Math.floor(p.y) * active.width + Math.floor(p.x)
        ] ?? 0;
    if (mode === "select") {
      if (pan.current) {
        pan.current.clickId = id;
        return;
      }
      setSelected((old) =>
        !id
          ? []
          : e.shiftKey || e.metaKey || e.ctrlKey
            ? old.includes(id)
              ? old.filter((x) => x !== id)
              : [...old, id]
            : [id],
      );
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    if (mode === "scale" || mode === "cut") {
      if (mode === "cut" && !active.analysis) return;
      gesture.current = { start: p, last: p, id: 0, touched: new Set() };
      setLine({ a: p, b: p });
      return;
    }
    const labels =
        active.analysis?.labels.slice() ??
        new Int32Array(active.width * active.height),
      paintId =
        mode === "erase"
          ? 0
          : (selected[0] ??
            Math.max(
              0,
              ...objects.map((o) => o.id),
              ...(active.analysis?.rejected ?? []).map((o) => o.id),
            ) + 1);
    const touched = new Set<number>();
    if (mode === "erase")
      for (
        let y = Math.max(0, Math.floor(p.y - brush));
        y <= Math.min(active.height - 1, p.y + brush);
        y++
      )
        for (
          let x = Math.max(0, Math.floor(p.x - brush));
          x <= Math.min(active.width - 1, p.x + brush);
          x++
        )
          if (labels[y * active.width + x])
            touched.add(labels[y * active.width + x]);
    gesture.current = { start: p, last: p, labels, id: paintId, touched };
    stroke(labels, active.width, active.height, p, p, brush, paintId);
    setDraft(labels);
    setRevision((r) => r + 1);
  }
  function onMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (pan.current && viewer.current) {
      const p = pan.current;
      if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 3) {
        p.moved = true;
        viewer.current.scrollLeft = p.left - (e.clientX - p.x);
        viewer.current.scrollTop = p.top - (e.clientY - p.y);
        setPanning(true);
      }
      return;
    }
    const g = gesture.current;
    if (!g || !active) return;
    const p = point(e);
    if (mode === "scale" || mode === "cut") {
      setLine({ a: g.start, b: p });
      return;
    }
    if (g.labels) {
      if (mode === "erase") for (const id of selected) g.touched.add(id);
      stroke(g.labels, active.width, active.height, g.last, p, brush, g.id);
      g.last = p;
      setRevision((r) => r + 1);
    }
  }
  async function onUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (pan.current) {
      if (!pan.current.moved && pan.current.clickId !== undefined)
        setSelected(pan.current.clickId ? [pan.current.clickId] : []);
      pan.current = null;
      setPanning(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
      return;
    }
    const g = gesture.current;
    if (!g || !active) return;
    gesture.current = null;
    const p = point(e);
    setLine(null);
    if (mode === "scale") {
      if (Math.hypot(p.x - g.start.x, p.y - g.start.y) < 5) {
        setNotice("校准线过短，请沿比例尺重新拖动。");
        return;
      }
      setScaleLine({ a: g.start, b: p });
      return;
    }
    if (mode === "cut" && active.analysis) {
      const labels = active.analysis.labels.slice(),
        before = labels.slice();
      stroke(labels, active.width, active.height, g.start, p, 1.5, 0);
      const ids = new Set<number>();
      for (let i = 0; i < labels.length; i++)
        if (before[i] && !labels[i]) ids.add(before[i]);
      setDraft(labels);
      await commit(labels, [...ids]);
      return;
    }
    if (g.labels) {
      if (mode === "erase" && active.analysis) {
        for (let i = 0; i < g.labels.length; i++)
          if (
            active.analysis.labels[i] !== g.labels[i] &&
            active.analysis.labels[i]
          )
            g.touched.add(active.analysis.labels[i]);
      }
      await commit(g.labels, [...g.touched]);
    }
  }
  function calibrate() {
    if (!active || !scaleLine) return;
    const distance = Number(scaleDistance),
      px = Math.hypot(
        scaleLine.b.x - scaleLine.a.x,
        scaleLine.b.y - scaleLine.a.y,
      );
    if (!Number.isFinite(distance) || distance <= 0) {
      setError("请输入大于0的实际长度。");
      return;
    }
    update(active.id, (e) => ({
      ...e,
      calibration: {
        start: scaleLine.a,
        end: scaleLine.b,
        distanceUm: distance,
        umPerPixel: distance / px,
      },
    }));
    setScaleLine(null);
    setMode("select");
    setNotice(`校准已保存：${fmt(distance / px, 5)} μm/px。`);
  }
  async function save(results: boolean) {
    if (!images.length || busy) return false;
    setBusy("准备项目…");
    try {
      if (
        await exportProject(
          images,
          results,
          setBusy,
          plateItems,
          plateBackground,
          plateSettings,
        )
      ) {
        if (!results) {
          savedImages.current = images;
          deletionDirty.current = false;
          plateDirty.current = false;
          setSavedToken((n) => n + 1);
        }
        setNotice(
          results
            ? "仅已确认完整的骨针已导出。待复核候选请另外保存项目。"
            : "项目已保存，包含原图、mask、确认状态与可编辑版面。",
        );
        return true;
      }
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
    return false;
  }
  async function openProject(file: File) {
    if (busy) return;
    setBusy("打开项目…");
    try {
      let importedPlate: PlateItem[] | undefined;
      let importedBackground: PlateBackground = "white";
      let importedSettings = { ...DEFAULT_PLATE_SETTINGS };
      const entries = await importProject(file, (items, bg, settings) => {
        importedPlate = items;
        importedBackground = bg;
        importedSettings = settings;
      });
      if (images.length + entries.length > 30) {
        entries.forEach((e) => URL.revokeObjectURL(e.url));
        throw new Error("合并后超过30张图像，请保存当前项目后重新打开软件。");
      }
      const existing = new Set(images.map((e) => e.id));
      const remapped = new Map<string, string>();
      const loaded = entries.map((e) => {
        const id = existing.has(e.id) ? crypto.randomUUID() : e.id;
        existing.add(id);
        remapped.set(e.id, id);
        return { ...e, id };
      });
      setImages((old) => [...old, ...loaded]);
      if (importedPlate) {
        if (!plateItems.length) {
          setPlateBackground(importedBackground);
          setPlateSettings(importedSettings);
          setPlateItems(
            importedPlate.map((i) => {
              const id = remapped.get(i.sourceId) ?? i.sourceId;
              return { ...i, sourceId: id, key: `${id}:${i.instanceId}` };
            }),
          );
          setSavedToken((n) => n + 1);
        } else
          setNotice(
            "图像已合并。为保留当前版面，未替换其布局；需要恢复文件中的版面请在空工作台打开项目。",
          );
      }
      setActiveId(loaded[0]?.id ?? "");
      if (!importedPlate?.length || !plateItems.length)
        setNotice(
          "项目已载入，尺度、mask、确认状态与版面已恢复（若文件包含）。",
        );
    } catch (e) {
      report(e);
    } finally {
      setBusy("");
    }
  }
  const setParam = <K extends keyof Parameters>(key: K, value: Parameters[K]) =>
    active &&
    update(active.id, (e) => ({ ...e, params: { ...e.params, [key]: value } }));
  const displayWidth = active
    ? Math.max(
        160,
        Math.min(
          viewerSize.w - 64,
          ((viewerSize.h - 64) * active.width) / active.height,
        ),
      ) * zoom
    : 500;
  useEffect(() => {
    if (!active || focusId === null) return;
    const object = active.analysis?.objects.find((o) => o.id === focusId);
    if (!object) return;
    const base = Math.max(
      160,
      Math.min(
        viewerSize.w - 64,
        ((viewerSize.h - 64) * active.width) / active.height,
      ),
    );
    const scale = Math.min(
      (viewerSize.w - 110) / object.bbox[2],
      (viewerSize.h - 110) / object.bbox[3],
    );
    setZoom(Math.max(1, Math.min(5, (scale * active.width) / base)));
  }, [focusId, activeId, viewerSize]);
  useEffect(() => {
    if (!active || focusId === null) return;
    const o = active.analysis?.objects.find((o) => o.id === focusId);
    if (!o) return;
    const frame = requestAnimationFrame(() => {
      const v = viewer.current,
        c = canvas.current;
      if (!v || !c) return;
      const r = c.getBoundingClientRect(),
        vr = v.getBoundingClientRect();
      v.scrollLeft +=
        r.left - vr.left + (o.cx * r.width) / active.width - v.clientWidth / 2;
      v.scrollTop +=
        r.top - vr.top + (o.cy * r.height) / active.height - v.clientHeight / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [focusId, displayWidth, activeId]);
  const visibleLine =
    line ??
    scaleLine ??
    (active?.calibration
      ? { a: active.calibration.start, b: active.calibration.end }
      : null);

  return (
    <div
      className={`app-shell ${sidebarOpen ? "" : "hide-sidebar"} ${inspectorOpen ? "" : "hide-inspector"} ${tableOpen ? "" : "hide-measurements"} ${selected.length ? "has-selection" : ""}`}
    >
      <input
        ref={fileInput}
        data-testid="image-input"
        type="file"
        accept="image/png,image/jpeg,image/tiff,.tif,.tiff,.bmp,.webp"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={projectInput}
        data-testid="project-input"
        type="file"
        accept=".zip"
        hidden
        onChange={(e) => {
          if (e.target.files?.[0]) void openProject(e.target.files[0]);
          e.target.value = "";
        }}
      />
      <aside
        className="sidebar"
        style={{ width: sidebarWidth }}
        inert={plateOpen || classificationBusy}
      >
        <div className="brand">
          <img className="brand-icon" src={appLogo} alt="" draggable={false} />
          <div>
            Sclerite
            <span>
              STUDIO <i>0.12</i>
            </span>
          </div>
        </div>
        <div className="sidebar-heading">
          {tr("工作空间")}{" "}
          <span>
            {images.length} {tr("张图像")}
          </span>
        </div>
        <button
          className="import-button"
          disabled={!!busy}
          onClick={() => fileInput.current?.click()}
        >
          <Plus size={16} />
          {tr("导入光镜照片")}
        </button>
        <div className="image-list">
          {images.map((e) => (
            <div className="image-row" key={e.id}>
              <button
                key={e.id}
                className={`image-item ${e.id === activeId ? "selected" : ""}`}
                title={e.name}
                onClick={() => setActiveId(e.id)}
              >
                <img src={e.url} alt="" />
                <div>
                  <strong>{e.name}</strong>
                  <small>
                    {e.analysis
                      ? tr(
                          "已确认 {0}/{1}",
                          e.analysis.approvedIds?.length ?? 0,
                          e.analysis.objects.length,
                        )
                      : tr("等待分割")}{" "}
                    · {e.calibration ? tr("已校准") : tr("像素单位")}
                  </small>
                </div>
                {!!e.analysis?.objects.length &&
                  e.analysis.approvedIds?.length ===
                    e.analysis.objects.length && <Check size={13} />}
              </button>
              <IconButton
                icon={Trash2}
                label={tr("移除照片 {0}", e.name)}
                className="remove-image"
                disabled={!!busy}
                onClick={() => removeImage(e.id)}
              />
            </div>
          ))}
          {!images.length && (
            <p className="sidebar-empty">
              {tr("每张照片保留原图、尺度")}
              <br />
              {tr("和可编辑的分割结果。")}
            </p>
          )}
        </div>
        <div className="sidebar-bottom">
          <IconButton
            icon={FolderOpen}
            label={tr("打开项目")}
            disabled={!!busy}
            onClick={() => projectInput.current?.click()}
          />
          <IconButton
            icon={Save}
            label={tr("保存项目")}
            disabled={!images.length || !!busy}
            onClick={() => void save(false)}
          />
          <IconButton
            icon={CircleHelp}
            label={tr("使用说明")}
            onClick={() => setHelp(true)}
          />
        </div>
      </aside>
      {sidebarOpen && (
        <div
          className="sidebar-resizer"
          role="separator"
          aria-label={tr("调整照片栏宽度")}
          aria-orientation="vertical"
          aria-valuemin={170}
          aria-valuemax={360}
          aria-valuenow={sidebarWidth}
          tabIndex={0}
          onKeyDown={(e) => {
            if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
              e.preventDefault();
              setSidebarWidth((w) =>
                Math.max(
                  170,
                  Math.min(360, w + (e.key === "ArrowRight" ? 10 : -10)),
                ),
              );
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            e.currentTarget.dataset.start = `${e.clientX},${sidebarWidth}`;
          }}
          onPointerMove={(e) => {
            if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
            const [x, w] = e.currentTarget.dataset
              .start!.split(",")
              .map(Number);
            setSidebarWidth(Math.max(170, Math.min(360, w + e.clientX - x)));
          }}
          onPointerUp={(e) =>
            e.currentTarget.releasePointerCapture(e.pointerId)
          }
        />
      )}
      <main className="main" inert={plateOpen}>
        <header className="topbar">
          <div className="breadcrumb">
            <IconButton
              icon={PanelLeft}
              label={tr("图像列表")}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            />
            <nav
              className="studio-tabs"
              role="tablist"
              aria-label={tr("Studio 功能")}
            >
              <button
                role="tab"
                aria-selected={studioTab === "process"}
                disabled={classificationBusy}
                onClick={() => setStudioTab("process")}
              >
                {tr("图像处理")}
              </button>
              <button
                role="tab"
                aria-selected={studioTab === "classification"}
                disabled={!!busy}
                onClick={() => setStudioTab("classification")}
              >
                {tr("分类")}
              </button>
            </nav>
          </div>
          <div className="header-actions">
            <LanguageSelect />
            <IconButton
              icon={Save}
              label={tr("保存项目（含版面）")}
              disabled={!images.length || !!busy || classificationBusy}
              onClick={() => void save(false)}
            />
            {studioTab === "process" && (
              <IconButton
                icon={PanelBottom}
                label={tr("测量表")}
                aria-expanded={tableOpen}
                onClick={() => setTableOpen((v) => !v)}
              />
            )}
            {studioTab === "process" && (
              <IconButton
                icon={PanelRight}
                label={tr("处理设置")}
                aria-expanded={inspectorOpen}
                onClick={() => setInspectorOpen(!inspectorOpen)}
              />
            )}
            <button
              className="button secondary"
              disabled={!!busy || classificationBusy}
              onClick={() => setPlateOpen(true)}
            >
              {tr("图版排版")}
            </button>
            <IconButton
              icon={ArrowDownToLine}
              label={tr("导出结果")}
              className="primary"
              disabled={!approvedCount || !!busy || classificationBusy}
              onClick={() => void save(true)}
            />
          </div>
        </header>
        <div className="processing-page" hidden={studioTab !== "process"}>
          <div className="workspace-heading">
            <div>
              <p className="eyebrow">OCTOCORAL MORPHOMETRICS</p>
              <h1>
                {tr("看清每一枚骨针")}
                <span className="tag">{tr("光学显微")}</span>
              </h1>
              <p>{tr("从图像到轮廓，再到可复核的形态测量。")}</p>
            </div>
            <div className="summary">
              <div>
                <b>{images.length.toString().padStart(2, "0")}</b>
                <small>{tr("图像")}</small>
              </div>
              <div>
                <b>{total.toString().padStart(2, "0")}</b>
                <small>
                  {tr("候选 ·")} {approvedCount} {tr("已确认")}
                </small>
              </div>
              <div>
                <b>
                  {images
                    .filter((e) => e.calibration)
                    .length.toString()
                    .padStart(2, "0")}
                </b>
                <small>{tr("已校准")}</small>
              </div>
            </div>
          </div>
          <div className="work-grid">
            <section className="center-panel">
              <div className="canvas-title">
                <div>
                  <span className="status-dot" />
                  <strong>{active?.name ?? tr("图像工作区")}</strong>
                  {active?.synthetic && (
                    <span className="synthetic">{tr("合成演示")}</span>
                  )}
                </div>
                <span>
                  {active
                    ? `${active.width} × ${active.height} px`
                    : tr("PNG / JPEG / 单页 TIFF")}
                </span>
              </div>
              <div className="toolbar">
                <div className="tools">
                  {tools.map((t) => (
                    <button
                      key={t.id}
                      aria-label={tr(t.label)}
                      title={tr(t.tip)}
                      className={mode === t.id ? "chosen" : ""}
                      disabled={
                        !active ||
                        !!busy ||
                        (t.id === "cut" && !active.analysis)
                      }
                      onClick={() => {
                        setMode(t.id);
                        setScaleLine(null);
                      }}
                    >
                      <t.icon size={17} />
                      <span>{tr(t.label)}</span>
                    </button>
                  ))}
                </div>
                <div className="edit-tools">
                  <IconButton
                    icon={Eye}
                    label={tr("临时查看原图")}
                    disabled={!active}
                    onPointerDown={(e) => {
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setPeek(true);
                    }}
                    onPointerUp={() => setPeek(false)}
                    onPointerCancel={() => setPeek(false)}
                    onKeyDown={(e) => {
                      if (e.code === "Space") {
                        e.preventDefault();
                        setPeek(true);
                      }
                    }}
                    onKeyUp={() => setPeek(false)}
                    onBlur={() => setPeek(false)}
                  />
                  <IconButton
                    icon={Redo2}
                    label={tr("重做")}
                    disabled={
                      !active ||
                      !!busy ||
                      future[active.id]?.expected !== active.analysis ||
                      future[active.id]?.expectedNotes !== active.notes ||
                      !future[active.id]?.snapshots.length
                    }
                    onClick={redo}
                  />
                  <button
                    title={tr("撤销上次mask操作")}
                    aria-label={tr("撤销")}
                    disabled={!active?.undo.length || !!busy}
                    onClick={undo}
                  >
                    <Undo2 size={17} />
                  </button>
                  <button
                    title={tr("合并选中实例")}
                    aria-label={tr("合并")}
                    disabled={selected.length < 2 || !!busy}
                    onClick={() => void merge()}
                  >
                    <Combine size={17} />
                  </button>
                  <button
                    title={tr("删除选中实例")}
                    aria-label={tr("删除")}
                    disabled={!selected.length || !!busy}
                    onClick={() => void removeSelected()}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              <div
                className={`viewer ${!active ? "empty" : ""}`}
                ref={viewer}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void importFiles(e.dataTransfer.files);
                }}
              >
                {active ? (
                  <div
                    className={`image-stage mode-${mode} ${panning ? "is-panning" : ""}`}
                    style={{ width: displayWidth, flexShrink: 0 }}
                  >
                    <canvas
                      ref={canvas}
                      data-testid="image-canvas"
                      onPointerDown={onDown}
                      onPointerMove={onMove}
                      onPointerUp={(e) => void onUp(e)}
                      onPointerCancel={() => {
                        pan.current = null;
                        setPanning(false);
                        gesture.current = null;
                        setLine(null);
                        setDraft(null);
                      }}
                    />
                    {visibleLine && !peek && (
                      <svg
                        className="line-overlay"
                        viewBox={`0 0 ${active.width} ${active.height}`}
                      >
                        <line
                          x1={visibleLine.a.x}
                          y1={visibleLine.a.y}
                          x2={visibleLine.b.x}
                          y2={visibleLine.b.y}
                          stroke={mode === "cut" ? "#ed674f" : "#1b8077"}
                          strokeWidth={Math.max(2, active.width / 450)}
                          strokeDasharray={mode === "cut" ? "8 5" : undefined}
                        />
                        <circle
                          cx={visibleLine.a.x}
                          cy={visibleLine.a.y}
                          r={Math.max(4, active.width / 200)}
                          fill="#1b8077"
                        />
                        <circle
                          cx={visibleLine.b.x}
                          cy={visibleLine.b.y}
                          r={Math.max(4, active.width / 200)}
                          fill="#1b8077"
                        />
                      </svg>
                    )}
                  </div>
                ) : (
                  <div className="empty-state">
                    <div className="empty-art">
                      <div />
                      <ScanLine size={44} />
                      <span />
                    </div>
                    <h2>{tr("让骨针测量，从一张照片开始")}</h2>
                    <p>
                      {tr("拖入光镜照片，或选择本地图像。")}
                      <br />
                      {tr("原始图像会完整保留。")}
                    </p>
                    <button
                      className="button primary"
                      disabled={!!busy}
                      onClick={() => fileInput.current?.click()}
                    >
                      <ArrowUpFromLine size={16} />
                      {tr("选择图像")}
                    </button>
                    <button
                      className="demo-link"
                      disabled={!!busy}
                      onClick={() => void demo()}
                    >
                      {tr("体验合成示例")} <span>↗</span>
                    </button>
                    <small>
                      {tr("PNG · JPEG · 单页TIFF / 每张最多1200万像素")}
                    </small>
                  </div>
                )}
                {busy && (
                  <div className="processing">
                    <LoaderCircle className="spin" size={18} />
                    {tr(busy)}
                  </div>
                )}
              </div>
              <div className="canvas-footer">
                <span>
                  <Crosshair size={13} />
                  {active
                    ? tr(tools.find((t) => t.id === mode)?.tip ?? "")
                    : tr("本地处理 · 图像不会上传")}
                </span>
                <div>
                  <button
                    aria-label={tr("缩小")}
                    onClick={() => setZoom((z) => Math.max(0.25, z - 0.25))}
                  >
                    <ZoomOut size={15} />
                  </button>
                  <span title={tr("屏幕CSS像素／原图像素")}>
                    {active
                      ? Math.round((displayWidth / active.width) * 100)
                      : 100}
                    %
                  </span>
                  <button
                    title={tr("原图像素 1:1（CSS像素）")}
                    aria-label={tr("原始像素1:1")}
                    disabled={!active}
                    onClick={() => {
                      if (active) {
                        setFocusId(null);
                        setZoom(active.width / (displayWidth / zoom));
                      }
                    }}
                  >
                    1:1
                  </button>
                  <button
                    aria-label={tr("放大")}
                    onClick={() => setZoom((z) => Math.min(64, z * 1.25))}
                  >
                    <ZoomIn size={15} />
                  </button>
                  <button
                    aria-label={tr("适应画布")}
                    title={tr("适应画布")}
                    onClick={() => {
                      setFocusId(null);
                      setZoom(1);
                    }}
                  >
                    <Maximize2 size={14} />
                  </button>
                </div>
              </div>
              {selectedGroup && active && (
                <div className="split-review">
                  <div>
                    <ObjectPreview
                      entry={active}
                      ids={selectedGroup.childIds}
                    />
                    <small>{tr("原图")}</small>
                  </div>
                  <div>
                    <ObjectPreview
                      entry={active}
                      ids={selectedGroup.childIds}
                      overlay
                    />
                    <small>{tr("切线与子对象")}</small>
                  </div>
                  <div>
                    <strong>
                      {tr("接触组 →")}{" "}
                      {selectedGroup.childIds.map((id) => `#${id}`).join(" · ")}
                    </strong>
                    <p>{tr("只分配可见像素，不补全遮挡轮廓。")}</p>
                    <button
                      className="button secondary"
                      disabled={!!busy}
                      onClick={revertGroup}
                    >
                      {tr("撤销本组切分")}
                    </button>
                  </div>
                </div>
              )}
              <div
                className="table-resizer"
                role="separator"
                aria-label={tr("调整测量表高度")}
                aria-orientation="horizontal"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                    e.preventDefault();
                    setTableHeight((h) =>
                      Math.max(
                        100,
                        Math.min(400, h + (e.key === "ArrowUp" ? 20 : -20)),
                      ),
                    );
                  }
                }}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.currentTarget.dataset.origin = `${e.clientY},${tableHeight}`;
                }}
                onPointerMove={(e) => {
                  if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
                  const [y, h] = e.currentTarget.dataset
                    .origin!.split(",")
                    .map(Number);
                  setTableHeight(
                    Math.max(100, Math.min(400, h + y - e.clientY)),
                  );
                }}
                onPointerUp={(e) =>
                  e.currentTarget.releasePointerCapture(e.pointerId)
                }
              />
              <div className="results-header">
                <div>
                  <Layers size={16} />
                  <strong>
                    {tr("候选测量 · 已确认")}{" "}
                    {active?.analysis?.approvedIds?.length ?? 0}
                  </strong>
                  <span className="count">{objects.length}</span>
                </div>
                <select
                  aria-label={tr("筛选复核状态")}
                  value={reviewFilter}
                  onChange={(e) => {
                    setReviewFilter(e.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="all">{tr("全部候选")}</option>
                  <option value="pending">{tr("待复核")}</option>
                  <option value="approved">{tr("已确认")}</option>
                  <option value="split">{tr("自动切分")}</option>
                </select>
                <button
                  className="text-button"
                  disabled={!approvedCount || !!busy}
                  onClick={() =>
                    void saveBlob(
                      new Blob([csv(images)], {
                        type: "text/csv;charset=utf-8",
                      }),
                      "measurements.csv",
                    ).catch(report)
                  }
                >
                  <FileSpreadsheet size={14} />
                  {tr("导出CSV")}
                </button>
              </div>
              <div className="review-strip">
                <button
                  className="select-all-button"
                  aria-label={
                    allVisibleSelected ? tr("取消全选") : tr("全选当前列表")
                  }
                  aria-pressed={allVisibleSelected}
                  title={tr("仅选择当前筛选列表 · {0}+A", MOD)}
                  disabled={!visibleObjects.length || !!busy}
                  onClick={() =>
                    setSelected(
                      allVisibleSelected ? [] : visibleObjects.map((o) => o.id),
                    )
                  }
                >
                  <CheckCheck size={16} />
                  {allVisibleSelected ? tr("取消全选") : tr("全选")}
                </button>
                <span title={tr("{0} 点击多选；↑↓切换，空格确认并下一枚", MOD)}>
                  {tr("已选")} {selected.length} / {visibleObjects.length}
                </span>
                {selected.length > 0 && (
                  <>
                    <button
                      className="confirm-selection-button"
                      disabled={!!busy}
                      onClick={() => approveSelected(!allSelectedApproved)}
                    >
                      {allSelectedApproved ? tr("取消确认") : tr("确认选中")}
                    </button>
                    {!allVisibleSelected && (
                      <IconButton
                        icon={X}
                        label={tr("取消选择")}
                        disabled={!!busy}
                        onClick={() => setSelected([])}
                      />
                    )}
                  </>
                )}
              </div>
              <div className="table-scroll" style={{ height: tableHeight }}>
                <table>
                  <thead>
                    <tr>
                      <th>{tr("实例")}</th>
                      <th>
                        {tr("长度 /")} {unit}
                      </th>
                      <th>
                        {tr("宽度 /")} {unit}
                      </th>
                      <th>
                        {tr("面积 /")} {unit}²
                      </th>
                      <th>{tr("长宽比")}</th>
                      <th>{tr("圆度")}</th>
                      <th>{tr("状态")}</th>
                      <th>{tr("确认完整")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleObjects.map((o) => (
                      <tr
                        key={o.id}
                        data-object-id={o.id}
                        data-approved={
                          active?.analysis?.approvedIds?.includes(o.id) ||
                          undefined
                        }
                        tabIndex={0}
                        className={selected.includes(o.id) ? "selected" : ""}
                        onClick={(e) => {
                          e.currentTarget.focus();
                          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
                            selectObject(o.id);
                            return;
                          }
                          setSelected((old) =>
                            e.shiftKey || e.metaKey || e.ctrlKey
                              ? old.includes(o.id)
                                ? old.filter((id) => id !== o.id)
                                : [...old, o.id]
                              : [o.id],
                          );
                        }}
                      >
                        <td>
                          {active && (
                            <ObjectPreview
                              entry={active}
                              ids={[o.id]}
                              thumbnail
                            />
                          )}
                          <i
                            style={{
                              background: COLORS[(o.id - 1) % COLORS.length],
                            }}
                          />
                          {String(o.id).padStart(3, "0")}
                        </td>
                        <td>{fmt(o.length * factor)}</td>
                        <td>{fmt(o.width * factor)}</td>
                        <td>{fmt(o.area * factor * factor)}</td>
                        <td>{fmt(o.aspect, 2)}</td>
                        <td>{fmt(o.circularity, 3)}</td>
                        <td>
                          <span
                            title={tr(
                              active?.analysis?.reviewHints?.[o.id] ?? "",
                            )}
                            className={
                              o.border || active?.analysis?.reviewHints?.[o.id]
                                ? "warning-text"
                                : "muted"
                            }
                          >
                            {o.border
                              ? tr("接触边界")
                              : active?.analysis?.approvedIds?.includes(o.id)
                                ? tr("已确认完整")
                                : tr("待确认完整")}
                            {active?.analysis?.reviewHints?.[o.id] && (
                              <small className="contact-hint">
                                {active.analysis.reviewHints[o.id].startsWith(
                                  "自动切分",
                                )
                                  ? tr("来源：自动切分")
                                  : tr("形态：多叶 / 接触")}
                              </small>
                            )}
                          </span>
                        </td>
                        <td
                          className="approval-cell"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <label
                            className="approval-target"
                            title={
                              o.border
                                ? tr("接触边界的对象不能确认完整")
                                : tr("点击此单元格切换完整确认")
                            }
                            data-disabled={!!busy || o.border || undefined}
                          >
                            <input
                              type="checkbox"
                              className="approval-checkbox"
                              aria-label={tr("确认完整 {0}", o.id)}
                              disabled={!!busy || o.border}
                              checked={
                                active?.analysis?.approvedIds?.includes(o.id) ??
                                false
                              }
                              onChange={(e) =>
                                approveSelected(e.target.checked, [o.id])
                              }
                            />
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!visibleObjects.length && (
                  <div className="table-empty">
                    {objects.length
                      ? tr("该筛选条件下没有候选。")
                      : active
                        ? tr("运行自动分割后，点击任一骨针查看测量结果。")
                        : tr("导入照片后，测量结果将在这里显示。")}
                  </div>
                )}
              </div>
            </section>
            <aside className="inspector">
              <div className="inspector-title">
                <span>
                  <Sparkles size={17} />
                  {tr("处理设置")}
                </span>
                <button
                  title={tr("重置参数")}
                  aria-label={tr("重置参数")}
                  disabled={!active || !!busy}
                  onClick={() =>
                    active &&
                    update(active.id, (e) => ({
                      ...e,
                      params: { ...DEFAULTS },
                    }))
                  }
                >
                  <Undo2 size={15} />
                </button>
              </div>
              <fieldset disabled={!active || !!busy}>
                <details className="control-section" open>
                  <summary className="section-label">
                    <span className="step">01</span>
                    {tr("图像信息")}
                  </summary>
                  <label>
                    {tr("标本编号")}
                    <input
                      placeholder={tr("例如 OCT-001")}
                      value={active?.specimen ?? ""}
                      onChange={(e) =>
                        active &&
                        update(active.id, (i) => ({
                          ...i,
                          specimen: e.target.value,
                        }))
                      }
                    />
                  </label>
                  <label>
                    {tr("组织区域")}
                    <select
                      value={active?.tissue ?? "未指定"}
                      aria-label={tr("组织区域")}
                      onChange={(e) =>
                        active &&
                        update(active.id, (i) => ({
                          ...i,
                          tissue: e.target.value,
                        }))
                      }
                    >
                      {[
                        "未指定",
                        "珊瑚虫 polyp",
                        "柄部 stalk",
                        "分枝 branch",
                        "表层 cortex",
                        "内部 medulla",
                        "示例组织",
                      ].map((v) => (
                        <option key={v} value={v}>
                          {tr(v)}
                        </option>
                      ))}
                    </select>
                  </label>
                </details>
                <details className="control-section" open>
                  <summary className="section-label">
                    <span className="step">02</span>
                    {tr("尺度校准")}
                    <span
                      className={`badge ${active?.calibration ? "green" : ""}`}
                    >
                      {active?.calibration ? tr("已校准") : tr("未校准")}
                    </span>
                  </summary>
                  <p className="hint">
                    {active?.calibration
                      ? `1 px = ${fmt(factor, 5)} μm`
                      : tr("沿已知比例尺画线，输入对应长度。")}
                  </p>
                  <button
                    className="button full secondary"
                    onClick={() => {
                      setMode("scale");
                      setScaleLine(null);
                    }}
                  >
                    <Ruler size={15} />
                    {active?.calibration ? tr("重新画线校准") : tr("画线校准")}
                  </button>
                  {scaleLine && (
                    <div className="scale-entry">
                      <label>
                        {tr("实际长度（μm）")}
                        <input
                          autoFocus
                          type="number"
                          min="0.001"
                          step="any"
                          value={scaleDistance}
                          onChange={(e) => setScaleDistance(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") calibrate();
                          }}
                        />
                      </label>
                      <small>
                        {tr("线段长度：")}
                        {fmt(
                          Math.hypot(
                            scaleLine.b.x - scaleLine.a.x,
                            scaleLine.b.y - scaleLine.a.y,
                          ),
                        )}{" "}
                        px
                      </small>
                      <button
                        className="button primary full"
                        onClick={calibrate}
                      >
                        <Check size={14} />
                        {tr("应用校准")}
                      </button>
                    </div>
                  )}
                  {active?.calibration && (
                    <button
                      className="subtle-button"
                      onClick={() =>
                        active &&
                        update(active.id, (e) => ({
                          ...e,
                          calibration: undefined,
                        }))
                      }
                    >
                      {tr("清除校准，恢复像素单位")}
                    </button>
                  )}
                </details>
                <details className="control-section" open>
                  <summary className="section-label">
                    <span className="step">03</span>
                    {tr("自动分割")}
                  </summary>
                  <label>
                    {tr("骨针与背景")}
                    <div className="segmented">
                      <button
                        className={
                          active?.params.polarity !== "bright" ? "active" : ""
                        }
                        onClick={() => setParam("polarity", "dark")}
                      >
                        {tr("深色骨针")}
                      </button>
                      <button
                        className={
                          active?.params.polarity === "bright" ? "active" : ""
                        }
                        onClick={() => setParam("polarity", "bright")}
                      >
                        {tr("亮色骨针")}
                      </button>
                    </div>
                  </label>
                  <details className="advanced-settings">
                    <summary>{tr("高级分割参数")}</summary>
                    <label>
                      {tr("背景校正半径")}{" "}
                      <b>{active?.params.backgroundRadius ?? 0} px</b>
                      <input
                        type="range"
                        min="0"
                        max="160"
                        step="4"
                        value={active?.params.backgroundRadius ?? 0}
                        onChange={(e) =>
                          setParam("backgroundRadius", Number(e.target.value))
                        }
                      />
                    </label>
                    <p className="hint tight">
                      {tr("设为0关闭。窗口应大于骨针的半宽。")}
                    </p>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={active?.params.automatic ?? true}
                        onChange={(e) =>
                          setParam("automatic", e.target.checked)
                        }
                      />
                      {tr("自动选择阈值")} <span>Otsu</span>
                    </label>
                    {!active?.params.automatic && (
                      <label>
                        {tr("前景信号阈值")}{" "}
                        <b>{active?.params.threshold ?? 24}</b>
                        <input
                          type="range"
                          min="0"
                          max="255"
                          value={active?.params.threshold ?? 24}
                          onChange={(e) =>
                            setParam("threshold", Number(e.target.value))
                          }
                        />
                      </label>
                    )}
                    <label>
                      {tr("最小实例面积")} <span>px²</span>
                      <input
                        type="number"
                        min="1"
                        max="1000000"
                        value={active?.params.minArea ?? 1500}
                        onChange={(e) =>
                          setParam(
                            "minArea",
                            Math.max(
                              1,
                              Math.min(
                                1_000_000,
                                Math.round(Number(e.target.value) || 1),
                              ),
                            ),
                          )
                        }
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={active?.params.fillHoles ?? true}
                        onChange={(e) =>
                          setParam("fillHoles", e.target.checked)
                        }
                      />
                      {tr("填充内部孔洞")}
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={active?.params.excludeBorder ?? true}
                        disabled={active?.params.completeOnly}
                        onChange={(e) =>
                          setParam("excludeBorder", e.target.checked)
                        }
                      />
                      {tr("排除接触图像边缘的对象")}
                    </label>
                    <label>
                      {tr("闭合微小缺口")}{" "}
                      <b>{active?.params.closingRadius ?? 2} px</b>
                      <input
                        aria-label={tr("闭合半径")}
                        type="range"
                        min="0"
                        max="4"
                        step="1"
                        value={active?.params.closingRadius ?? 2}
                        onChange={(e) =>
                          setParam("closingRadius", Number(e.target.value))
                        }
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={active?.params.completeOnly ?? true}
                        onChange={(e) => {
                          setParam("completeOnly", e.target.checked);
                          setMode("select");
                        }}
                      />
                      {tr("保守筛选完整候选")}
                    </label>
                    <p className="hint">
                      {tr(
                        "排除贴边、角落标注与低对比对象。多叶和接触组合保留并提示复核；只有接触处可手动切分，不补全真正遮挡部分。未拆分组合的测量不是单枚骨针测量。",
                      )}
                    </p>
                  </details>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={active?.params.autoSplit ?? true}
                      onChange={(e) => setParam("autoSplit", e.target.checked)}
                    />
                    {tr("自动切分接触组合")}
                  </label>
                  {active?.params.autoSplit && (
                    <>
                      <label>
                        {tr("切分保守度")}{" "}
                        <b>{active.params.splitProminence.toFixed(3)}</b>
                        <input
                          aria-label={tr("切分保守度")}
                          type="range"
                          min="0.05"
                          max="0.8"
                          step="0.005"
                          value={active.params.splitProminence}
                          onChange={(e) =>
                            setParam("splitProminence", Number(e.target.value))
                          }
                        />
                      </label>
                      <details className="advanced-settings">
                        <summary>{tr("高级切分参数")}</summary>
                        <label>
                          {tr("最小内核比例")}{" "}
                          <b>{active.params.splitRadiusRatio.toFixed(2)}</b>
                          <input
                            aria-label={tr("最小内核比例")}
                            type="range"
                            min="0.1"
                            max="0.5"
                            step="0.05"
                            value={active.params.splitRadiusRatio}
                            onChange={(e) =>
                              setParam(
                                "splitRadiusRatio",
                                Number(e.target.value),
                              )
                            }
                          />
                        </label>
                      </details>
                      <p className="hint">
                        {tr(
                          "保守度越高切分越少。MR0145实图测试推荐0.30 / 0.25，但仍有漏切与误切。极细长对象不自动切；切分不补画遮挡。调整后重新运行，可撤销。",
                        )}
                      </p>
                    </>
                  )}
                  {!!active?.analysis?.splitEvents?.length && (
                    <details className="quality-audit">
                      <summary>
                        {tr("自动切分")} {active.analysis.splitEvents.length}{" "}
                        {tr("组 · 查看来源")}
                      </summary>
                      {active.analysis.splitEvents.map((ev, i) => (
                        <p key={i}>
                          {tr("原 #")}
                          {ev.parentId} →{" "}
                          {ev.childIds.map((id) => `#${id}`).join("、")}{" "}
                          {tr("· 保守度")} {ev.prominence}
                        </p>
                      ))}
                    </details>
                  )}
                  {!!active?.analysis?.rejected?.length && (
                    <details className="quality-audit">
                      <summary>
                        {tr("已排除")} {active.analysis.rejected.length}{" "}
                        {tr("个候选 · 查看原因")}
                      </summary>
                      {active.analysis.rejected.map((r, i) => (
                        <p key={i}>
                          #{r.id} ·{" "}
                          {r.reasons.map((reason) => tr(reason)).join("; ")}
                        </p>
                      ))}
                    </details>
                  )}
                  {images.length > 1 && (
                    <button
                      className="subtle-button full"
                      onClick={() => void run(true)}
                    >
                      <CheckCheck size={14} />
                      {tr("处理全部")} {images.length} {tr("张图像")}
                    </button>
                  )}
                </details>
                <details className="control-section" open>
                  <summary className="section-label">
                    <span className="step">04</span>
                    {tr("显示与修正")}
                  </summary>
                  <p className="hint">
                    {tr(
                      "在候选测量表“状态”右侧勾选确认。允许保留完整接触组合；有遮挡、截断或无法判断的对象请丢弃。任何mask编辑都会清除本图确认。",
                    )}
                  </p>
                  <div className="review-actions">
                    <button
                      className="button secondary full"
                      disabled={!selected.length}
                      onClick={() => void removeSelected()}
                    >
                      <Trash2 size={14} />
                      {tr("丢弃选中对象")}
                    </button>
                  </div>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={showMask}
                      onChange={(e) => setShowMask(e.target.checked)}
                    />
                    {tr("显示彩色mask")}
                  </label>
                  <label className="check-label">
                    <input
                      type="checkbox"
                      checked={showIds}
                      onChange={(e) => setShowIds(e.target.checked)}
                    />
                    {tr("显示实例编号")}
                  </label>
                  <label>
                    {tr("遮罩透明度")} <b>{Math.round(opacity * 100)}%</b>
                    <input
                      type="range"
                      min="0"
                      max="0.8"
                      step=".05"
                      value={opacity}
                      onChange={(e) => setOpacity(Number(e.target.value))}
                    />
                  </label>
                  {(mode === "paint" || mode === "erase") && (
                    <label>
                      {tr("笔刷半径")} <b>{brush} px</b>
                      <input
                        type="range"
                        min="1"
                        max="50"
                        value={brush}
                        onChange={(e) => setBrush(Number(e.target.value))}
                      />
                    </label>
                  )}
                  {selectedObject && (
                    <label>
                      {tr("实例")} {selectedObject.id} {tr("· 形态备注")}
                      <input
                        placeholder={tr("spindle / club / 待确认…")}
                        value={active?.notes[selectedObject.id] ?? ""}
                        onChange={(e) =>
                          active &&
                          update(active.id, (i) => ({
                            ...i,
                            notes: {
                              ...i.notes,
                              [selectedObject.id]: e.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  )}
                </details>
              </fieldset>
              <div className="run-dock">
                <p className={stale ? "warning-text" : "hint"} role="status">
                  {stale
                    ? tr("参数已修改或来源未知，结果尚未更新")
                    : active?.analysis
                      ? tr("当前参数与分割结果一致")
                      : tr("推荐设置已就绪 · 分割后人工复核")}
                </p>
                <button
                  className="button primary full run-button"
                  disabled={!active || !!busy}
                  onClick={() => void run()}
                >
                  <ScanLine size={16} />
                  {tr("运行自动分割")}
                </button>
              </div>
              <div className="inspector-note">
                <CircleHelp size={15} />
                <p>
                  {tr(
                    "测量来自二维投影。长度为最大Feret径；粘连和失焦实例需要人工复核。",
                  )}
                </p>
              </div>
            </aside>
          </div>
          <footer
            className="statusbar"
            role="status"
            title={tr(notice || recoveryStatus)}
          >
            <span>
              <span className="status-dot" />
              {tr(busy || notice || recoveryStatus)}{" "}
            </span>
            <span>
              {active?.analysis
                ? tr(
                    "{0} 个实例 · 阈值 {1}",
                    objects.length,
                    active.analysis.threshold,
                  )
                : tr("背景校正 → 分割 → 复核 → 导出")}
              <span className="separator">|</span>
              {active?.calibration
                ? tr("物理尺度已校准")
                : tr("尺寸单位：像素")}
            </span>
          </footer>
        </div>
        <div
          className="classification-page"
          hidden={studioTab !== "classification"}
        >
          <ClassificationStudio
            key={workspaceRevision}
            visible={studioTab === "classification"}
            images={images}
            activeId={activeId}
            onBusy={setClassificationBusy}
            onProcess={() => setStudioTab("process")}
            onChange={(fn) => setImages((old) => old.map(fn))}
          />
        </div>
      </main>
      {recovery && (
        <div className="modal-backdrop">
          <div className="dialog" role="dialog" aria-label={tr("恢复上次工作")}>
            <h2>{tr("恢复上次工作？")}</h2>
            <p>
              {new Date(recovery.date).toLocaleString()} ·{" "}
              {recovery.images.length} {tr("张照片 ·")} {recovery.items.length}{" "}
              {tr("个排版对象。恢复副本仅保存在这台设备。")}
            </p>
            <div className="recovery-actions">
              <button
                className="button secondary"
                disabled={!!busy}
                onClick={() => {
                  setRecovery(null);
                  setRecoveryReady(true);
                }}
              >
                {tr("暂不恢复")}
              </button>
              <button
                className="button primary"
                disabled={!!busy}
                onClick={() => void recover()}
              >
                {tr("恢复工作")}
              </button>
            </div>
            <p className="hint">
              {tr("暂不恢复不会立即删除副本；开始新工作后会更新本地恢复副本。")}
            </p>
          </div>
        </div>
      )}
      {confirmation && (
        <div className="modal-backdrop">
          <div className="dialog">
            <AlertCircle size={28} />
            <h2>{tr("确认继续？")}</h2>
            <p>{tr(confirmation.message)}</p>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="button secondary"
                onClick={() => setConfirmation(null)}
              >
                {tr("返回")}
              </button>
              <button
                className="button primary"
                onClick={() => {
                  const action = confirmation.run;
                  setConfirmation(null);
                  action();
                }}
              >
                {tr("确认继续")}
              </button>
            </div>
          </div>
        </div>
      )}
      {error && (
        <div className="modal-backdrop">
          <div className="dialog">
            <AlertCircle size={28} />
            <h2>{tr("需要检查")}</h2>
            <p style={{ whiteSpace: "pre-wrap" }}>{tr(error)}</p>
            <button className="button primary" onClick={() => setError("")}>
              {tr("知道了")}
            </button>
          </div>
        </div>
      )}
      <PlateEditor
        key={workspaceRevision}
        open={plateOpen}
        images={images}
        onClose={() => setPlateOpen(false)}
        onDirty={onPlateDirty}
        items={plateItems}
        settings={plateSettings}
        setSettings={setPlateSettings}
        background={plateBackground}
        setBackground={setPlateBackground}
        setItems={setPlateItems}
        savedToken={savedToken}
      />
      {help && (
        <div className="modal-backdrop" onClick={() => setHelp(false)}>
          <div
            className="dialog help-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="dialog-close"
              aria-label={tr("关闭说明")}
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <span className="eyebrow">QUICK START</span>
            <h2>{tr("五步完成骨针测量")}</h2>
            <ol>
              <li>
                <b>{tr("导入照片")}</b>
                {tr("：PNG、JPEG或单页TIFF，保留原图分辨率。")}
              </li>
              <li>
                <b>{tr("校准")}</b>
                {tr("：选择校准工具，沿比例尺拖线，输入实际微米数。")}
              </li>
              <li>
                <b>{tr("分割")}</b>
                {tr("：明背景用深色骨针；调整背景校正半径与最小面积。")}
              </li>
              <li>
                <b>{tr("复核")}</b>
                {tr(
                  "：检查完整性后，在测量表最右侧打勾。接触组合可以保留或沿接触处切开；不补全遮挡轮廓。Ctrl/Cmd+Z撤销。",
                )}
              </li>
              <li>
                <b>{tr("导出")}</b>
                {tr(
                  "：结果ZIP和CSV只含已确认完整对象；“保存项目”保留待确认候选。任何mask修改会清空该图确认状态，需要重新复核。",
                )}
              </li>
            </ol>
            <p>
              {tr(
                "第一版使用8位RGB工作图进行轮廓测量；TIFF原文件完整保存，但不用于定量光强分析。多页TIFF、焦点堆叠、自动物种分类尚未实现。文件不会上传。",
              )}
            </p>
            <button
              className="button secondary"
              onClick={() => {
                setHelp(false);
                void demo();
              }}
            >
              <FileImage size={16} />
              {tr("载入合成示例")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
