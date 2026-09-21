import { afterEach, describe, expect, it } from "vitest";
import { getLanguage, setLanguage, tr } from "../src/i18n";
import english from "../src/i18n-en.json";
import native from "../src/i18n-native.json";

afterEach(() => setLanguage("zh-CN"));
describe("bilingual presentation", () => {
  it("defaults to Chinese without storage", () => {
    expect(getLanguage()).toBe("zh-CN");
    expect(tr("图像处理")).toBe("图像处理");
  });
  it("changes language without changing source values", () => {
    const metadata = {
      specimen: "选择",
      category: "完整骨针",
      tissue: "珊瑚虫 polyp",
    };
    setLanguage("en");
    expect(tr("图像处理")).toBe("Image processing");
    expect(metadata).toEqual({
      specimen: "选择",
      category: "完整骨针",
      tissue: "珊瑚虫 polyp",
    });
    setLanguage("zh-CN");
    expect(tr("图像处理")).toBe("图像处理");
  });
  it("interpolates parameters without translating user-authored values", () => {
    setLanguage("en");
    expect(tr("移除照片 {0}", "选择.jpg")).toBe("Remove photo 选择.jpg");
    expect(tr("重命名 {0}", "选择")).toBe("Rename 选择");
    expect(tr("已确认 {0}/{1}", 2, 12)).toBe("Approved 2/12");
  });
  it("translates canonical worker/native messages and dynamic notifications", () => {
    setLanguage("en");
    expect(tr("mask 必须为二值")).toBe("Mask must be binary");
    expect(tr("已提取 15 枚特征（缓存命中 4 枚）。")).toBe(
      "Extracted 15 feature vectors (4 cache hits).",
    );
    expect(tr("分割 1/3 · 选择.jpg")).toBe("Segmenting 1/3 · 选择.jpg");
    expect(tr("文件不存在: /数据/a.jpg")).toBe("文件不存在: /数据/a.jpg");
  });
  it("preserves placeholder identity across every translation", () => {
    for (const [zh, en] of Object.entries({ ...english, ...native })) {
      const tokens = (s: string) =>
        [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();
      expect(tokens(en), zh).toEqual(tokens(zh));
      expect(en.trim(), zh).not.toBe("");
      expect(/[\u3400-\u9fff]/u.test(en), zh).toBe(false);
    }
  });
  it("localizes nested progress clauses but preserves names", () => {
    setLanguage("en");
    expect(
      tr("模型已自动保存。试用模型 · 未独立验证；固定正则强度；优化已收敛。"),
    ).toBe(
      "Model saved automatically. Trial model · not independently validated; Fixed regularization; Optimization converged.",
    );
    expect(tr("重命名 选择")).toBe("Rename 选择");
    expect(tr("Error: 空 mask 不能分类")).toBe(
      "Error: An empty mask cannot be classified",
    );
  });
});
