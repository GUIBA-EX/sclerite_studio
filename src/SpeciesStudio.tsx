import { tr, useLanguage } from "./i18n";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  BookOpen,
  ChartScatter,
  Save,
  ShieldCheck,
  Tags,
} from "lucide-react";
import JSZip from "jszip";
import type { ImageEntry } from "./types";
import { IconButton } from "./ui";
import { csv, saveBlob } from "./io";
import {
  auditStudy,
  PARTITION_LABELS,
  SAMPLING_LABELS,
  SOURCE_LABELS,
  studyOf,
  summarizeStudy,
  summaryCSV,
  tabular,
  uniqueRealImages,
} from "./species";
import type { StudyMetadata, Summary } from "./species";
import { REFERENCES, ROUTE_STEPS, SPECIES_ROUTE } from "./species-route";
import "./species.css";

const f = (n: number | null, digits = 2) =>
  n === null
    ? "—"
    : n.toLocaleString("en-US", { maximumFractionDigits: digits });
const tabs = [
  ["route", "技术路线", BookOpen],
  ["metadata", "标本信息", Tags],
  ["compare", "形态比较", ChartScatter],
  ["audit", "验证与导出", ShieldCheck],
] as const;

function Scatter({ rows }: { rows: Summary[] }) {
  const points = rows.filter((r) => r.length[1] !== null && r.width !== null);
  if (!points.length)
    return (
      <div className="study-empty">
        {tr("当前筛选下没有已校准的完整骨针。请先回到图像工作台校准尺度。")}
      </div>
    );
  const maxX = Math.max(1, ...points.map((p) => p.length[1]!)) * 1.12;
  const maxY = Math.max(1, ...points.map((p) => p.width!)) * 1.18;
  return (
    <svg
      className="study-scatter"
      viewBox="0 0 740 330"
      role="img"
      aria-label={tr(
        "按标本和组织汇总的长度与宽度中位数散点图，不是物种聚类结果",
      )}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line
            x1="65"
            x2="710"
            y1={275 - i * 57}
            y2={275 - i * 57}
            stroke="#e0e7e2"
          />
          <text x="54" y={279 - i * 57} textAnchor="end">
            {f((maxY * i) / 4, 0)}
          </text>
          <text x={65 + i * 161.25} y="295" textAnchor="middle">
            {f((maxX * i) / 4, 0)}
          </text>
        </g>
      ))}
      <path d="M65 35 V275 H710" fill="none" stroke="#80968e" />
      <text x="65" y="19">
        {tr("宽度中位数（μm）")}
      </text>
      <text x="710" y="320" textAnchor="end">
        {tr("最大 Feret 径中位数（μm）")}
      </text>
      {points.map((p, i) => (
        <g key={p.key}>
          <circle
            cx={65 + (p.length[1]! / maxX) * 645}
            cy={275 - (p.width! / maxY) * 228}
            r="6"
            fill="#247f70"
          >
            <title>
              {p.specimen} · {p.tissue} {tr("· 已校准 n=")}
              {p.calibratedN} {tr("· 长")} {f(p.length[1])} {tr("μm / 宽")}{" "}
              {f(p.width)} μm
            </title>
          </circle>
          <text
            x={74 + (p.length[1]! / maxX) * 645}
            y={271 - (p.width! / maxY) * 228}
          >
            {i + 1}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function SpeciesStudio({
  images,
  activeId,
  onChange,
  onClose,
  onSave,
  busy,
}: {
  images: ImageEntry[];
  activeId: string;
  onChange: (ids: string[], patch: Partial<ImageEntry>) => void;
  onClose: () => void;
  onSave: () => Promise<boolean>;
  busy: boolean;
}) {
  useLanguage();
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("route");
  const [editId, setEditId] = useState(activeId || images[0]?.id || "");
  const [tissue, setTissue] = useState("");
  const [morph, setMorph] = useState("");
  const [source, setSource] = useState("");
  const [sampling, setSampling] = useState("");
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const modal = useRef<HTMLDivElement>(null);
  const disabled = busy || exporting;
  const entry = images.find((e) => e.id === editId) ?? images[0];
  const meta = entry ? studyOf(entry) : undefined;
  const summary = useMemo(() => summarizeStudy(images, morph), [images, morph]);
  const fullSummary = useMemo(() => summarizeStudy(images), [images]);
  const audit = useMemo(() => auditStudy(images), [images]);
  const tissues = [...new Set(fullSummary.map((r) => r.tissue))];
  const effectiveTissue = tissues.includes(tissue)
    ? tissue
    : (tissues[0] ?? "");
  const rows = summary.filter(
    (r) =>
      r.tissue === effectiveTissue &&
      (!source || r.source === source) &&
      (!sampling || r.sampling === sampling),
  );
  const morphs = [
    ...new Set(fullSummary.flatMap((r) => Object.keys(r.morphotypes))),
  ].sort();
  const realCount = fullSummary.reduce((sum, row) => sum + row.n, 0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    modal.current?.focus();
    return () => {
      previous?.focus();
    };
  }, []);
  function updateMeta(patch: Partial<StudyMetadata>) {
    if (entry && meta) onChange([entry.id], { study: { ...meta, ...patch } });
  }
  async function exportStudy() {
    setExporting(true);
    setMessage("正在整理研究资料…");
    try {
      const zip = new JSZip();
      const eligible = uniqueRealImages(images).filter(
        (e) => e.specimen.trim() && e.tissue.trim() && e.tissue !== "未指定",
      );
      zip.file("specimen-summary.csv", summaryCSV(fullSummary));
      zip.file("confirmed-observations.csv", csv(eligible));
      zip.file(
        "image-metadata.csv",
        tabular([
          [
            "image_id",
            "image_name",
            "specimen",
            "tissue",
            "synthetic",
            "sha256",
            ...Object.keys(studyOf(images[0] ?? ({} as ImageEntry))),
          ],
          ...images.map((e) => [
            e.id,
            e.name,
            e.specimen,
            e.tissue,
            e.synthetic,
            e.sourceHash,
            ...Object.values(studyOf(e)),
          ]),
        ]),
      );
      zip.file(
        "audit.json",
        JSON.stringify(
          {
            schema: "sclerite-study/1",
            createdAt: new Date().toISOString(),
            biologicalValidation: "not_performed",
            ...audit,
          },
          null,
          2,
        ),
      );
      if (audit.canExportSplit)
        zip.file(
          "split-manifest.csv",
          tabular([
            ["image_id", "specimen", "colony", "group_id", "partition"],
            ...images
              .filter((e) => !e.synthetic && studyOf(e).partition !== "exclude")
              .map((e) => [
                e.id,
                e.specimen,
                studyOf(e).colony,
                audit.groups.find((g) => g.imageIds.includes(e.id))?.id,
                studyOf(e).partition,
              ]),
          ]),
        );
      zip.file("technical-route.md", SPECIES_ROUTE);
      zip.file(
        "README.txt",
        `Sclerite Studio 0.11 — 研究资料，不是完整图像项目。\n请另存 Studio 项目以保留原图与 mask。\n汇总：仅真实图像、完整确认实例、已填标本和组织；排除用途=exclude；原图 SHA256 相同只保留第一份。长度单位 μm，未校准不进入尺寸统计。四分位数不是置信区间。所有组织 / 来源 / 取样方式完整导出，不受界面筛选影响。\n逐枚 ID 需与 image_id 联合使用。详见 audit.json 和 technical-route.md。\n${audit.canExportSplit ? "已附分组划分；仅元数据检查通过，未经模型 / 生物学验证。" : "存在待解决项，未生成 split-manifest.csv；不能视作可用的独立验证划分。"}\n`,
      );
      if (
        await saveBlob(
          await zip.generateAsync({ type: "blob", compression: "DEFLATE" }),
          "sclerite-study.zip",
        )
      )
        setMessage("研究资料已导出。原图与 mask 请另外保存 Studio 项目。");
      else setMessage("已取消导出。");
    } catch (error) {
      setMessage("导出失败：" + String(error));
    } finally {
      setExporting(false);
    }
  }
  return (
    <div
      className="study-modal"
      ref={modal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="study-title"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !disabled) onClose();
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
          e.preventDefault();
          if (!disabled)
            void onSave().then((ok) =>
              setMessage(
                ok
                  ? "项目已保存，包含研究信息。"
                  : "未保存：已取消或保存失败。",
              ),
            );
        }
        if (e.key !== "Tab") return;
        const nodes = [
          ...modal.current!.querySelectorAll<HTMLElement>(
            "button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary",
          ),
        ].filter((n) => n.getClientRects().length);
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === modal.current)
        ) {
          e.preventDefault();
          last?.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === modal.current)
        ) {
          e.preventDefault();
          first?.focus();
        }
      }}
    >
      <header className="study-header">
        <div>
          <p className="eyebrow">SPECIES HYPOTHESES · EXPLORATORY</p>
          <h1 id="study-title">
            {tr("物种界定研究")} <span className="tag">{tr("探索版")}</span>
          </h1>
        </div>
        <div className="header-actions">
          <IconButton
            icon={Save}
            label={tr("保存项目与研究信息")}
            disabled={disabled || !images.length}
            onClick={() =>
              void onSave().then((ok) =>
                setMessage(
                  ok
                    ? "项目已保存，包含研究信息。"
                    : "未保存：已取消或保存失败。",
                ),
              )
            }
          />
          <IconButton
            icon={ArrowDownToLine}
            label={tr("导出研究资料")}
            disabled={disabled || !images.length}
            onClick={() => void exportStudy()}
          />
          <button
            className="button secondary"
            disabled={disabled}
            onClick={onClose}
          >
            <ArrowLeft size={16} />
            {tr("返回图像")}
          </button>
        </div>
      </header>
      <nav className="study-nav" aria-label={tr("物种研究页面")}>
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            <Icon size={17} />
            {tr(label)}
          </button>
        ))}
      </nav>
      <main className="study-content">
        <div className="study-stats">
          <span>
            <b>{audit.colonyCount}</b> {tr("已填母群体")}
          </span>
          <span>
            <b>{new Set(fullSummary.map((r) => r.specimen)).size}</b>{" "}
            {tr("汇总标本")}
          </span>
          <span>
            <b>{realCount}</b> {tr("纳入的完整骨针")}
          </span>
          <span className="study-boundary">
            {tr("形态分离 ≠ 物种成立 · 单枚骨针不是独立标本")}
          </span>
        </div>
        {tab === "route" && (
          <>
            <div className="study-intro">
              <h2>{tr("先刻画标本，再检验物种假说")}</h2>
              <p>
                {tr(
                  "沿用现有的分割、完整性确认与排版。这里把骨针测量组织为可比较的标本证据，保留未知和冲突，不自动给出物种结论。",
                )}
              </p>
            </div>
            <div className="study-route">
              {ROUTE_STEPS.map((step) => (
                <article key={tr(step.title)}>
                  <small>{tr(step.status)}</small>
                  <h3>{tr(step.title)}</h3>
                  <p>{tr(step.body)}</p>
                </article>
              ))}
            </div>
            <div className="study-note">
              <b>{tr("本版不含模型训练、PCA / 聚类或分子界定运算。")}</b>{" "}
              {tr(
                "先把样本层级、校准与分组验证做好。图像 embedding、morphotype 分类与跨标本鉴定作为后续可独立验证的模块。",
              )}
            </div>
            <details className="study-card">
              <summary>{tr("证据来源与 poster 的边界")}</summary>
              <p>
                {tr(
                  "用户提供的 Dendronephthya poster 展示了 3 个标本的骨针图像分类尝试。当前照片与公开资料不足以核实独立标本验证，不将展示的分类率当成物种界定性能。",
                )}
              </p>
              {REFERENCES.map((ref) => (
                <p key={ref.url}>
                  <a href={ref.url} target="_blank" rel="noreferrer">
                    {tr(ref.title)}
                  </a>{" "}
                  — {tr(ref.note)}
                </p>
              ))}
              <button
                className="button secondary"
                onClick={() =>
                  void saveBlob(
                    new Blob([SPECIES_ROUTE], {
                      type: "text/markdown;charset=utf-8",
                    }),
                    "species-technical-route.md",
                  ).catch((error) => setMessage(String(error)))
                }
              >
                {tr("下载完整技术路线")}
              </button>
            </details>
          </>
        )}
        {tab === "metadata" && (
          <div className="study-editor">
            <aside className="study-image-list">
              {images.map((e) => (
                <button
                  key={e.id}
                  aria-pressed={entry?.id === e.id}
                  onClick={() => setEditId(e.id)}
                >
                  <img src={e.url} alt="" />
                  <span>
                    <b>{e.name}</b>
                    <small>
                      {e.specimen || tr("待填标本")} ·{" "}
                      {e.synthetic ? tr("合成示例") : e.tissue}
                    </small>
                  </span>
                </button>
              ))}
              {!images.length && <p>{tr("返回图像工作台导入照片后填写。")}</p>}
            </aside>
            {entry && meta && (
              <fieldset disabled={disabled} className="study-form">
                <h2>{entry.name}</h2>
                <label className="study-include">
                  <input
                    type="checkbox"
                    disabled={entry.synthetic}
                    checked={!entry.synthetic && meta.partition !== "exclude"}
                    onChange={(e) =>
                      updateMeta({
                        partition: e.target.checked ? "unassigned" : "exclude",
                      })
                    }
                  />
                  {tr("纳入研究（取消仅排除此图，不删除照片）")}
                </label>
                <p className="muted">
                  {tr(
                    "编号须在项目内唯一。一个母群体的不同组织标本使用相同母群体编号；不确定时留空，不从照片名推断。",
                  )}
                </p>
                <div className="study-fields">
                  <label>
                    {tr("标本编号")}
                    <input
                      aria-label={tr("研究标本编号")}
                      value={entry.specimen}
                      onChange={(e) =>
                        onChange([entry.id], { specimen: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {tr("母群体编号")}
                    <input
                      value={meta.colony}
                      placeholder={tr("例如 COL-001")}
                      onChange={(e) => updateMeta({ colony: e.target.value })}
                    />
                  </label>
                  <label>
                    {tr("组织区域")}
                    <input
                      aria-label={tr("研究组织区域")}
                      value={entry.tissue}
                      onChange={(e) =>
                        onChange([entry.id], { tissue: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {tr("图像来源")}
                    <select
                      aria-label={tr("图像来源")}
                      value={meta.source}
                      onChange={(e) =>
                        updateMeta({
                          source: e.target.value as StudyMetadata["source"],
                        })
                      }
                    >
                      {Object.entries(SOURCE_LABELS).map(([v, t]) => (
                        <option key={v} value={v}>
                          {tr(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tr("取样方式")}
                    <select
                      aria-label={tr("取样方式")}
                      value={meta.sampling}
                      onChange={(e) =>
                        updateMeta({
                          sampling: e.target.value as StudyMetadata["sampling"],
                        })
                      }
                    >
                      {Object.entries(SAMPLING_LABELS).map(([v, t]) => (
                        <option key={v} value={v}>
                          {tr(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    {tr("成像 / 制片批次")}
                    <input
                      value={meta.batch}
                      placeholder={tr("同批处理填写相同编号")}
                      onChange={(e) => updateMeta({ batch: e.target.value })}
                    />
                  </label>
                  <label>
                    publication ID / DOI
                    <input
                      value={meta.publication}
                      placeholder={tr("论文图版必填；同论文同 ID")}
                      onChange={(e) =>
                        updateMeta({ publication: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {tr("地点 / 深度记录")}
                    <input
                      value={meta.locality}
                      onChange={(e) => updateMeta({ locality: e.target.value })}
                    />
                  </label>
                  <label>
                    {tr("既有鉴定（保留 cf. / aff.）")}
                    <input
                      value={meta.taxon}
                      placeholder={tr("未知可留空，不是训练真值保证")}
                      onChange={(e) => updateMeta({ taxon: e.target.value })}
                    />
                  </label>
                  <label>
                    {tr("候选分组（人工假说）")}
                    <input
                      value={meta.hypothesis}
                      placeholder={tr("例如 H1；不自动当成物种")}
                      onChange={(e) =>
                        updateMeta({ hypothesis: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    {tr("分子谱系（外部结果记录）")}
                    <input
                      value={meta.lineage}
                      placeholder={tr("例如 UCE clade A")}
                      onChange={(e) => updateMeta({ lineage: e.target.value })}
                    />
                  </label>
                </div>
                <label>
                  {tr("证据与冲突记录")}
                  <textarea
                    rows={4}
                    value={meta.evidence}
                    placeholder={tr(
                      "记录树 / 数据集来源、凭证、组织差异、支持与冲突。此处不运行分子分析。",
                    )}
                    onChange={(e) => updateMeta({ evidence: e.target.value })}
                  />
                </label>
                <p className="study-note">
                  {tr(
                    "形态标签在图像工作台的“形态备注”中逐枚填写；保存项目会同时保存这些研究信息。研究资料导出不含原图和 mask。",
                  )}
                </p>
              </fieldset>
            )}
          </div>
        )}
        {tab === "compare" && (
          <>
            <div className="study-intro">
              <h2>{tr("标本形态分布")}</h2>
              <p>
                {tr(
                  "同组织比较；每一行是一个标本、来源和取样方式的组合。原图去重、合成图及排除图不纳入；缺少标本或组织的图像暂不汇总。",
                )}
              </p>
            </div>
            <div className="study-filters">
              <label>
                {tr("组织")}
                <select
                  value={effectiveTissue}
                  onChange={(e) => setTissue(e.target.value)}
                >
                  {tissues.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </label>
              <label>
                {tr("形态类型")}
                <select
                  value={morph}
                  onChange={(e) => setMorph(e.target.value)}
                >
                  <option value="">{tr("全部形态（混合分布）")}</option>
                  {morphs.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </select>
              </label>
              <label>
                {tr("来源")}
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                >
                  <option value="">{tr("全部来源（分行展示）")}</option>
                  {Object.entries(SOURCE_LABELS).map(([v, t]) => (
                    <option key={v} value={v}>
                      {tr(t)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {tr("取样")}
                <select
                  value={sampling}
                  onChange={(e) => setSampling(e.target.value)}
                >
                  <option value="">{tr("全部取样（分行展示）")}</option>
                  {Object.entries(SAMPLING_LABELS).map(([v, t]) => (
                    <option key={v} value={v}>
                      {tr(t)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="study-card">
              <Scatter rows={rows} />
              <p className="muted">
                {tr(
                  "编号对应下表中有校准尺寸的行。未显示自动聚类；重叠点可通过下表区分。四分位区间不是置信区间。",
                )}
              </p>
            </div>
            <div className="study-table-wrap">
              <table>
                <thead>
                  <tr>
                    {[
                      tr("标本 / 来源"),
                      tr("骨针 n / 校准 n"),
                      tr("长度中位数 [Q1, Q3] μm"),
                      tr("宽度 μm"),
                      tr("长宽比 / 圆度"),
                      tr("形态组成（观察计数）"),
                      tr("人工假说 / 分子谱系"),
                    ].map((h) => (
                      <th key={h}>{tr(h)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td>
                        <small>
                          {r.length[1] !== null && r.width !== null
                            ? tr(
                                "图中 {0}",
                                rows
                                  .filter(
                                    (p) =>
                                      p.length[1] !== null && p.width !== null,
                                  )
                                  .findIndex((p) => p.key === r.key) + 1,
                              )
                            : tr("未校准")}
                        </small>
                        <b>{r.specimen}</b>
                        <small>
                          {tr(SOURCE_LABELS[r.source])} ·{" "}
                          {tr(SAMPLING_LABELS[r.sampling])}
                        </small>
                      </td>
                      <td>
                        {r.n} / {r.calibratedN}
                      </td>
                      <td>
                        {f(r.length[1])} [{f(r.length[0])}, {f(r.length[2])}]
                      </td>
                      <td>{f(r.width)}</td>
                      <td>
                        {f(r.aspect)} / {f(r.circularity, 3)}
                      </td>
                      <td>
                        {Object.entries(r.morphotypes)
                          .map(([m, n]) => `${m}: ${n}`)
                          .join(" · ")}
                      </td>
                      <td>
                        {r.hypotheses.join(" / ") || tr("未设假说")}
                        <small>
                          {r.lineages.join(" / ") || tr("未记录分子谱系")}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!rows.length && (
                <div className="study-empty">
                  {tr(
                    "暂无可汇总数据。请填写标本和组织，确认完整骨针；也可调整筛选。",
                  )}
                </div>
              )}
            </div>
            <p className="study-note">
              {tr(
                "观察计数受人工挑选与完整性筛选影响，不代表自然频率。多枚骨针是标本内重复；尺寸统计只使用已校准子集，不能用骨针总数替代独立母群体数。",
              )}
            </p>
          </>
        )}
        {tab === "audit" && (
          <>
            <div className="study-intro">
              <h2>{tr("先检查独立性，再评价模型")}</h2>
              <p>
                {tr(
                  "共享标本、母群体、论文、批次或原图的照片形成关联组，必须整体分配。改变组用途会同步组内真实图像；合成示例始终不纳入研究。",
                )}
              </p>
            </div>
            <div className="study-audit-heading">
              <span className={`badge ${audit.canExportSplit ? "green" : ""}`}>
                {audit.canExportSplit
                  ? tr("元数据检查通过 · 非科学验证")
                  : tr(
                      "{0} 项待解决",
                      audit.issues.filter((i) => i.level === "block").length,
                    )}
              </span>
              <button
                className="button primary"
                disabled={disabled || !images.length}
                onClick={() => void exportStudy()}
              >
                <ArrowDownToLine size={16} />
                {tr("导出研究资料")}
              </button>
            </div>
            <div className="study-issues">
              {audit.issues.map((issue, i) => (
                <p key={i} className={issue.level}>
                  <b>{issue.level === "block" ? tr("待解决") : tr("注意")}</b>
                  {tr(issue.message)}
                </p>
              ))}
            </div>
            <div className="study-table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{tr("关联组")}</th>
                    <th>{tr("标本")}</th>
                    <th>{tr("图像数")}</th>
                    <th>{tr("当前用途")}</th>
                    <th>{tr("整体分配")}</th>
                  </tr>
                </thead>
                <tbody>
                  {audit.groups.map((g, i) => {
                    const members = images.filter(
                      (e) => g.imageIds.includes(e.id) && !e.synthetic,
                    );
                    const values = [
                      ...new Set(members.map((e) => studyOf(e).partition)),
                    ];
                    return (
                      <tr key={g.id}>
                        <td>G{String(i + 1).padStart(2, "0")}</td>
                        <td>{g.specimens.join(" / ") || tr("待填编号")}</td>
                        <td>{g.imageIds.length}</td>
                        <td>
                          {values
                            .map((v) => tr(PARTITION_LABELS[v]))
                            .join(" / ") || tr("仅合成示例")}
                        </td>
                        <td>
                          <select
                            aria-label={tr("关联组 {0} 用途", i + 1)}
                            disabled={disabled || !members.length}
                            value={values.length === 1 ? values[0] : ""}
                            onChange={(e) => {
                              const partition = e.target
                                .value as StudyMetadata["partition"];
                              members.forEach((m) =>
                                onChange([m.id], {
                                  study: { ...studyOf(m), partition },
                                }),
                              );
                            }}
                          >
                            <option disabled value="">
                              {tr("用途不一致")}
                            </option>
                            {Object.entries(PARTITION_LABELS).map(([v, t]) => (
                              <option key={v} value={v}>
                                {tr(t)}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="study-note">
              {tr(
                "研究资料始终可导出，保留问题记录；只有待解决项清零才附 split-manifest.csv。不会因软件检查通过就生成准确率或物种结论。标本数充足性、标签可靠性和物种级独立验证仍须另行评估。",
              )}
            </p>
          </>
        )}
      </main>
      <footer className="study-footer" role="status">
        {tr(message) ||
          tr("研究字段随 Studio 项目保存 · 无自动定种 · 分子证据仅作人工记录")}
      </footer>
    </div>
  );
}
