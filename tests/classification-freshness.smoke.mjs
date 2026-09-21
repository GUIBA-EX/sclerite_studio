// 仅模拟桌面模型读取，验证真实项目的 UI 状态；原生训练/模型包由 IPC 测试另验。
import { chromium, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const base = new URL("../../../work/classifier-qa/", import.meta.url).pathname;
const browser = await chromium.launch({channel: "chrome", headless: true});
try {
  const page = await browser.newPage({viewport: {width: 1440, height: 960}});
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto("http://127.0.0.1:1420");
  await page.getByTestId("project-input").setInputFiles(base + "labeled-project.zip");
  await page.getByRole("tab", {name: "分类", exact: true}).click();
  await expect(page.locator(".class-card")).toHaveCount(13);
  await page.evaluate(async bytes => {
    const {importProject} = await import("/src/io.ts");
    const {rowsOf, categoriesOf, annotation} = await import("/src/classification.ts");
    const {datasetSignature} = await import("/src/classification-review.ts");
    const images = await importProject(new File([new Uint8Array(bytes)], "test.zip"));
    const rows = await rowsOf(images), cats = categoriesOf(images, "morphotype");
    const model = {id: "engineering-ui-only", created: Date.now()/1000, task: "morphotype", classes: cats, backend: "cpu", formal: false,
      head: {converged: true}, evaluation: {}, dataset_signature: await datasetSignature(rows, "morphotype", cats),
      samples: rows.filter(r => annotation(r, "morphotype")?.label).map(r => ({object: annotation(r, "morphotype").uuid, partition: "train"}))};
    for (const e of images) URL.revokeObjectURL(e.url);
    window.__TAURI_INTERNALS__ = {transformCallback: () => 1, invoke: async cmd => {
      if (cmd === "classifier_current") return model;
      if (cmd === "classifier_encoders") return [{id:"mobilenetv4-small",name:"MobileNetV4 · 轻量",dim:1280,available:true},{id:"dinov3-vits16",name:"DINOv3 · 通用视觉特征",dim:384,available:false}];
      if (cmd === "plugin:event|listen") return 1;
      if (cmd === "plugin:event|unlisten") return;
      throw Error("Unexpected test call: " + cmd);
    }};
    window.isTauri = true;
  }, [...await readFile(base + "labeled-project.zip")]);
  await page.locator(".class-card-select").first().click();
  await expect(page.locator(".class-freshness")).toContainText("模型与当前训练标签一致");
  await page.getByRole("button", {name: "清除选中人工标签", exact: true}).click();
  await expect(page.locator(".class-freshness")).toContainText("标签或训练数据已更新");
  await page.screenshot({path: base + "model-outdated-1440.png"});
  await page.getByRole("button", {name: "撤销标注", exact: true}).click();
  await expect(page.locator(".class-freshness")).toContainText("模型与当前训练标签一致");
  assert.deepEqual(errors, []);
  console.log("PASS model freshness UI: current → label edit → outdated → undo → current (mocked model read)");
} finally { await browser.close(); }
