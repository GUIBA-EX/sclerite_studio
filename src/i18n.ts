import { useSyncExternalStore } from "react";
import english from "./i18n-en.json";
import nativeEnglish from "./i18n-native.json";

export type Language = "zh-CN" | "en";
export const LANGUAGE_KEY = "sclerite-studio-language";
const catalog: Record<string, string> = { ...english, ...nativeEnglish };
const listeners = new Set<() => void>();
function readLanguage(): Language {
  try {
    return localStorage.getItem(LANGUAGE_KEY) === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}
let language = readLanguage();
export const getLanguage = () => language;
function updateDocument() {
  if (typeof document === "undefined") return;
  document.documentElement.lang = language;
  document.title =
    language === "en" ? "Sclerite Studio" : "Sclerite Studio · 骨针工作室";
}
updateDocument();
export function setLanguage(next: Language) {
  if (next !== "en" && next !== "zh-CN") return;
  language = next;
  try {
    localStorage.setItem(LANGUAGE_KEY, next);
  } catch {
    /* Private browsing: session choice still works. */
  }
  updateDocument();
  listeners.forEach((listener) => listener());
}
export function useLanguage() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getLanguage,
    () => "zh-CN" as const,
  );
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Only these placeholders contain other application messages. All other
// captures (including filenames and class/specimen names) remain verbatim.
const messageParameters: Record<string, number[]> = {
  "{0}：{1}（{2} 枚）。模型建议保持不变。": [0, 1],
  "模型已自动保存。{0}；{1}{2}。": [0, 1, 2],
  "已沿长轴竖直转正{0}。{1}不推断头尾，可逐枚翻转和微调。": [0, 1],
  "已导出第{0}页2400×1800 PNG。{1}。其余页请“导出全部页”。": [1],
  "{0}透明抠图；自动转正只改变显示方向，仍可逐枚移动、旋转和缩放。": [0],
  "从当前工作空间移除“{0}”？该照片的分割和确认记录{1}将一并移除。不会删除磁盘上的原始照片；已保存的项目文件不受影响。":
    [1],
  "{0} 张图像缺少{1}。": [1],
  "标本 {0} 的{1}记录不一致。": [1],
  "缺少{0}集；不能导出可训练划分。": [0],
};
// Older workers/native code return canonical Chinese messages. Match whole
// templates only, never replace arbitrary substrings in names or filenames.
const patterns = Object.entries(catalog)
  .filter(
    ([source]) =>
      /\{\d+\}/.test(source) && source.replace(/\{\d+\}/g, "").length >= 2,
  )
  .sort(
    ([a], [b]) =>
      b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length,
  )
  .map(([source, target]) => {
    const indices: number[] = [];
    const parts = source.split(/(\{\d+\})/g).map((part) => {
      if (/^\{\d+\}$/.test(part)) {
        indices.push(Number(part.slice(1, -1)));
        return "([\\s\\S]*?)";
      }
      return escape(part);
    });
    return {
      source,
      target,
      indices,
      pattern: new RegExp("^" + parts.join("") + "$"),
    };
  });
function format(template: string, values: unknown[]) {
  return template.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : token,
  );
}
/** Translate application-owned text only. Never pass user-authored metadata. */
export function tr(source: string, ...values: unknown[]): string {
  if (language === "zh-CN") return format(source, values);
  if (Object.hasOwn(catalog, source)) return format(catalog[source], values);
  if (values.length) return format(source, values);
  if (source.startsWith("Error: ")) return "Error: " + tr(source.slice(7));
  for (const { source: key, target, indices, pattern } of patterns) {
    const match = source.match(pattern);
    if (!match) continue;
    const params: string[] = [];
    indices.forEach((index, i) => {
      const value = match[i + 1];
      params[index] = messageParameters[key]?.includes(index)
        ? translateDetail(value)
        : value;
    });
    return format(target, params);
  }
  // Preserve diagnostic details from the OS and third-party libraries.
  return source;
}

function translateDetail(source: string): string {
  const translated = tr(source);
  if (translated !== source) return translated;
  // Adjacent application-only clauses in native/training progress messages.
  const separator = source.indexOf("；");
  if (separator >= 0) {
    const head = source.slice(0, separator + 1);
    const tail = source.slice(separator + 1);
    return tr(head) + translateDetail(tail);
  }
  return source;
}
