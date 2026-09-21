import { microscopyFile } from "./data-path.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
const out = decodeURIComponent(
  new URL("../../UI-0.5验证/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
const page = await context.newPage(),
  checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const button = (name) => page.getByRole("button", { name, exact: true });
const mark = (name) => {
  checks.push(name);
  console.log("PASS", name);
};
const idle = () =>
  page.locator(".processing").waitFor({ state: "hidden", timeout: 60000 });
const save = async (filename) => {
  const promise = page.waitForEvent("download");
  await button("保存项目（含版面）").click();
  await (await promise).saveAs(out + filename);
  await idle();
  return JSZip.loadAsync(await readFile(out + filename));
};
try {
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByTestId("image-input")
    .setInputFiles(microscopyFile("MR0415_Image026.jpg"));
  await idle();
  await button("运行自动分割").click();
  await idle();
  await expect(page.locator("tbody tr")).toHaveCount(9);
  await expect(page.locator(".run-dock")).toContainText(
    "当前参数与分割结果一致",
  );
  await expect(
    page.getByLabel("最小内核比例", { exact: true }),
  ).not.toBeVisible();
  mark("真实Image026分割9候选；高级参数默认折叠；运行按钮常驻");
  const initialViewer = await page.locator(".viewer").boundingBox();
  await button("图像列表").click();
  await button("处理设置").click();
  const expandedViewer = await page.locator(".viewer").boundingBox();
  assert.ok(expandedViewer.width > initialViewer.width + 400);
  await button("图像列表").click();
  await button("处理设置").click();
  const sep = page.getByRole("separator"),
    sb = await sep.boundingBox();
  const heightBefore = (await page.locator(".table-scroll").boundingBox())
    .height;
  await page.mouse.move(sb.x + sb.width / 2, sb.y + 4);
  await page.mouse.down();
  await page.mouse.move(sb.x + sb.width / 2, sb.y - 40);
  await page.mouse.up();
  assert.ok(
    (await page.locator(".table-scroll").boundingBox()).height > heightBefore,
  );
  mark("左右面板折叠扩大画布；拖动调整测量表");
  await page.locator('[data-object-id="5"] td').first().click();
  await expect(page.locator(".split-review")).toBeVisible();
  await expect(page.locator(".split-review canvas")).toHaveCount(2);
  await page.screenshot({ path: out + "工作台-切分复核.png", fullPage: true });
  await page.keyboard.press("Space");
  await expect(
    page.getByRole("checkbox", { name: "确认完整 5", exact: true }),
  ).toBeChecked();
  assert.ok(
    !(await page.locator('[data-object-id="5"]').innerText()).includes(
      "待复核",
    ),
  );
  await page.getByLabel("筛选复核状态").selectOption("pending");
  await expect(page.locator("tbody tr")).toHaveCount(8);
  await page.getByLabel("筛选复核状态").selectOption("split");
  await expect(page.locator("tbody tr")).toHaveCount(4);
  for (const id of [10, 11, 12])
    await page
      .getByRole("checkbox", { name: `确认完整 ${id}`, exact: true })
      .check();
  mark("缩略图选中定位；空格确认并下一枚；筛选；来源与确认状态无矛盾");
  await page.getByLabel("切分保守度", { exact: true }).fill("0.35");
  await expect(page.locator(".run-dock")).toContainText("结果尚未更新");
  await page.getByLabel("切分保守度", { exact: true }).fill("0.3");
  await expect(page.locator(".run-dock")).toContainText(
    "当前参数与分割结果一致",
  );
  mark("参数变更与撤回能够准确显示结果是否过期");
  await page.getByLabel("筛选复核状态").selectOption("all");
  const baseline = await save("切分前快照.zip");
  await page.locator('[data-object-id="5"] td').first().click();
  await button("撤销本组切分").click();
  await expect(page.locator("tbody tr")).toHaveCount(6);
  const merged = await save("撤销组快照.zip");
  const bm = JSON.parse(await baseline.file("project.json").async("string"));
  const mm = JSON.parse(await merged.file("project.json").async("string"));
  const bbytes = await baseline.file(bm.images[0].maskPath).async("uint8array");
  const mbytes = await merged.file(mm.images[0].maskPath).async("uint8array");
  const bv = new DataView(bbytes.buffer, bbytes.byteOffset, bbytes.byteLength),
    mv = new DataView(mbytes.buffer, mbytes.byteOffset, mbytes.byteLength);
  for (let i = 0; i < bbytes.length; i += 4)
    assert.equal(
      Boolean(bv.getUint32(i, true)),
      Boolean(mv.getUint32(i, true)),
    );
  assert.equal(mm.images[0].splitEvents.length, 0);
  assert.equal(mm.images[0].approvedIds.length, 0);
  await button("撤销").click();
  await expect(page.locator("tbody tr")).toHaveCount(9);
  await expect(
    page.getByRole("checkbox", { name: "确认完整 12", exact: true }),
  ).toBeChecked();
  mark("撤销单组切分保留全部前景像素；撤销操作恢复4枚与原勾选状态");
  await button("图版排版").click();
  await button("载入已确认对象").click();
  await expect(page.getByTestId("plate-item")).toHaveCount(4);
  await expect(button("统一倍率排版")).toBeDisabled();
  const items = page.getByTestId("plate-item");
  await items.nth(0).click();
  await items.nth(1).click({ modifiers: ["Shift"] });
  await items.nth(2).click({ modifiers: ["Shift"] });
  await expect(button("横向等距")).toBeEnabled();
  await button("水平对齐").click();
  await button("横向等距").click();
  await items.nth(0).click();
  const prior = await items.nth(0).getAttribute("transform");
  await page.keyboard.press("ArrowRight");
  assert.notEqual(await items.nth(0).getAttribute("transform"), prior);
  await page.getByLabel("图版标签", { exact: true }).fill("A");
  await page.screenshot({ path: out + "排版-多选对齐.png", fullPage: true });
  await button("返回测量").click();
  const project = await save("含排版项目.zip");
  const plate = JSON.parse(await project.file("plate.json").async("string"));
  assert.equal(plate.items.length, 4);
  assert.equal(plate.items[0].label, "A");
  mark("排版多选、对齐、等距、键盘微调；未校准禁止统一倍率；项目含可编辑版面");
  await expect(page.locator(".statusbar")).toContainText("本地恢复副本已更新", {
    timeout: 15000,
  });
  await page.reload();
  await button("恢复工作").click();
  await idle();
  await expect(page.locator("tbody tr")).toHaveCount(9);
  await expect(
    page.getByRole("checkbox", { name: "确认完整 12", exact: true }),
  ).toBeChecked();
  await button("图版排版").click();
  await expect(page.getByTestId("plate-item")).toHaveCount(4);
  assert.equal(
    await page.getByTestId("plate-item").first().locator("text").textContent(),
    "A",
  );
  await button("返回测量").click();
  await page
    .getByRole("checkbox", { name: "确认完整 12", exact: true })
    .uncheck();
  await button("图版排版").click();
  await expect(page.locator(".plate-stale")).toBeVisible();
  await button("返回测量").click();
  mark("重启后恢复原图、mask、确认和布局；取消确认时旧版面明确警告");
  const context2 = await browser.newContext({
    viewport: { width: 1040, height: 720 },
    acceptDownloads: true,
  });
  const p2 = await context2.newPage();
  p2.on("dialog", (d) => d.accept());
  p2.on("pageerror", (e) => errors.push(e.message));
  await p2.goto("http://127.0.0.1:1420");
  await p2.getByTestId("project-input").setInputFiles(out + "含排版项目.zip");
  await expect(p2.locator("tbody tr")).toHaveCount(9, { timeout: 60000 });
  await p2.getByRole("button", { name: "图版排版", exact: true }).click();
  await expect(p2.getByTestId("plate-item")).toHaveCount(4);
  await expect(p2.locator(".plate-stale")).not.toBeVisible();
  await p2.getByRole("button", { name: "返回测量", exact: true }).click();
  const run = await p2
    .getByRole("button", { name: "运行自动分割", exact: true })
    .boundingBox();
  assert.ok(run.y + run.height <= 720);
  await p2.screenshot({ path: out + "小窗口-1040x720.png", fullPage: true });
  mark("独立空工作台打开项目恢复版面；1040×720最小窗口运行按钮可见");
  assert.deepEqual(errors, []);
  await writeFile(
    out + "verification.json",
    JSON.stringify({ date: new Date().toISOString(), checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
