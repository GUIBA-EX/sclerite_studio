import { chromium, expect } from "@playwright/test";
import { readFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import JSZip from "jszip";
const scratch = decodeURIComponent(
  new URL("../../../work/species-qa/", import.meta.url).pathname,
);
await mkdir(scratch, { recursive: true });
const data = await readFile(scratch + "project.zip");
const zip = await JSZip.loadAsync(data),
  m = JSON.parse(await zip.file("project.json").async("string"));
// Artificial calibration is a software fixture, not inferred calibration of these photographs.
for (const [i, e] of m.images.entries())
  e.calibration = {
    start: { x: 0, y: 0 },
    end: { x: 100, y: 0 },
    distanceUm: 50 * (i + 1),
    umPerPixel: 0.5 * (i + 1),
  };
zip.file("project.json", JSON.stringify(m));
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
  });
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByTestId("project-input")
    .setInputFiles({
      name: "qa-calibrated.zip",
      mimeType: "application/zip",
      buffer: await zip.generateAsync({ type: "nodebuffer" }),
    });
  await expect(page.locator(".image-item")).toHaveCount(2);
  await page.getByRole("button", { name: "物种界定", exact: true }).click();
  await page.getByRole("button", { name: "形态比较", exact: true }).click();
  await expect(page.locator(".study-table-wrap tbody")).toContainText(
    "13 / 13",
  );
  await expect(page.locator(".study-scatter circle")).toHaveCount(1);
  await expect(page.locator(".study-table-wrap tbody")).toContainText("图中 1");
  await page.screenshot({
    path: scratch + "calibrated-comparison-fixture.png",
  });
  await page.getByRole("button", { name: "标本信息", exact: true }).click();
  await page.getByLabel("纳入研究（取消仅排除此图，不删除照片）").uncheck();
  await page.getByRole("button", { name: "形态比较", exact: true }).click();
  await expect(page.locator(".study-table-wrap tbody")).toContainText("9 / 9");
  console.log(
    "PASS calibrated plot / quartile table and per-image exclusion (artificial QA metadata only)",
  );
  const legacy = await JSZip.loadAsync(data),
    old = JSON.parse(await legacy.file("project.json").async("string"));
  old.version = "0.7.0";
  old.images.forEach((e) => {
    delete e.study;
    delete e.sourceHash;
  });
  legacy.file("project.json", JSON.stringify(old));
  const second = await browser.newContext();
  const p = await second.newPage();
  await p.goto("http://127.0.0.1:1420");
  await p
    .getByTestId("project-input")
    .setInputFiles({
      name: "qa-legacy.zip",
      mimeType: "application/zip",
      buffer: await legacy.generateAsync({ type: "nodebuffer" }),
    });
  await expect(p.locator(".image-item")).toHaveCount(2);
  await p.getByRole("button", { name: "物种界定", exact: true }).click();
  await p.getByRole("button", { name: "形态比较", exact: true }).click();
  await expect(p.locator(".study-table-wrap tbody")).toContainText("13 / 0");
  await expect(p.locator(".study-table-wrap tbody")).toContainText(
    "来源未指定",
  );
  await p.getByRole("button", { name: "标本信息", exact: true }).click();
  await expect(
    p.getByLabel("候选分组（人工假说）", { exact: true }),
  ).toHaveValue("");
  assert.deepEqual(errors, []);
  console.log(
    "PASS legacy 0.7 project: confirmations retained, missing study data stays unknown",
  );
} finally {
  await browser.close();
}
