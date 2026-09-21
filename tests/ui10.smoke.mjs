import { microscopyFile } from "./data-path.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, stat } from "node:fs/promises";
const out = decodeURIComponent(
  new URL("../../界面-0.10验证/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const b = (name) => page.getByRole("button", { name, exact: true });
const files = ["MR0415_Image018.jpg", "MR0415_Image026.jpg"];
try {
  await page.goto("http://127.0.0.1:1420");
  await expect(b("拖动观察")).toHaveCount(0);
  await expect(page.getByText("骨针工作台", { exact: true })).toHaveCount(0);
  await expect(page.getByText("无需账户", { exact: true })).toHaveCount(0);
  await expect(page.locator(".local-status")).toHaveCount(0);
  await page
    .getByTestId("image-input")
    .setInputFiles(files.map((f) => microscopyFile(f)));
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  await b("处理全部 2 张图像").click();
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  await page.locator(".image-item").filter({ hasText: files[0] }).click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  const cell = page.locator(".approval-cell").first();
  const cb = page.locator(".approval-checkbox").first();
  await cell.click({ position: { x: 4, y: 4 } });
  await expect(cb).toBeChecked();
  await expect(page.locator("tbody tr.selected")).toHaveCount(0);
  await cb.click();
  await expect(cb).not.toBeChecked();
  const box = await cell.boundingBox();
  await cell.click({ position: { x: box.width - 4, y: box.height - 4 } });
  await expect(cb).toBeChecked();
  await cb.focus();
  await page.keyboard.press("Space");
  await expect(cb).not.toBeChecked();
  await b("全选当前列表").click();
  await expect(page.locator("tbody tr.selected")).toHaveCount(4);
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(0);
  await expect(b("上一枚")).toHaveCount(0);
  await expect(b("下一枚")).toHaveCount(0);
  await b("取消全选").click();
  await expect(page.locator("tbody tr.selected")).toHaveCount(0);
  for (const file of files) {
    await page.locator(".image-item").filter({ hasText: file }).click();
    await b("全选当前列表").click();
    await b("确认选中").click();
    await expect(b("取消确认")).toBeVisible();
    await expect(b("确认选中")).toHaveCount(0);
  }
  console.log(
    "PASS whole-cell corners, checkbox and keyboard each toggle once; selection is separate from approval; compact batch controls",
  );
  await b("原始像素1:1").click();
  const viewer = page.locator(".viewer");
  await viewer.evaluate((el) => {
    el.scrollLeft = 200;
    el.scrollTop = 200;
  });
  const beforePan = await viewer.evaluate((el) => [
    el.scrollLeft,
    el.scrollTop,
  ]);
  const vbox = await viewer.boundingBox();
  await page.mouse.move(vbox.x + vbox.width / 2, vbox.y + vbox.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    vbox.x + vbox.width / 2 - 40,
    vbox.y + vbox.height / 2 - 30,
    { steps: 5 },
  );
  await page.mouse.up();
  const afterPan = await viewer.evaluate((el) => [el.scrollLeft, el.scrollTop]);
  assert.ok(afterPan[0] > beforePan[0] || afterPan[1] > beforePan[1]);
  await expect(page.locator(".approval-checkbox:checked")).toHaveCount(9);
  await b("适应画布").click();
  console.log("PASS direct drag still pans after removal of the pan button");
  await page.setViewportSize({ width: 1040, height: 720 });
  await b("图像列表").click();
  await b("图像列表").click();
  const alignment = await page
    .locator(".sidebar-bottom .icon-button")
    .evaluateAll((buttons) =>
      buttons.map((b) => {
        const a = b.getBoundingClientRect(),
          s = b.querySelector("svg").getBoundingClientRect();
        return [
          Math.abs(a.x + a.width / 2 - s.x - s.width / 2),
          Math.abs(a.y + a.height / 2 - s.y - s.height / 2),
        ];
      }),
    );
  assert.ok(alignment.flat().every((d) => d < 1));
  await page.screenshot({ path: out + "小窗口候选.png" });
  await page.setViewportSize({ width: 1440, height: 960 });
  await b("图版排版").click();
  await b("载入已确认对象").click();
  await expect(page.locator(".plate-modal h2")).toContainText("13 个对象");
  await b("返回测量").click();
  await page.locator(".image-item").filter({ hasText: files[0] }).click();
  await b("移除照片 " + files[1]).click();
  await expect(page.locator(".dialog")).toContainText(
    "不会删除磁盘上的原始照片",
  );
  await b("返回").click();
  await expect(page.locator(".image-item")).toHaveCount(2);
  await b("移除照片 " + files[1]).click();
  await b("确认继续").click();
  await expect(page.locator(".image-item")).toHaveCount(1);
  await expect(page.locator(".canvas-title")).toContainText(files[0]);
  await b("图版排版").click();
  await expect(page.locator(".plate-modal h2")).toContainText("4 个对象");
  await b("返回测量").click();
  await b("移除照片 " + files[0]).click();
  await b("确认继续").click();
  await expect(page.locator(".image-item")).toHaveCount(0);
  await expect(page.locator("tbody tr")).toHaveCount(0);
  await expect(page.locator(".statusbar")).toContainText("本地恢复副本已更新", {
    timeout: 20000,
  });
  await b("图版排版").click();
  await expect(page.locator(".plate-modal h2")).toContainText("0 个对象");
  await b("返回测量").click();
  await page.reload();
  await page.waitForTimeout(500);
  await expect(b("恢复工作")).toHaveCount(0);
  await expect(page.locator(".image-item")).toHaveCount(0);
  for (const file of files)
    assert.ok((await stat(microscopyFile(file))).size > 0);
  console.log(
    "PASS footer icon centers; deletion cancel/confirm, linked plate cleanup, empty recovery and original file preservation",
  );
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
