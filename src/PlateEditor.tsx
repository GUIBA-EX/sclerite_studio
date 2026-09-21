import { tr, useLanguage } from "./i18n";
import { LanguageSelect } from "./LanguageSelect";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ImageEntry } from "./types";
import { confirmedEntry } from "./review";
import { saveBlob } from "./io";
import JSZip from "jszip";
import {
  Undo2,
  Redo2,
  FolderOpen,
  Save,
  Download,
  PanelLeft,
  PanelRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
import { IconButton, MOD } from "./ui";
import {
  layoutOriginal,
  pageScales,
  pageSources,
  sourceLetter,
} from "./plateLayout";
import {
  isUniform,
  moveItems,
  alignItems,
  constrainItem,
  parsePlate,
  PAGE,
  maskAxis,
  uprightItem,
  rotatedSize,
  normalizeAngle,
} from "./plate";
import type { Plate, PlateItem, PlateBackground, PlateSettings } from "./plate";

export default function PlateEditor({
  open,
  images,
  onClose,
  onDirty,
  items,
  setItems,
  savedToken,
  background,
  setBackground,
  settings,
  setSettings,
}: {
  open: boolean;
  images: ImageEntry[];
  onClose: () => void;
  onDirty: (dirty: boolean) => void;
  items: PlateItem[];
  setItems: Dispatch<SetStateAction<PlateItem[]>>;
  savedToken: number;
  background: PlateBackground;
  setBackground: Dispatch<SetStateAction<PlateBackground>>;
  settings: PlateSettings;
  setSettings: Dispatch<SetStateAction<PlateSettings>>;
}) {
  useLanguage();
  const [selected, setSelected] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  const [history, setHistory] = useState<
    {
      items: PlateItem[];
      background: PlateBackground;
      settings: PlateSettings;
    }[]
  >([]);
  const [autoUpright, setAutoUpright] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(true);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [viewZoom, setViewZoom] = useState(1);
  const [future, setFuture] = useState<typeof history>([]);
  const [marquee, setMarquee] = useState<{
    x: number;
    y: number;
    endX: number;
    endY: number;
    initial: string[];
  } | null>(null);
  const rotation = useRef<{
    item: PlateItem;
    start: number;
    before: PlateItem[];
  } | null>(null);
  const sliderBefore = useRef<PlateItem[] | null>(null);
  const [page, setPage] = useState(1);
  const [includedSources, setIncludedSources] = useState<string[] | null>(null);
  const pages = [...new Set(items.map((i) => i.page ?? 1))].sort(
    (a, b) => a - b,
  );
  const visibleItems = items.filter((i) => (i.page ?? 1) === page);
  const scales = pageScales(visibleItems, settings.showScaleBars);
  useEffect(() => {
    if (items.length && !pages.includes(page)) setPage(pages[0]);
  }, [items, page]);
  useEffect(() => {
    setSelected("");
    setSelection([]);
  }, [page]);
  const ink = background === "black" ? "#ffffff" : "#182b29";
  const [selection, setSelection] = useState<string[]>([]),
    [snap, setSnap] = useState(true);
  useLayoutEffect(() => setSettingsOpen(!selection.length), [selection.length]);
  const exportMenu = useRef<HTMLDetailsElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    modal.current?.focus();
    const close = (e: PointerEvent) => {
      if (!exportMenu.current?.contains(e.target as Node))
        exportMenu.current?.removeAttribute("open");
    };
    document.addEventListener("pointerdown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      previous?.focus();
    };
  }, [open]);
  const uniform = isUniform(visibleItems);
  useEffect(() => {
    if (selected && !visibleItems.some((i) => i.key === selected)) {
      setSelected("");
      setSelection([]);
    }
  }, [items, page, selected]);
  const stale = items.some((i) => {
    const e = images.find((e) => e.id === i.sourceId);
    return (
      !e?.analysis ||
      e.analysis.revision !== i.sourceRevision ||
      e.calibration?.umPerPixel !== i.umPerPixel ||
      !e.analysis.approvedIds?.includes(i.instanceId)
    );
  });
  useEffect(() => {
    setDirty(false);
    setHistory([]);
    setFuture([]);
  }, [savedToken]);
  const svg = useRef<SVGSVGElement>(null),
    input = useRef<HTMLInputElement>(null);
  const drag = useRef<{
    x: number;
    y: number;
    item: PlateItem;
    before: PlateItem[];
  } | null>(null);
  const object = items.find((i) => i.key === selected);
  function selectAll() {
    setSelection(visibleItems.map((i) => i.key));
    setSelected(visibleItems[0]?.key ?? "");
  }
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  function change(
    next: PlateItem[],
    undo = true,
    nextBackground = background,
    nextSettings = settings,
  ) {
    setFuture([]);
    if (undo)
      setHistory((h) => [...h, { items, background, settings }].slice(-20));
    setItems(next);
    setBackground(nextBackground);
    setSettings(nextSettings);
    setDirty(true);
  }
  function patch(values: Partial<PlateItem>) {
    if (!object) return;
    change(
      items.map((i) =>
        i.key === selected ? constrainItem({ ...i, ...values }) : i,
      ),
      !sliderBefore.current,
    );
  }
  function undo() {
    const prior = history.at(-1);
    if (prior) {
      setFuture((f) => [...f, { items, background, settings }]);
      setItems(prior.items);
      setBackground(prior.background);
      setSettings(prior.settings);
      setHistory((h) => h.slice(0, -1));
      setDirty(true);
    }
  }
  function redo() {
    const next = future.at(-1);
    if (!next) return;
    setHistory((h) => [...h, { items, background, settings }].slice(-20));
    setItems(next.items);
    setBackground(next.background);
    setSettings(next.settings);
    setFuture((f) => f.slice(0, -1));
    setDirty(true);
  }
  function finishSlider(cancel = false) {
    const before = sliderBefore.current;
    if (before) {
      if (cancel) setItems(before);
      else if (before !== items)
        setHistory((h) =>
          [...h, { items: before, background, settings }].slice(-20),
        );
      sliderBefore.current = null;
    }
  }
  async function straighten(onlySelected = false) {
    setBusy(true);
    try {
      let skipped = 0;
      const next: PlateItem[] = [];
      for (const item of items) {
        if (onlySelected && !selection.includes(item.key)) {
          next.push(item);
          continue;
        }
        let i = item;
        // 旧版版面没有主轴信息，直接从已有透明裁剪计算，无需重分割。
        if (i.longAxisAngle === undefined || i.axisStrength === undefined) {
          const img = new Image();
          img.src = i.image;
          await img.decode();
          const c = document.createElement("canvas");
          c.width = i.sourceWidth;
          c.height = i.sourceHeight;
          const ctx = c.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          i = {
            ...i,
            ...maskAxis(
              ctx.getImageData(0, 0, c.width, c.height).data,
              c.width,
              c.height,
            ),
          };
        }
        if ((i.axisStrength ?? 0) < 0.12) skipped++;
        next.push(
          onlySelected ? constrainItem(uprightItem(i)) : uprightItem(i),
        );
      }
      change(onlySelected ? next : layoutOriginal(next, settings));
      setMessage(
        `已沿长轴竖直转正${onlySelected ? "选中对象，位置尽量保留" : "并重新排版"}。${skipped ? `${skipped}枚近等轴对象方向不稳定，保留原角度。` : ""}不推断头尾，可逐枚翻转和微调。`,
      );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (
        busy ||
        (e.target as HTMLElement).closest(
          "input,select,textarea,[contenteditable=true]",
        )
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAll();
        return;
      }
      if (e.key === "Escape") {
        exportMenu.current?.removeAttribute("open");
        setSelected("");
        setSelection([]);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      const step = e.shiftKey ? 10 : 1;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        change(
          moveItems(
            items,
            selection,
            e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0,
            e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0,
          ),
        );
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function loadConfirmed() {
    setBusy(true);
    setMessage("");
    try {
      const accepted = images
        .filter(
          (e) => includedSources === null || includedSources.includes(e.id),
        )
        .map(confirmedEntry)
        .filter((e) => e.analysis?.objects.length);
      const count = accepted.reduce(
        (n, e) => n + (e.analysis?.objects.length ?? 0),
        0,
      );
      const pixels = accepted.reduce(
        (n, e) =>
          n +
          (e.analysis?.objects.reduce((a, o) => a + o.bbox[2] * o.bbox[3], 0) ??
            0),
        0,
      );
      if (!count) throw new Error("先在候选测量表右侧勾选需要排版的对象。");
      if (count > 200 || pixels > 25_000_000)
        throw new Error("单版最多200个对象、2500万裁剪像素，请分批排版。");
      const next: PlateItem[] = [];
      for (const e of accepted)
        for (const o of e.analysis?.objects ?? []) {
          const [ox, oy, w, h] = o.bbox,
            c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d")!,
            rgba = ctx.createImageData(w, h);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const src = (oy + y) * e.width + ox + x,
                dst = (y * w + x) * 4;
              if (e.analysis!.labels[src] === o.id) {
                rgba.data[dst] = e.data[src * 4];
                rgba.data[dst + 1] = e.data[src * 4 + 1];
                rgba.data[dst + 2] = e.data[src * 4 + 2];
                rgba.data[dst + 3] = 255;
              }
            }
          ctx.putImageData(rgba, 0, 0);
          next.push({
            key: `${e.id}:${o.id}`,
            image: c.toDataURL("image/png"),
            sourceName: e.name,
            sourceId: e.id,
            instanceId: o.id,
            sourceWidth: w,
            sourceHeight: h,
            umPerPixel: e.calibration?.umPerPixel,
            reviewHint: e.analysis?.reviewHints?.[o.id] ?? "",
            sourceRevision: e.analysis?.revision,
            x: 0,
            y: 0,
            width: w,
            height: h,
            angle: 0,
            ...maskAxis(rgba.data, w, h),
            sourceLabel: sourceLetter(accepted.indexOf(e)),
            label: `${sourceLetter(accepted.indexOf(e))}-${o.id}`,
          });
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve()),
          );
        }
      const arranged = layoutOriginal(
        autoUpright ? next.map(uprightItem) : next,
        settings,
      );
      change(arranged);
      setPage(1);
      setSelected(next[0]?.key ?? "");
      setSelection(next[0] ? [next[0].key] : []);
      setMessage(
        `已联合${accepted.length}张照片、${next.length}枚骨针，共${Math.max(...arranged.map((i) => i.page ?? 1))}页。保留尺寸比例；仅过大对象触发全组共同缩小。未校准的px不代表物理大小。`,
      );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function importLayout(file?: File) {
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 50_000_000) throw new Error("版面文件不能超过50 MB");
      const p = parsePlate(JSON.parse(await file.text()));
      // 解码后验证像素尺寸，禁止将非PNG或超大图片写入版面。
      for (const i of p.items) {
        const img = new Image();
        img.src = i.image;
        await img.decode();
        if (
          img.naturalWidth !== i.sourceWidth ||
          img.naturalHeight !== i.sourceHeight
        )
          throw new Error("版面裁剪尺寸与记录不符");
      }
      change(p.items, true, p.background ?? "white", p.settings ?? settings);
      setPage(1);
      setSelected(p.items[0]?.key ?? "");
      setSelection(p.items[0] ? [p.items[0].key] : []);
      setMessage("已打开独立版面快照。原图项目的勾选状态不会随之更改。");
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function saveLayout() {
    setBusy(true);
    try {
      const p: Plate = {
        schema: "sclerite-plate/1",
        ...PAGE,
        items,
        background,
        settings,
      };
      parsePlate(p);
      const blob = new Blob([JSON.stringify(p)], { type: "application/json" });
      if (blob.size > 50_000_000) throw new Error("版面超过50 MB，请分版保存");
      if (await saveBlob(blob, "sclerite-plate.json")) {
        setDirty(false);
        setMessage("可编辑版面已保存，包含透明裁剪及来源信息。");
      }
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function renderPage(pageNumber: number) {
    const current = items.filter((i) => (i.page ?? 1) === pageNumber);
    const annotation = pageScales(current, settings.showScaleBars);
    const c = document.createElement("canvas");
    c.width = 2400;
    c.height = 1800;
    const ctx = c.getContext("2d")!;
    ctx.scale(2, 2);
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, PAGE.width, PAGE.height);
    for (const i of current) {
      const img = new Image();
      img.src = i.image;
      await img.decode();
      ctx.save();
      ctx.translate(i.x, i.y);
      ctx.rotate((i.angle * Math.PI) / 180);
      ctx.drawImage(img, -i.width / 2, -i.height / 2, i.width, i.height);
      ctx.restore();
      ctx.fillStyle = ink;
      ctx.font = "18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(i.label, i.x, i.y + rotatedSize(i).height / 2 + 24);
    }
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineWidth = 3;
    ctx.font = "14px sans-serif";
    for (const b of annotation.bars) {
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x + b.length, b.y);
      ctx.moveTo(b.x, b.y - 4);
      ctx.lineTo(b.x, b.y + 4);
      ctx.moveTo(b.x + b.length, b.y - 4);
      ctx.lineTo(b.x + b.length, b.y + 4);
      ctx.stroke();
      ctx.textAlign = "center";
      ctx.fillText(b.label, b.x + b.length / 2, b.y + 17);
    }
    ctx.textAlign = "left";
    ctx.font = "13px sans-serif";
    if (settings.showSourceNotes !== false)
      ctx.fillText(pageSources(current), 32, 814, 1136);
    ctx.fillText(
      `${tr(annotation.description)}${settings.showScaleBars ? "" : tr(" · 比例尺已隐藏")}`,
      32,
      840,
      1000,
    );
    ctx.fillText(tr("页 {0} · 共 {1} 页", pageNumber, pages.length), 32, 875);
    return new Promise<Blob>((resolve, reject) =>
      c.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("图片生成失败"))),
        "image/png",
      ),
    );
  }
  async function exportAll() {
    setBusy(true);
    try {
      parsePlate({
        schema: "sclerite-plate/1",
        ...PAGE,
        items,
        background,
        settings,
      });
      const zip = new JSZip();
      for (const p of pages)
        zip.file(
          `plate-${String(p).padStart(3, "0")}.png`,
          await (await renderPage(p)).arrayBuffer(),
        );
      zip.file(
        "sources.json",
        JSON.stringify(
          {
            background,
            settings,
            pages: pages.map((p) => ({
              page: p,
              ...pageScales(
                items.filter((i) => (i.page ?? 1) === p),
                settings.showScaleBars,
              ),
            })),
            objects: items.map(({ image, ...i }) => i),
          },
          null,
          2,
        ),
      );
      if (
        await saveBlob(
          await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
          "sclerite-plates.zip",
        )
      )
        setMessage(
          `已导出${pages.length}页PNG及完整来源/比例尺记录。可编辑版面请保存项目。`,
        );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function exportPNG() {
    setBusy(true);
    try {
      parsePlate({ schema: "sclerite-plate/1", ...PAGE, items, background });
      const blob = await renderPage(page);
      if (await saveBlob(blob, "sclerite-plate.png"))
        setMessage(
          `已导出第${page}页2400×1800 PNG。${tr(scales.description)}。其余页请“导出全部页”。`,
        );
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  }
  function point(e: React.PointerEvent) {
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(
      svg.current!.getScreenCTM()!.inverse(),
    );
  }
  if (!open) return null;
  return (
    <div
      className="plate-modal"
      ref={modal}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key !== "Tab") return;
        const nodes = [
          ...(modal.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
          ) ?? []),
        ].filter((el) => el.getClientRects().length && el.checkVisibility());
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === modal.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }}
      role="dialog"
      aria-label={tr("骨针自动排版")}
      aria-modal="true"
    >
      <header>
        <div>
          <h2>
            {tr("骨针排版")}{" "}
            <small>
              {items.length} {tr("个对象")} {dirty ? tr("· 未保存") : ""}
            </small>
          </h2>
          <p>
            {uniform
              ? tr("统一倍率（基于已校准尺度）")
              : scales.description.startsWith("原始像素")
                ? tr(scales.description)
                : tr("独立缩放 · 非统一倍率")}{" "}
            · {MOD} {tr("点击多选 · 方向键微调 · Shift+方向键移动10单位")}
          </p>
        </div>
        <div className="plate-header-actions">
          <LanguageSelect />
          <button
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            {tr("返回测量")}
          </button>
        </div>
      </header>
      <div className="plate-toolbar">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void loadConfirmed()}
        >
          {items.length ? tr("重新载入已确认对象") : tr("载入已确认对象")}
        </button>
        <button
          className="button secondary"
          disabled={busy || !items.length}
          onClick={() => {
            change(layoutOriginal(items, settings));
            setPage(1);
            setMessage("已按当前版面设置恢复原始尺寸比例并排版。");
          }}
        >
          {tr("自动排版")}
        </button>
        <IconButton
          icon={Undo2}
          label={tr("撤销排版")}
          disabled={busy || !history.length}
          onClick={undo}
        />
        <IconButton
          icon={Redo2}
          label={tr("重做排版")}
          disabled={busy || !future.length}
          onClick={redo}
        />
        <IconButton
          icon={FolderOpen}
          label={tr("打开版面")}
          disabled={busy}
          onClick={() => input.current?.click()}
        />
        <IconButton
          icon={Save}
          label={tr("保存版面")}
          title={tr("保存独立版面 JSON；完整工作请使用保存项目")}
          disabled={busy || !items.length}
          onClick={() => void saveLayout()}
        />
        <details
          className="export-menu"
          ref={exportMenu}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("button"))
              exportMenu.current?.removeAttribute("open");
          }}
        >
          <summary title={tr("导出图版")} aria-label={tr("导出图版")}>
            <Download size={18} />
          </summary>
          <div>
            <button
              disabled={busy || !items.length}
              onClick={() => void exportPNG()}
            >
              {tr("导出版面PNG")}
            </button>
            <button
              disabled={busy || !items.length}
              onClick={() => void exportAll()}
            >
              {tr("导出全部页")}
            </button>
          </div>
        </details>
        <span className="toolbar-spacer" />
        <IconButton
          icon={PanelLeft}
          label={tr("页面缩略图")}
          aria-expanded={pagesOpen}
          onClick={() => setPagesOpen((v) => !v)}
        />
        <IconButton
          icon={PanelRight}
          label={tr("排版属性")}
          aria-expanded={inspectorOpen}
          onClick={() => setInspectorOpen((v) => !v)}
        />
        <input
          ref={input}
          type="file"
          accept=".json"
          hidden
          data-testid="plate-input"
          onChange={(e) => {
            void importLayout(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <div className="plate-options">
        <button disabled={busy || !visibleItems.length} onClick={selectAll}>
          {tr("全选本页")}
        </button>
        <button
          disabled={!selection.length || busy}
          onClick={() => {
            setSelection([]);
            setSelected("");
          }}
        >
          {tr("取消选择")}
        </button>
        <span>
          {tr("已选")} {selection.length} {tr("枚 ·")} {MOD}{" "}
          {tr("点击多选 · 空白处拖动框选")}
        </span>
        <span className="toolbar-spacer" />
        <label>
          {tr("页")}{" "}
          <select
            aria-label={tr("排版页码")}
            value={page}
            disabled={busy || !pages.length}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {(pages.length ? pages : [1]).map((p) => (
              <option key={p} value={p}>
                {tr("页 {0} · 共 {1} 页", p, pages.length || 1)}
              </option>
            ))}
          </select>
        </label>
        <IconButton
          icon={ZoomOut}
          label={tr("缩小画布")}
          onClick={() => setViewZoom((z) => Math.max(1, z - 0.25))}
        />
        <span title={tr("只改变观察，不改变骨针尺寸")}>
          {viewZoom === 1 ? tr("适应") : tr("视图 ×{0}", viewZoom.toFixed(2))}
        </span>
        <IconButton
          icon={ZoomIn}
          label={tr("放大画布")}
          onClick={() => setViewZoom((z) => Math.min(4, z + 0.25))}
        />
        <IconButton
          icon={Maximize2}
          label={tr("适应版面")}
          onClick={() => setViewZoom(1)}
        />
      </div>
      {stale && (
        <div className="plate-stale" role="status">
          {tr(
            "版面来源已修改、取消确认或未载入。当前为旧快照；重新载入将重排，可撤销。",
          )}
        </div>
      )}
      <div className="plate-workspace">
        {pagesOpen && (
          <nav className="page-thumbnails" aria-label={tr("图版页面")}>
            {pages.map((p) => (
              <button
                className={p === page ? "active" : ""}
                key={p}
                onClick={() => setPage(p)}
                aria-label={tr("跳转第{0}页", p)}
              >
                <svg viewBox="0 0 1200 900" aria-hidden="true">
                  <rect width="1200" height="900" fill={background} />
                  {items
                    .filter((i) => (i.page ?? 1) === p)
                    .map((i) => (
                      <image
                        key={i.key}
                        href={i.image}
                        x={-i.width / 2}
                        y={-i.height / 2}
                        width={i.width}
                        height={i.height}
                        transform={`translate(${i.x} ${i.y}) rotate(${i.angle})`}
                      />
                    ))}
                </svg>
                <span>{tr("第 {0} 页", p)}</span>
              </button>
            ))}
          </nav>
        )}
        <div className={`plate-paper-wrap ${viewZoom > 1 ? "zoomed" : ""}`}>
          <div
            className="plate-canvas-size"
            style={{
              width: `${viewZoom * 100}%`,
              height: `${viewZoom * 100}%`,
              flexShrink: 0,
            }}
          >
            <svg
              ref={svg}
              tabIndex={0}
              aria-label={tr("可编辑图版，方向键移动选中对象")}
              data-testid="plate-canvas"
              viewBox="0 0 1200 900"
              className="plate-paper"
              onPointerMove={(e) => {
                if (marquee) {
                  const p = point(e);
                  setMarquee((m) =>
                    m ? { ...m, endX: p.x, endY: p.y } : null,
                  );
                  return;
                }
                if (rotation.current) {
                  const g = rotation.current,
                    p = point(e);
                  const delta =
                    ((Math.atan2(p.y - g.item.y, p.x - g.item.x) - g.start) *
                      180) /
                    Math.PI;
                  setItems(
                    g.before.map((i) =>
                      i.key === g.item.key
                        ? constrainItem({
                            ...i,
                            angle: normalizeAngle(i.angle + delta),
                          })
                        : i,
                    ),
                  );
                  setDirty(true);
                  return;
                }
                if (!drag.current) return;
                const p = point(e),
                  g = drag.current;
                const dx = p.x - g.x,
                  dy = p.y - g.y;
                setItems(
                  moveItems(
                    g.before,
                    selection,
                    snap
                      ? Math.round((g.item.x + dx) / 10) * 10 - g.item.x
                      : dx,
                    snap
                      ? Math.round((g.item.y + dy) / 10) * 10 - g.item.y
                      : dy,
                  ),
                );
                setDirty(true);
              }}
              onPointerUp={() => {
                if (marquee) {
                  const m = marquee,
                    left = Math.min(m.x, m.endX),
                    right = Math.max(m.x, m.endX),
                    top = Math.min(m.y, m.endY),
                    bottom = Math.max(m.y, m.endY);
                  const hits =
                    Math.hypot(m.endX - m.x, m.endY - m.y) < 3
                      ? []
                      : visibleItems
                          .filter((i) => {
                            const r = rotatedSize(i);
                            return (
                              i.x + r.width / 2 >= left &&
                              i.x - r.width / 2 <= right &&
                              i.y + r.height / 2 >= top &&
                              i.y - r.height / 2 <= bottom
                            );
                          })
                          .map((i) => i.key);
                  const keys = [...new Set([...m.initial, ...hits])];
                  setSelection(keys);
                  setSelected(keys.at(-1) ?? "");
                  setMarquee(null);
                  return;
                }
                const before = drag.current?.before ?? rotation.current?.before;
                if (before && before !== items) {
                  setFuture([]);
                  setHistory((h) =>
                    [...h, { items: before, background, settings }].slice(-20),
                  );
                }
                drag.current = null;
                rotation.current = null;
              }}
              onPointerCancel={() => {
                if (drag.current) setItems(drag.current.before);
                if (rotation.current) setItems(rotation.current.before);
                drag.current = null;
                rotation.current = null;
                setMarquee(null);
              }}
            >
              <rect
                width="1200"
                height="900"
                data-testid="plate-background"
                fill={background}
                onPointerDown={(e) => {
                  if (busy || e.button !== 0) return;
                  const p = point(e);
                  svg.current?.focus();
                  setMarquee({
                    x: p.x,
                    y: p.y,
                    endX: p.x,
                    endY: p.y,
                    initial:
                      e.metaKey || e.ctrlKey || e.shiftKey ? selection : [],
                  });
                  svg.current!.setPointerCapture(e.pointerId);
                }}
              />
              <rect
                x="20"
                y="20"
                width="1160"
                height="860"
                fill="none"
                stroke="#cbd7cf"
                strokeDasharray="6 6"
                pointerEvents="none"
              />
              {visibleItems.map((i) => (
                <g
                  key={i.key}
                  data-testid="plate-item"
                  data-key={i.key}
                  transform={`translate(${i.x} ${i.y})`}
                  data-angle={i.angle}
                  onPointerDown={(e) => {
                    if (busy) return;
                    e.preventDefault();
                    svg.current?.focus();
                    const keys =
                      e.shiftKey || e.metaKey || e.ctrlKey
                        ? selection.includes(i.key)
                          ? selection.filter((k) => k !== i.key)
                          : [...selection, i.key]
                        : selection.includes(i.key)
                          ? selection
                          : [i.key];
                    setSelection(keys);
                    setSelected(
                      keys.includes(i.key) ? i.key : (keys.at(-1) ?? ""),
                    );
                    if (!keys.includes(i.key)) return;
                    if (e.shiftKey || e.metaKey || e.ctrlKey) return;
                    const p = point(e);
                    drag.current = { x: p.x, y: p.y, item: i, before: items };
                    svg.current!.setPointerCapture(e.pointerId);
                  }}
                >
                  <image
                    transform={`rotate(${i.angle})`}
                    href={i.image}
                    x={-i.width / 2}
                    y={-i.height / 2}
                    width={i.width}
                    height={i.height}
                  />
                  <text
                    y={rotatedSize(i).height / 2 + 24}
                    textAnchor="middle"
                    fontFamily="sans-serif"
                    fontSize="18"
                    fill={ink}
                  >
                    {i.label}
                  </text>
                  <rect
                    x={-rotatedSize(i).width / 2 - 5}
                    y={-rotatedSize(i).height / 2 - 5}
                    width={rotatedSize(i).width + 10}
                    height={rotatedSize(i).height + 38}
                    fill="transparent"
                    stroke={
                      selection.includes(i.key) ? "#07977c" : "transparent"
                    }
                    strokeWidth="2"
                    strokeDasharray="5 3"
                  />
                  {selection.length === 1 && selected === i.key && (
                    <circle
                      data-testid="rotation-handle"
                      cx="0"
                      cy={-rotatedSize(i).height / 2 - 18}
                      r="10"
                      fill="#087e68"
                      stroke="white"
                      strokeWidth="3"
                      style={{ cursor: "crosshair" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        const p = point(e);
                        rotation.current = {
                          item: i,
                          before: items,
                          start: Math.atan2(p.y - i.y, p.x - i.x),
                        };
                        svg.current!.setPointerCapture(e.pointerId);
                      }}
                    />
                  )}
                </g>
              ))}
              {marquee && (
                <rect
                  data-testid="selection-marquee"
                  x={Math.min(marquee.x, marquee.endX)}
                  y={Math.min(marquee.y, marquee.endY)}
                  width={Math.abs(marquee.endX - marquee.x)}
                  height={Math.abs(marquee.endY - marquee.y)}
                  fill="#087e6820"
                  stroke="#087e68"
                  strokeWidth="2"
                  pointerEvents="none"
                />
              )}
              <g
                pointerEvents="none"
                fill={ink}
                stroke={ink}
                data-testid="scale-bars"
              >
                {scales.bars.map((b) => (
                  <g key={b.key} data-unit={b.label} data-bar-length={b.length}>
                    <path
                      d={`M ${b.x} ${b.y} h ${b.length} M ${b.x} ${b.y - 4} v 8 M ${b.x + b.length} ${b.y - 4} v 8`}
                      strokeWidth="3"
                      fill="none"
                    />
                    <text
                      x={b.x + b.length / 2}
                      y={b.y + 17}
                      textAnchor="middle"
                      stroke="none"
                      fontSize="14"
                      fontFamily="sans-serif"
                    >
                      {b.label}
                    </text>
                  </g>
                ))}
                {settings.showSourceNotes !== false && (
                  <text
                    data-testid="source-notes"
                    x="32"
                    y="814"
                    fontSize="13"
                    stroke="none"
                  >
                    {pageSources(visibleItems)}
                  </text>
                )}
                <text x="32" y="840" fontSize="13" stroke="none">
                  {tr(scales.description)}
                  {settings.showScaleBars ? "" : tr(" · 比例尺已隐藏")}
                </text>
                <text x="32" y="875" fontSize="13" stroke="none">
                  {tr("页 {0} · 共 {1} 页", page, pages.length)}
                </text>
              </g>
            </svg>
          </div>
        </div>
        <aside className="plate-inspector" hidden={!inspectorOpen}>
          <details className="plate-settings" open={settingsOpen}>
            <summary
              onClick={(e) => {
                e.preventDefault();
                setSettingsOpen((v) => !v);
              }}
            >
              {tr("版面设置")}
            </summary>
            <label>
              {tr("背景")}{" "}
              <select
                aria-label={tr("版面背景")}
                value={background}
                disabled={busy}
                onChange={(e) =>
                  change(items, true, e.target.value as PlateBackground)
                }
              >
                <option value="white">{tr("白底")}</option>
                <option value="black">{tr("黑底")}</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={autoUpright}
                disabled={busy}
                onChange={(e) => setAutoUpright(e.target.checked)}
              />
              {tr("载入时自动转正")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />
              {tr("网格吸附")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showSourceNotes !== false}
                disabled={busy}
                onChange={(e) =>
                  change(items, true, background, {
                    ...settings,
                    showSourceNotes: e.target.checked,
                  })
                }
              />
              {tr("显示来源注释")}
            </label>
            <label>
              {tr("尺寸依据")}{" "}
              <select
                aria-label={tr("尺寸依据")}
                value={settings.sizeMode}
                disabled={busy}
                onChange={(e) =>
                  change(items, true, background, {
                    ...settings,
                    sizeMode: e.target.value as "auto" | "pixels",
                  })
                }
              >
                <option value="auto">{tr("校准用物理尺度；未校准另页")}</option>
                <option value="pixels">
                  {tr("原始像素（不代表物理大小）")}
                </option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.groupBySource}
                disabled={busy}
                onChange={(e) =>
                  change(items, true, background, {
                    ...settings,
                    groupBySource: e.target.checked,
                  })
                }
              />
              {tr("按照片分组")}
            </label>
            <label>
              <input
                type="checkbox"
                checked={settings.showScaleBars}
                disabled={busy}
                onChange={(e) =>
                  change(items, true, background, {
                    ...settings,
                    showScaleBars: e.target.checked,
                  })
                }
              />
              {tr("显示比例尺")}
            </label>
            <span>{tr("尺寸／分组修改后点击自动排版")}</span>
            <details>
              <summary>{tr("选择参与照片（仅已确认对象）")}</summary>
              <div className="plate-source-list">
                {images.map((e) => (
                  <label key={e.id}>
                    <input
                      type="checkbox"
                      disabled={busy}
                      checked={
                        includedSources === null ||
                        includedSources.includes(e.id)
                      }
                      onChange={(event) =>
                        setIncludedSources((old) => {
                          const ids = old ?? images.map((i) => i.id);
                          return event.target.checked
                            ? [...ids, e.id]
                            : ids.filter((id) => id !== e.id);
                        })
                      }
                    />
                    {e.name} · {e.analysis?.approvedIds?.length ?? 0}
                    {tr("枚")}
                  </label>
                ))}
              </div>
            </details>
            <button
              className="button secondary"
              disabled={busy || !items.length}
              onClick={() => void straighten()}
            >
              {tr("全部沿长轴转正")}
            </button>
            <button
              className="button secondary"
              disabled={
                busy || !items.length || items.some((i) => !i.umPerPixel)
              }
              onClick={() => {
                const next = { ...settings, sizeMode: "auto" as const };
                change(layoutOriginal(items, next), true, background, next);
              }}
            >
              {tr("统一倍率排版")}
            </button>
          </details>
          <h3>
            {selection.length > 1
              ? tr("批量操作 · {0} 枚", selection.length)
              : selection.length
                ? tr("对象属性")
                : tr("未选择对象")}
          </h3>
          {selection.length > 1 && (
            <div className="batch-properties">
              <p>
                {tr(
                  "拖动任一选中对象可整体移动。单枚角度、大小与标签仅在单选时显示。",
                )}
              </p>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => change(alignItems(items, selection, "align"))}
              >
                {tr("水平对齐")}
              </button>
              <button
                className="button secondary"
                disabled={busy || selection.length < 3}
                onClick={() =>
                  change(alignItems(items, selection, "distribute"))
                }
              >
                {tr("横向等距")}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void straighten(true)}
              >
                {tr("选中转正")}
              </button>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  change(items.filter((i) => !selection.includes(i.key)));
                  setSelected("");
                  setSelection([]);
                }}
              >
                {tr("移出版面")}
              </button>
            </div>
          )}
          {object && selection.length === 1 ? (
            <>
              <p>
                {object.sourceName} · #{object.instanceId}
              </p>
              <label>
                {tr("图版标签")}
                <input
                  aria-label={tr("图版标签")}
                  maxLength={100}
                  value={object.label}
                  disabled={busy}
                  onChange={(e) => patch({ label: e.target.value })}
                />
              </label>
              <label>
                {tr("旋转角度")}
                <input
                  aria-label={tr("旋转角度")}
                  type="range"
                  min="-180"
                  max="180"
                  value={object.angle}
                  disabled={busy}
                  onPointerDown={() => {
                    sliderBefore.current = items;
                  }}
                  onPointerUp={() => finishSlider()}
                  onPointerCancel={() => finishSlider(true)}
                  onBlur={() => finishSlider()}
                  onChange={(e) => patch({ angle: Number(e.target.value) })}
                />
                <span>{Math.round(object.angle)}°</span>
              </label>
              <label>
                {tr("角度数值（°）")}
                <input
                  aria-label={tr("角度数值")}
                  type="number"
                  min="-180"
                  max="180"
                  step="1"
                  value={Number(object.angle.toFixed(1))}
                  disabled={busy}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v))
                      patch({ angle: Math.max(-180, Math.min(180, v)) });
                  }}
                />
              </label>
              <div className="plate-size">
                <button
                  className="button secondary"
                  disabled={busy || !selection.length}
                  onClick={() => void straighten(true)}
                >
                  {tr("选中转正")}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    patch({ angle: normalizeAngle(object.angle + 180) })
                  }
                >
                  {tr("翻转180°")}
                </button>
              </div>
              <div className="plate-size">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    patch({
                      width: Math.max(8, object.width * 0.9),
                      height:
                        (Math.max(8, object.width * 0.9) *
                          object.sourceHeight) /
                        object.sourceWidth,
                    })
                  }
                >
                  {tr("缩小对象")}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    patch({
                      width: object.width * 1.1,
                      height: object.height * 1.1,
                    })
                  }
                >
                  {tr("放大对象")}
                </button>
              </div>
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => {
                  change(items.filter((i) => !selection.includes(i.key)));
                  setSelection([]);
                  setSelected("");
                }}
              >
                {tr("移出版面")}
              </button>
              <p>
                {object.reviewHint ||
                  tr("无自动接触提示；不等同于算法确认完整。")}
              </p>
              <p>
                {tr("来源裁剪：")}
                {object.sourceWidth} × {object.sourceHeight} px；
                {object.umPerPixel
                  ? `${object.umPerPixel} μm/px`
                  : tr("未校准")}
                。
              </p>
              <p>
                {tr("PNG导出／原图像素比例：")}
                {((object.width / object.sourceWidth) * 2).toFixed(3)}
                {tr("。手动缩放后标尺同步更新；自动排版可恢复原始尺寸关系。")}
              </p>
            </>
          ) : (
            !selection.length && (
              <p>
                {tr("点击选择对象，或从空白处拖动框选；拖动对象调整位置。")}
              </p>
            )
          )}
          <p>
            {tr(
              "排版不改变原始测量。保存项目包含此版面；也可另存独立版面JSON。原图修改后出现来源提醒，请检查后重新载入。",
            )}
          </p>
        </aside>
      </div>
      <footer role="status">
        {busy
          ? tr("正在处理…")
          : tr(message) ||
            tr(
              "{0}透明抠图；自动转正只改变显示方向，仍可逐枚移动、旋转和缩放。",
              tr(background === "black" ? "黑底" : "白底"),
            )}
      </footer>
    </div>
  );
}
