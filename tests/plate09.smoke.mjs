import { microscopyFile } from "./data-path.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
const out = decodeURIComponent(
  new URL("../../界面-0.9验证/联合排版/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  acceptDownloads: true,
});
page.on("dialog", (d) => d.accept());
const errors = [],
  checks = [];
page.on("pageerror", (e) => errors.push(e.message));
const b = (name) => page.getByRole("button", { name, exact: true });
const mark = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
async function download(name, file) {
  if (name.startsWith("导出") && !await b(name).isVisible()) await page.getByLabel("导出图版", { exact: true }).click();
  const d = page.waitForEvent("download");
  await b(name).click();
  await (await d).saveAs(out + file);
  return readFile(out + file);
}
try {
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByTestId("image-input")
    .setInputFiles([
      microscopyFile("MR0415_Image018.jpg"),
      microscopyFile("MR0415_Image026.jpg"),
    ]);
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  await b("处理全部 2 张图像").click();
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  for (const filename of ["MR0415_Image018.jpg", "MR0415_Image026.jpg"]) {
    await page.locator(".image-item").filter({ hasText: filename }).click();
    for (const cb of await page.locator(".approval-checkbox").all())
      await cb.check();
  }
  await b("图版排版").click();
  await b("载入已确认对象").click();
  await expect(page.getByTestId("plate-item").first()).toBeVisible();
  const original = JSON.parse(
    await download("保存版面", "两张真实照片联合版面.json"),
  );
  assert.equal(original.items.length, 13);
  assert.equal(new Set(original.items.map((i) => i.sourceId)).size, 2);
  const pages = [...new Set(original.items.map((i) => i.page))];
  assert.ok(pages.length >= 2);
  const scale = original.items[0].width / original.items[0].sourceWidth;
  assert.ok(scale <= 0.5);
  for (const i of original.items)
    assert.ok(Math.abs(i.width / i.sourceWidth - scale) < 1e-8);
  assert.ok(original.items.some((i) => i.label.startsWith("A-")));
  assert.ok(original.items.some((i) => i.label.startsWith("B-")));
  mark("两张真实照片13枚骨针联合排版，保留共同原像素比例、来源编号且自动分页");
  for (const p of pages) {
    await page.getByLabel("排版页码", { exact: true }).selectOption(String(p));
    await expect(page.getByTestId("plate-item")).toHaveCount(
      original.items.filter((i) => i.page === p).length,
    );
    await expect(page.locator("[data-bar-length]")).toHaveCount(1);
    assert.ok(
      (
        await page.locator("[data-bar-length]").getAttribute("data-unit")
      ).includes("px"),
    );
    await page.screenshot({
      path: out + `联合排版-第${p}页.png`,
      fullPage: true,
    });
  }
  const zip = await JSZip.loadAsync(
    await download("导出全部页", "联合排版-全部页.zip"),
  );
  assert.equal(
    Object.keys(zip.files).filter((n) => n.endsWith(".png")).length,
    pages.length,
  );
  const provenance = JSON.parse(await zip.file("sources.json").async("string"));
  assert.equal(provenance.objects.length, 13);
  for (const p of provenance.pages) {
    assert.ok(p.bars[0].label.includes("px"));
    assert.ok(
      Math.abs(p.bars[0].length / parseFloat(p.bars[0].label) - scale) < 1e-8,
    );
  }
  mark("逐页预览无漏对象；全部页PNG与完整来源/标尺记录导出，未校准不出现μm");
  await page.getByLabel("排版页码", { exact: true }).selectOption("1");
  await page.getByTestId("plate-item").first().click();
  await b("缩小对象").click();
  const count = original.items.filter((i) => i.page === 1).length;
  await expect(page.locator("[data-bar-length]")).toHaveCount(count);
  const resized = JSON.parse(await download("保存版面", "单枚缩放后.json"));
  const bars = await page
    .locator("[data-bar-length]")
    .evaluateAll((nodes) =>
      nodes.map((n) => ({
        label: n.getAttribute("data-unit"),
        length: Number(n.getAttribute("data-bar-length")),
      })),
    );
  const current = resized.items.filter((i) => i.page === 1);
  for (let n = 0; n < bars.length; n++)
    assert.ok(
      Math.abs(
        bars[n].length / parseFloat(bars[n].label) -
          current[n].width / current[n].sourceWidth,
      ) < 1e-8,
    );
  await page.locator(".plate-settings > summary").click();
  await page.getByLabel("显示比例尺", { exact: true }).uncheck();
  await expect(page.locator("[data-bar-length]")).toHaveCount(0);
  await page.getByLabel("显示比例尺", { exact: true }).check();
  await b("自动排版").click();
  await expect(page.locator("[data-bar-length]")).toHaveCount(1);
  mark("单枚缩放自动改为各自标尺，数值随实际倍率更新；可开关标尺和恢复原比例");
  await page.getByText("选择参与照片（仅已确认对象）", { exact: true }).click();
  await page
    .locator(".plate-source-list label")
    .filter({ hasText: "MR0415_Image026.jpg" })
    .locator("input")
    .uncheck();
  await b("重新载入已确认对象").click();
  const subset = JSON.parse(await download("保存版面", "选择单张照片.json"));
  assert.equal(subset.items.length, 4);
  await b("撤销排版").click();
  await page.getByLabel("按照片分组", { exact: true }).uncheck();
  await b("自动排版").click();
  const compact = JSON.parse(await download("保存版面", "紧凑混排.json"));
  assert.equal(compact.items.length, 13);
  assert.equal(compact.settings.groupBySource, false);
  for (const i of compact.items)
    assert.ok(Math.abs(i.width / i.sourceWidth - scale) < 1e-8);
  mark("可选参与照片、按来源分组或紧凑混排，均不单独缩放骨针");
  await b("返回测量").click();
  await download("保存项目（含版面）", "联合排版项目.zip");
  await expect(page.locator(".statusbar")).toContainText("本地恢复副本已更新", {
    timeout: 20000,
  });
  await page.reload();
  await b("恢复工作").click();
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  await b("图版排版").click();
  await expect(
    page.getByLabel("按照片分组", { exact: true }),
  ).not.toBeChecked();
  const recovered = JSON.parse(await download("保存版面", "重启恢复.json"));
  assert.deepEqual(recovered.items, compact.items);
  const p2 = await browser.newPage({ viewport: { width: 1040, height: 720 } });
  p2.on("pageerror", (e) => errors.push(e.message));
  p2.on("dialog", (d) => d.accept());
  await p2.goto("http://127.0.0.1:1420");
  await p2.getByTestId("project-input").setInputFiles(out + "联合排版项目.zip");
  await expect(p2.locator(".image-item")).toHaveCount(2, { timeout: 60000 });
  await p2.getByRole("button", { name: "图版排版", exact: true }).click();
  await expect(p2.getByLabel("按照片分组", { exact: true })).not.toBeChecked();
  await expect(p2.getByLabel("显示比例尺", { exact: true })).toBeChecked();
  await p2.screenshot({ path: out + "小窗口联合排版.png", fullPage: true });
  mark("项目及重启恢复保留分页、对象尺寸、分组和标尺设置；小窗口可打开");
  assert.deepEqual(errors, []);
  await writeFile(
    out + "verification.json",
    JSON.stringify({ date: new Date().toISOString(), checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
