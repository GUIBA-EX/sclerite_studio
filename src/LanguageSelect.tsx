import { Languages } from "lucide-react";
import { setLanguage, tr, useLanguage } from "./i18n";

export function LanguageSelect() {
  const language = useLanguage();
  return (
    <label className="language-select" title="中文 / English">
      <Languages size={16} aria-hidden="true" />
      <select
        aria-label={tr("语言")}
        value={language}
        onChange={(event) =>
          setLanguage(event.target.value === "en" ? "en" : "zh-CN")
        }
      >
        <option value="zh-CN" lang="zh-CN">
          中文
        </option>
        <option value="en" lang="en">
          English
        </option>
      </select>
    </label>
  );
}
