import { microscopyFile } from "./data-path.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
const out = decodeURIComponent(
  new URL("../../界面-0.9验证/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1500, height: 1000 },
  acceptDownloads: true,
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const b = (name) => page.getByRole("button", { name, exact: true });
async function download(name, file) {
  if (name.startsWith("导出") && !(await b(name).isVisible()))
    await page.getByLabel("导出图版", { exact: true }).click();
  const promise = page.waitForEvent("download");
  await b(name).click();
  await (await promise).saveAs(out + file);
  return readFile(out + file);
}
try {
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByTestId("image-input")
    .setInputFiles(microscopyFile("MR0415_Image018.jpg"));
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  await b("运行自动分割").click();
  const rows = page.locator("tbody tr");
  await expect(rows).toHaveCount(4, { timeout: 60000 });
  await rows.nth(0).click();
  await rows.nth(1).click({ modifiers: ["Meta"] });
  await expect(page.locator("tbody tr.selected")).toHaveCount(2);
  await rows.nth(0).click({ modifiers: ["Meta"] });
  await expect(page.locator("tbody tr.selected")).toHaveCount(1);
  // macOS reserves physical Ctrl-click for its context menu; exercise the Windows click event separately.
  await rows.nth(2).dispatchEvent("click", { ctrlKey: true });
  await expect(page.locator("tbody tr.selected")).toHaveCount(2);
  await b("确认选中").click();
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(2);
  await b("取消确认").click();
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(0);
  await rows.nth(0).focus();
  await page.keyboard.press("Meta+a");
  await expect(page.locator("tbody tr.selected")).toHaveCount(4);
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(0);
  await b("取消选择").click();
  await b("全选当前列表").click();
  await b("确认选中").click();
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(4);
  console.log(
    "PASS real image: Cmd/Ctrl toggle, keyboard/button select all, explicit batch approval/unapproval",
  );
  await b("撤销").click();
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(0);
  await b("重做").click();
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(4);
  await b("全选当前列表").click();
  await page.setViewportSize({ width: 1040, height: 720 });
  const sizeHandle = page.getByRole("separator", { name: "调整照片栏宽度" });
  await sizeHandle.focus();
  await page.keyboard.press("ArrowRight");
  assert.equal(
    await page.locator(".sidebar").evaluate((el) => el.clientWidth),
    220,
  );
  await b("图像列表").click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await b("图像列表").click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await b("处理设置").click();
  await expect(page.locator(".inspector")).toBeHidden();
  await b("测量表").click();
  await expect(page.locator(".table-scroll")).toBeHidden();
  await page.screenshot({ path: out + "面板收起.png" });
  await b("处理设置").click();
  await b("测量表").click();
  await page.screenshot({ path: out + "小窗口测量.png" });
  await page.setViewportSize({ width: 1500, height: 1000 });
  await b("原始像素1:1").click();
  assert.ok(
    Math.abs(
      (await page.getByTestId("image-canvas").boundingBox()).width - 2560,
    ) < 1,
  );
  await b("适应画布").click();
  const overlay = await page
    .getByTestId("image-canvas")
    .evaluate((c) => c.toDataURL());
  const eye = await b("临时查看原图").boundingBox();
  await page.mouse.move(eye.x + 10, eye.y + 10);
  await page.mouse.down();
  await page.waitForTimeout(80);
  assert.notEqual(
    await page.getByTestId("image-canvas").evaluate((c) => c.toDataURL()),
    overlay,
  );
  await page.mouse.up();
  await page.waitForTimeout(80);
  assert.equal(
    await page.getByTestId("image-canvas").evaluate((c) => c.toDataURL()),
    overlay,
  );
  console.log(
    "PASS panel collapse/restore, sidebar width, review undo/redo, true pixel 1:1 and original peek",
  );
  await b("拖动观察").click();
  for (let i = 0; i < 8; i++) await b("放大").click();
  const viewer = page.locator(".viewer");
  await viewer.evaluate((el) => {
    el.scrollLeft = 150;
    el.scrollTop = 150;
  });
  const before = await viewer.evaluate((el) => [el.scrollLeft, el.scrollTop]);
  const box = await viewer.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 - 50,
    box.y + box.height / 2 - 40,
    { steps: 5 },
  );
  await page.mouse.up();
  const after = await viewer.evaluate((el) => [el.scrollLeft, el.scrollTop]);
  assert.ok(after[0] > before[0] || after[1] > before[1]);
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(4);
  await expect(page.locator("tbody tr.selected")).toHaveCount(4);
  console.log(
    "PASS pan changes viewport without changing approval or selection",
  );
  await b("图版排版").click();
  await b("载入已确认对象").click();
  const items = page.getByTestId("plate-item");
  await expect(items).toHaveCount(4);
  const selected = page.locator(
    '[data-testid="plate-item"] rect[stroke="#07977c"]',
  );
  await items.nth(0).click();
  await items.nth(1).click({ modifiers: ["Meta"] });
  await expect(selected).toHaveCount(2);
  await items.nth(1).click({ modifiers: ["Meta"] });
  await expect(selected).toHaveCount(1);
  await items.nth(2).dispatchEvent("pointerdown", { ctrlKey: true });
  await expect(selected).toHaveCount(2);
  await page.getByTestId("plate-canvas").focus();
  await page.keyboard.press("Control+a");
  await expect(selected).toHaveCount(4);
  await page.keyboard.press("Escape");
  await expect(selected).toHaveCount(0);
  await b("全选本页").click();
  await expect(selected).toHaveCount(4);
  await expect(page.getByLabel("角度数值", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "批量操作 · 4 枚" }),
  ).toBeVisible();
  if (!(await page.getByLabel("网格吸附", { exact: true }).isVisible()))
    await page.locator(".plate-settings > summary").click();
  await page.getByLabel("网格吸附", { exact: true }).uncheck();
  const positions = await items.evaluateAll((els) =>
    els.map((el) => el.getAttribute("transform")),
  );
  const ib = await items.nth(0).boundingBox();
  await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2);
  await page.mouse.down();
  await page.mouse.move(ib.x + ib.width / 2 + 15, ib.y + ib.height / 2 + 15, {
    steps: 5,
  });
  await page.mouse.up();
  const moved = await items.evaluateAll((els) =>
    els.map((el) => el.getAttribute("transform")),
  );
  assert.ok(moved.every((p, i) => p !== positions[i]));
  console.log(
    "PASS plate Cmd/Ctrl selection, scoped select all, deselect, group dragging",
  );
  await b("撤销排版").click();
  assert.deepEqual(
    await items.evaluateAll((els) =>
      els.map((el) => el.getAttribute("transform")),
    ),
    positions,
  );
  await b("重做排版").click();
  assert.deepEqual(
    await items.evaluateAll((els) =>
      els.map((el) => el.getAttribute("transform")),
    ),
    moved,
  );
  await b("页面缩略图").click();
  await expect(
    page.getByRole("navigation", { name: "图版页面" }),
  ).toBeVisible();
  await b("放大画布").click();
  await expect(page.locator(".plate-paper-wrap")).toHaveClass(/zoomed/);
  await b("适应版面").click();
  await b("页面缩略图").click();
  await b("排版属性").click();
  await expect(page.locator(".plate-inspector")).toBeHidden();
  await b("排版属性").click();
  await items.nth(0).click({ modifiers: ["Meta"] });
  await page.getByTestId("plate-canvas").focus();
  await page.keyboard.press("Escape");
  const canvasBox = await page.getByTestId("plate-background").boundingBox();
  await page.mouse.move(canvasBox.x + 4, canvasBox.y + canvasBox.height - 5);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + canvasBox.width - 5, canvasBox.y + 5, {
    steps: 8,
  });
  await page.mouse.up();
  await expect(selected).toHaveCount(4);
  await page.keyboard.press("Escape");
  await items.nth(0).click();
  const firstAngle = Number(await items.nth(0).getAttribute("data-angle"));
  const handle = await page.getByTestId("rotation-handle").boundingBox();
  await page.mouse.move(
    handle.x + handle.width / 2,
    handle.y + handle.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(handle.x + 70, handle.y + 60, { steps: 8 });
  await page.mouse.up();
  assert.notEqual(
    Number(await items.nth(0).getAttribute("data-angle")),
    firstAngle,
  );
  await b("撤销排版").click();
  assert.equal(
    Number(await items.nth(0).getAttribute("data-angle")),
    firstAngle,
  );
  const slider = page.getByLabel("旋转角度", { exact: true });
  await slider.scrollIntoViewIfNeeded();
  const sliderBox = await slider.boundingBox();
  const thumbX = sliderBox.x + sliderBox.width * (firstAngle + 180) / 360;
  await page.mouse.move(thumbX, sliderBox.y + sliderBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sliderBox.x + sliderBox.width * 0.8, sliderBox.y + sliderBox.height / 2, { steps: 10 });
  await page.mouse.up();
  assert.notEqual(Number(await items.nth(0).getAttribute("data-angle")), firstAngle);
  await b("撤销排版").click();
  assert.equal(Number(await items.nth(0).getAttribute("data-angle")), firstAngle);
  console.log("PASS multi-selection context, marquee, rotation handle, plate redo, view zoom and single-step slider undo");
  if (!(await page.getByLabel("显示来源注释", { exact: true }).isVisible()))
    await page.locator(".plate-settings > summary").click();
  await page.getByLabel("显示来源注释", { exact: true }).uncheck();
  await expect(page.getByTestId("source-notes")).toHaveCount(0);
  const saved = JSON.parse(await download("保存版面", "隐藏来源版面.json"));
  assert.equal(saved.settings.showSourceNotes, false);
  assert.ok(saved.items.every((i) => i.sourceName === "MR0415_Image018.jpg"));
  const png = await download("导出版面PNG", "隐藏来源版面.png");
  const clean = await page.evaluate(
    async (data) => {
      const img = new Image();
      img.src = data;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(64, 1595, 2200, 40).data.every((v) => v === 255);
    },
    "data:image/png;base64," + png.toString("base64"),
  );
  assert.ok(clean, "export source-note area must be blank");
  await page.getByLabel("显示来源注释", { exact: true }).check();
  await page
    .getByTestId("plate-input")
    .setInputFiles(out + "隐藏来源版面.json");
  await expect(
    page.getByLabel("显示来源注释", { exact: true }),
  ).not.toBeChecked();
  console.log(
    "PASS source notes hidden in preview and exported PNG; source metadata and saved preference preserved",
  );
  if (await page.getByLabel("显示来源注释", { exact: true }).isVisible())
    await page.locator(".plate-settings > summary").click();
  await page.screenshot({ path: out + "排版对象属性.png" });
  await b("全选本页").click();
  await page.screenshot({ path: out + "排版多选.png" });
  await page.setViewportSize({ width: 1040, height: 720 });
  await page.screenshot({ path: out + "小窗口排版.png" });
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
