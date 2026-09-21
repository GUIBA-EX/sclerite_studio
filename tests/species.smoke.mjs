import { microscopyFile } from "./data-path.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import JSZip from "jszip";
const scratch = decodeURIComponent(
  new URL("../../../work/species-qa/", import.meta.url).pathname,
);
const output = decodeURIComponent(
  new URL("../../物种研究-0.11验证/", import.meta.url).pathname,
);
await mkdir(scratch, { recursive: true });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const b = (name) => page.getByRole("button", { name, exact: true });
const idle = () =>
  page.locator(".processing").waitFor({ state: "hidden", timeout: 60000 });
const files = ["MR0415_Image018.jpg", "MR0415_Image026.jpg"];
async function download(button, name) {
  const pending = page.waitForEvent("download");
  await button.click();
  const d = await pending;
  const path = scratch + name;
  await d.saveAs(path);
  return path;
}
try {
  await page.goto("http://127.0.0.1:1420");
  await b("物种界定").click();
  await expect(
    page.getByRole("heading", { name: /物种界定研究/ }),
  ).toBeVisible();
  await page.screenshot({ path: output + "技术路线.png" });
  await b("验证与导出").click();
  await expect(page.locator(".study-issues")).toContainText(
    "没有纳入研究的真实图像",
  );
  await b("返回图像").click();
  await page
    .getByTestId("image-input")
    .setInputFiles(files.map((f) => microscopyFile(f)));
  await idle();
  await b("处理全部 2 张图像").click();
  await idle();
  for (const file of files) {
    await page.locator(".image-item").filter({ hasText: file }).click();
    await b("全选当前列表").click();
    await b("确认选中").click();
  }
  await b("物种界定").click();
  await b("标本信息").click();
  for (const file of files) {
    await page
      .locator(".study-image-list button")
      .filter({ hasText: file })
      .click();
    await page.getByLabel("研究标本编号", { exact: true }).fill("QA-SPECIMEN");
    await page.getByLabel("母群体编号", { exact: true }).fill("QA-COLONY");
    await page.getByLabel("研究组织区域", { exact: true }).fill("QA-TISSUE");
    await page
      .getByLabel("图像来源", { exact: true })
      .selectOption("microscopy");
    await page
      .getByLabel("取样方式", { exact: true })
      .selectOption("systematic");
    await page.getByLabel("成像 / 制片批次", { exact: true }).fill("QA-BATCH");
    await page
      .getByLabel("候选分组（人工假说）", { exact: true })
      .fill("QA-H1");
    await page
      .getByLabel("分子谱系（外部结果记录）", { exact: true })
      .fill("QA-LINEAGE");
    await page
      .getByLabel("证据与冲突记录", { exact: true })
      .fill("软件测试元数据，并非这些照片的真实生物学记录。");
  }
  await b("形态比较").click();
  await expect(page.locator(".study-table-wrap tbody tr")).toHaveCount(1);
  await expect(page.locator(".study-table-wrap tbody")).toContainText("13 / 0");
  await expect(page.locator(".study-empty")).toContainText("没有已校准");
  await b("验证与导出").click();
  await expect(page.locator(".study-table-wrap tbody tr")).toHaveCount(1);
  await page.getByLabel("关联组 1 用途").selectOption("train");
  await expect(page.locator(".study-issues")).not.toContainText("未分配");
  const studyPath = await download(b("导出研究资料").last(), "study.zip");
  const studyZip = await JSZip.loadAsync(await readFile(studyPath));
  assert.equal(studyZip.file("split-manifest.csv"), null);
  const audit = JSON.parse(await studyZip.file("audit.json").async("string"));
  assert.equal(audit.canExportSplit, false);
  assert.equal(audit.groups.length, 1);
  assert.equal(
    (await studyZip.file("confirmed-observations.csv").async("string"))
      .trim()
      .split("\r\n").length,
    14,
  );
  assert.ok(
    (await studyZip.file("image-metadata.csv").async("string")).includes(
      "QA-LINEAGE",
    ),
  );
  console.log(
    "PASS real images: 13 confirmed objects / 1 specimen, uncalibrated size gate, connected-group assignment and blocked split export",
  );
  const savedPath = await download(b("保存项目与研究信息"), "project.zip");
  const project = await JSZip.loadAsync(await readFile(savedPath));
  const manifest = JSON.parse(
    await project.file("project.json").async("string"),
  );
  assert.equal(manifest.version, "0.11.0");
  assert.equal(manifest.images.length, 2);
  assert.ok(
    manifest.images.every(
      (e) =>
        e.study.partition === "train" &&
        e.study.hypothesis === "QA-H1" &&
        /^[a-f0-9]{64}$/.test(e.sourceHash),
    ),
  );
  // Recovery must retain metadata too. Await actual IndexedDB write, not a fixed sleep.
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const { readRecovery } = await import("/src/recovery.ts");
          const r = await readRecovery();
          return (
            r?.images?.length === 2 &&
            r.images.every((e) => e.study?.partition === "train")
          );
        }),
      { timeout: 20000 },
    )
    .toBe(true);
  await page.reload();
  await b("恢复工作").click();
  await idle();
  await b("物种界定").click();
  await b("标本信息").click();
  await expect(page.getByLabel("研究标本编号", { exact: true })).toHaveValue(
    "QA-SPECIMEN",
  );
  console.log("PASS autosave/recovery metadata retention");
  await b("返回图像").click();
  // Open same saved project; immutable original hashes must identify remapped image IDs as duplicates.
  await page.getByTestId("project-input").setInputFiles(savedPath);
  await idle();
  await b("物种界定").click();
  await b("形态比较").click();
  await expect(page.locator(".study-table-wrap tbody")).toContainText("13 / 0");
  await b("验证与导出").click();
  await expect(page.locator(".study-issues")).toContainText(
    "完全相同的原图重复导入",
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS project round trip, confirmation retention, hash-based duplicate rejection after ID remapping",
  );
  await page.setViewportSize({ width: 1040, height: 720 });
  await b("技术路线").click();
  assert.equal(
    await page
      .locator(".study-modal")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
    false,
  );
  await page.screenshot({ path: output + "小窗口-技术路线.png" });
  await b("标本信息").click();
  assert.equal(
    await page
      .locator(".study-modal")
      .evaluate((e) => e.scrollWidth > e.clientWidth),
    false,
  );
  await page.keyboard.press("Escape");
  await expect(page.locator(".study-modal")).toHaveCount(0);
  await b("物种界定").click();
  await page.keyboard.press("Tab");
  assert.equal(
    await page.evaluate(() => !!document.activeElement.closest(".study-modal")),
    true,
  );
  console.log(
    "PASS 1040px layout, Escape, focus containment, no browser errors",
  );
} catch (error) {
  await page.screenshot({ path: scratch + "failure.png" });
  throw error;
} finally {
  await browser.close();
}
