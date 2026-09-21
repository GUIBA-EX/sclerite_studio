import { microscopyFile } from "./data-path.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import JSZip from "jszip";
const out = new URL("../../MR0145-autosplit-test/", import.meta.url).pathname;
await mkdir(out + "ui", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
      viewport: { width: 1500, height: 1050 },
      acceptDownloads: true,
    }),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByTestId("image-input")
    .setInputFiles(microscopyFile("MR0415_Image026.jpg"));
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  assert.equal(
    await page.getByLabel("自动切分接触组合", { exact: true }).isChecked(),
    true,
  );
  assert.equal(
    await page.getByLabel("切分保守度", { exact: true }).inputValue(),
    "0.3",
  );
  await page.getByLabel("自动切分接触组合", { exact: true }).uncheck();
  await page.getByRole("button", { name: "运行自动分割", exact: true }).click();
  await page.locator("tbody tr").nth(5).waitFor({ timeout: 60000 });
  const baseDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "保存项目", exact: true }).click();
  await (await baseDownload).saveAs(out + "ui/browser-baseline.zip");
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  const baseline = await JSZip.loadAsync(
      await readFile(out + "ui/browser-baseline.zip"),
    ),
    bm = JSON.parse(await baseline.file("project.json").async("string")),
    bb = await baseline.file(bm.images[0].maskPath).async("uint8array"),
    bv = new DataView(bb.buffer, bb.byteOffset, bb.byteLength);
  await page.getByLabel("自动切分接触组合", { exact: true }).check();
  await page.getByRole("button", { name: "运行自动分割", exact: true }).click();
  await page.getByRole("button", { name: "确认继续", exact: true }).click();
  await page.locator("tbody tr").nth(8).waitFor({ timeout: 60000 });
  assert.equal(await page.locator("tbody tr").count(), 9);
  for (const id of [5, 10, 11, 12]) {
    const checkbox = page.getByRole("checkbox", {
      name: `确认完整 ${id}`,
      exact: true,
    });
    assert.equal(await checkbox.isChecked(), false);
    await checkbox.check();
  }
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出结果", exact: true }).click();
  const download = await dl;
  await download.saveAs(out + "ui/自动切分导出验证.zip");
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  const zip = await JSZip.loadAsync(
      await readFile(out + "ui/自动切分导出验证.zip"),
    ),
    manifest = JSON.parse(await zip.file("project.json").async("string")),
    entry = manifest.images[0];
  assert.equal(entry.splitEvents.length, 1);
  assert.equal(entry.splitEvents[0].parentId, 5);
  assert.deepEqual(entry.splitEvents[0].childIds, [5, 10, 11, 12]);
  assert.equal(entry.approvedIds.length, 4);
  for (const id of entry.approvedIds)
    assert.ok(
      zip.file(
        `images/${entry.id}/objects/${String(id).padStart(4, "0")}-cutout.png`,
      ),
    );
  const bytes = await zip.file(entry.maskPath).async("uint8array"),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let area = 0;
  const ids = new Set();
  for (let i = 0; i < bytes.length; i += 4) {
    const id = view.getUint32(i, true);
    if (id) {
      area++;
      ids.add(id);
    }
  }
  let originalArea = 0,
    mismatch = 0;
  for (let i = 0; i < bb.length; i += 4) {
    const was = bv.getUint32(i, true) === 5,
      now = view.getUint32(i, true) > 0;
    originalArea += Number(was);
    mismatch += Number(was !== now);
  }
  assert.equal(area, originalArea);
  assert.equal(mismatch, 0);
  assert.equal(ids.size, 4);
  await page.getByRole("button", { name: "图版排版", exact: true }).click();
  await page
    .getByRole("button", { name: "载入已确认对象", exact: true })
    .click();
  await page.getByTestId("plate-item").nth(3).waitFor();
  assert.equal(await page.getByTestId("plate-item").count(), 4);
  await page.screenshot({ path: out + "四枚自动切分排版.png", fullPage: true });
  await page.getByRole("button", { name: "返回测量", exact: true }).click();
  await page
    .locator("tbody tr")
    .filter({
      has: page.getByRole("checkbox", { name: "确认完整 5", exact: true }),
    })
    .locator("td")
    .first()
    .click();
  await page
    .locator("tbody tr")
    .filter({
      has: page.getByRole("checkbox", { name: "确认完整 11", exact: true }),
    })
    .locator("td")
    .first()
    .click({ modifiers: ["Shift"] });
  await page.getByRole("button", { name: "合并", exact: true }).click();
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  assert.equal(await page.locator("tbody tr").count(), 8);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 9);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  assert.equal(await page.locator("tbody tr").count(), 6);
  assert.equal(
    await page
      .getByRole("button", { name: "导出结果", exact: true })
      .isDisabled(),
    true,
  );
  await expect(page.locator(".statusbar")).toContainText("本地恢复副本已更新", {
    timeout: 20000,
  });
  await page.reload();
  await page.getByRole("button", { name: "暂不恢复", exact: true }).click();
  await page
    .getByTestId("project-input")
    .setInputFiles(out + "ui/自动切分导出验证.zip");
  await page.locator("tbody tr").nth(3).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 4);
  assert.equal(
    await page
      .getByRole("checkbox", { name: "确认完整 12", exact: true })
      .isChecked(),
    true,
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS Image026 raw image -> 4 split children; foreground conserved; 4 masks/cutouts, parent provenance, checkboxes, individual plate and project roundtrip",
  );
} finally {
  await browser.close();
}
