import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
import UTIF from "utif";

const out = new URL("../../../work/ui-check/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1500, height: 1020 },
  deviceScaleFactor: 1,
  acceptDownloads: true,
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const results = [];
const mark = (s) => {
  results.push(s);
  console.log("PASS", s);
};
const rows = () => page.locator("tbody tr");
const waitIdle = () =>
  page.locator(".processing").waitFor({ state: "hidden", timeout: 60000 });
try {
  await page.goto("http://127.0.0.1:1420");
  await page.getByRole("button", { name: /体验合成示例/ }).click();
  await waitIdle();
  await page.getByRole("button", { name: "运行自动分割", exact: true }).click();
  await waitIdle();
  const demoCount = await rows().count();
  assert.ok(demoCount > 0, `demo count=${demoCount}`);
  assert.equal(
    await page
      .getByRole("button", { name: "导出CSV", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(
    await page.getByRole("button", { name: "切开", exact: true }).isDisabled(),
    false,
  );
  mark(
    "pending candidates cannot export; touching objects can be manually cut",
  );
  mark(`synthetic demo segmentation (${demoCount} regions)`);
  await page.screenshot({
    path: new URL("../../sclerite-studio-preview.png", import.meta.url)
      .pathname,
    fullPage: true,
  });
  // 用精确几何夹具验证真实UI读图、测量、标尺和导出。
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 200;
    c.height = 120;
    const x = c.getContext("2d");
    x.fillStyle = "#eee";
    x.fillRect(0, 0, 200, 120);
    x.fillStyle = "#222";
    x.fillRect(20, 20, 40, 12);
    x.fillRect(120, 60, 20, 30);
    return c.toDataURL("image/png").split(",")[1];
  });
  await page.locator("[data-testid=image-input]").setInputFiles({
    name: "known-geometry.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await waitIdle();
  await page.getByText("高级分割参数", { exact: true }).click();
  await page.locator("input[type=range]").first().focus();
  await page.locator("input[type=range]").first().press("Home");
  await page.getByLabel("保守筛选完整候选").uncheck();
  await page.getByLabel("最小实例面积").fill("100");
  await page.getByRole("button", { name: "运行自动分割", exact: true }).click();
  await waitIdle();
  assert.equal(await rows().count(), 2);
  assert.match(await rows().first().innerText(), /480/);
  mark("known PNG: two objects, 480 and 600 px²");
  const canvas = page.locator("[data-testid=image-canvas]");
  let box = await canvas.boundingBox();
  const drag = async (x0, y0, x1, y1) => {
    box = await canvas.boundingBox();
    await page.mouse.move(
      box.x + (x0 / 200) * box.width,
      box.y + (y0 / 120) * box.height,
    );
    await page.mouse.down();
    await page.mouse.move(
      box.x + (x1 / 200) * box.width,
      box.y + (y1 / 120) * box.height,
      { steps: 12 },
    );
    await page.mouse.up();
  };
  await page.getByRole("button", { name: "校准", exact: true }).click();
  await drag(20, 100, 120, 100);
  await page.locator(".scale-entry input").fill("50");
  await page.getByRole("button", { name: "应用校准", exact: true }).click();
  assert.match(await rows().first().innerText(), /120/);
  mark("100 px line = 50 µm; measured area becomes 120 µm²");
  await rows().first().click();
  await page
    .locator('input[placeholder="spindle / club / 待确认…"]')
    .fill("spindle");
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await waitIdle();
  assert.equal(await rows().count(), 1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await rows().count(), 2);
  mark("delete and undo preserve masks");
  await page.getByRole("button", { name: "适应画布", exact: true }).click();
  await page.getByRole("button", { name: "切开", exact: true }).click();
  await drag(40, 12, 40, 40);
  await waitIdle();
  assert.equal(await rows().count(), 3);
  mark("manual cut separates touching region");
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await rows().count(), 2);
  await rows().first().click();
  await rows()
    .nth(1)
    .click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "合并", exact: true }).click();
  await waitIdle();
  assert.equal(await rows().count(), 1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await rows().count(), 2);
  mark("multi-select merge and undo");
  await rows().first().click();
  await page.getByRole("checkbox", { name: "确认完整 1", exact: true }).check();
  await page.getByRole("checkbox", { name: "确认完整 2", exact: true }).check();
  await page.getByRole("button", { name: "图版排版", exact: true }).click();
  await page
    .getByRole("button", { name: "载入已确认对象", exact: true })
    .click();
  await page.getByTestId("plate-item").nth(1).waitFor();
  await page.locator(".plate-settings > summary").click();
  await page.getByRole("button", { name: "统一倍率排版", exact: true }).click();
  await expect(page.locator(".plate-modal header")).toContainText(
    "统一倍率（基于已校准尺度）",
  );
  await expect(page.locator("[data-bar-length]")).toHaveCount(1);
  await expect(page.locator("[data-bar-length]")).toHaveAttribute(
    "data-unit",
    /μm/,
  );
  const item = page.getByTestId("plate-item").first();
  const before = await item.getAttribute("transform"),
    rect = await item.boundingBox();
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2 + 35,
    rect.y + rect.height / 2 + 25,
    { steps: 5 },
  );
  await page.mouse.up();
  assert.notEqual(await item.getAttribute("transform"), before);
  await page.getByRole("button", { name: "撤销排版", exact: true }).click();
  assert.equal(await item.getAttribute("transform"), before);
  await item.click();
  await page.getByLabel("图版标签", { exact: true }).fill("A");
  await page.getByLabel("旋转角度", { exact: true }).fill("30");
  await page.getByRole("button", { name: "缩小对象", exact: true }).click();
  await expect(page.locator(".plate-modal header")).toContainText(
    "独立缩放 · 非统一倍率",
  );
  const adjusted = await item.getAttribute("transform");
  const layoutDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存版面", exact: true }).click();
  const layoutFile = await layoutDownload,
    layoutPath = new URL("plate.json", out).pathname;
  await layoutFile.saveAs(layoutPath);
  const layout = JSON.parse(await readFile(layoutPath, "utf8"));
  assert.equal(layout.items.length, 2);
  assert.equal(layout.items[0].angle, 30);
  assert.equal(layout.items[0].label, "A");
  await page.getByRole("button", { name: "自动排版", exact: true }).click();
  await page.getByTestId("plate-input").setInputFiles(layoutPath);
  await page
    .getByText("已打开独立版面快照。原图项目的勾选状态不会随之更改。", {
      exact: true,
    })
    .waitFor();
  assert.equal(await item.getAttribute("transform"), adjusted);
  const pngDownload = page.waitForEvent("download");
  await page.getByLabel("导出图版", { exact: true }).click();
  await page.getByRole("button", { name: "导出版面PNG", exact: true }).click();
  const pngFile = await pngDownload;
  await pngFile.saveAs(new URL("plate.png", out).pathname);
  const pngBytes = await readFile(new URL("plate.png", out));
  assert.equal(pngBytes.readUInt32BE(16), 2400);
  assert.equal(pngBytes.readUInt32BE(20), 1800);
  await page.screenshot({
    path: new URL("../../sclerite-plate-preview.png", import.meta.url).pathname,
    fullPage: true,
  });
  await page.getByRole("button", { name: "返回测量", exact: true }).click();
  await page
    .getByRole("checkbox", { name: "确认完整 2", exact: true })
    .uncheck();
  mark(
    "table checkboxes; plate auto-layout, drag, undo, rotate, resize, label, JSON roundtrip and PNG export",
  );
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出CSV", exact: true }).click();
  const csvFile = await csvDownload;
  await csvFile.saveAs(new URL("measurements.csv", out).pathname);
  const csvText = await readFile(new URL("measurements.csv", out), "utf8");
  assert.ok(csvText.includes('"um"'));
  assert.ok(csvText.includes("spindle"));
  assert.ok(csvText.includes("confirmed_complete"));
  assert.equal(csvText.trim().split(/\r?\n/).length, 2);
  mark("CSV contains physical units and manual morphotype note");
  const zipDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  const archive = await zipDownload;
  const archivePath = new URL("roundtrip.zip", out).pathname;
  await archive.saveAs(archivePath);
  await waitIdle();
  const zip = await JSZip.loadAsync(await readFile(archivePath)),
    manifest = JSON.parse(await zip.file("project.json").async("string"));
  const fixture = manifest.images.find((e) => e.name === "known-geometry.png");
  assert.equal(fixture.calibration.umPerPixel, 0.5);
  assert.equal(fixture.notes["1"], "spindle");
  assert.ok(zip.file(`images/${fixture.id}/objects/0001-mask.png`));
  assert.ok(zip.file(`images/${fixture.id}/objects/0001-cutout.png`));
  assert.ok(zip.file(`images/${fixture.id}/objects/0001-crop.png`));
  assert.equal(zip.file(`images/${fixture.id}/objects/0002-crop.png`), null);
  assert.equal(manifest.exportPolicy, "confirmed-complete-only");
  assert.deepEqual(fixture.approvedIds, [1]);
  const buf = await zip.file(fixture.maskPath).async("uint8array");
  assert.equal(buf.length, 200 * 120 * 4);
  const ids = new Set(
    Array.from({ length: buf.length / 4 }, (_, i) =>
      new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(
        i * 4,
        true,
      ),
    ),
  );
  assert.deepEqual([...ids].sort(), [0, 1]);
  mark("ZIP preserves original, labels, crops, masks, scale and provenance");
  await expect(page.locator(".statusbar")).toContainText("本地恢复副本已更新", {
    timeout: 20000,
  });
  await page.reload();
  await page.getByRole("button", { name: "暂不恢复", exact: true }).click();
  await page.locator("[data-testid=project-input]").setInputFiles(archivePath);
  await waitIdle();
  await page
    .locator(".image-item")
    .filter({ hasText: "known-geometry.png" })
    .click();
  assert.equal(await rows().count(), 1);
  assert.match(await rows().first().innerText(), /120/);
  await rows().first().click();
  assert.equal(
    await page
      .locator('input[placeholder="spindle / club / 待确认…"]')
      .inputValue(),
    "spindle",
  );
  mark("saved project round-trip restores geometry, units and notes");
  const tiffData = new Uint8Array(100 * 80 * 4);
  for (let i = 0; i < 100 * 80; i++) {
    const x = i % 100,
      y = Math.floor(i / 100),
      v = x >= 15 && x < 60 && y >= 25 && y < 45 ? 30 : 230;
    tiffData[i * 4] = tiffData[i * 4 + 1] = tiffData[i * 4 + 2] = v;
    tiffData[i * 4 + 3] = 255;
  }
  const tiff = Buffer.from(UTIF.encodeImage(tiffData.buffer, 100, 80));
  await page.locator("[data-testid=image-input]").setInputFiles({
    name: "known-geometry.tif",
    mimeType: "image/tiff",
    buffer: tiff,
  });
  await waitIdle();
  await page.getByText("高级分割参数", { exact: true }).click();
  await page.getByLabel("最小实例面积").fill("100");
  await page.getByRole("button", { name: "运行自动分割", exact: true }).click();
  await waitIdle();
  assert.equal(await rows().count(), 1);
  mark("single-page TIFF import and segmentation");
  assert.deepEqual(errors, []);
  mark("no browser runtime errors");
  await writeFile(
    new URL("verification.json", out),
    JSON.stringify(
      { date: new Date().toISOString(), checks: results, errors },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
