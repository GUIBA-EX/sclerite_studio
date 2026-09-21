import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const root = new URL("../../", import.meta.url).pathname;
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1500, height: 1020 },
    acceptDownloads: true,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByTestId("project-input")
    .setInputFiles(root + "MR0145-touching-test/Image026-待复核.zip");
  await page.locator("tbody tr").nth(5).waitFor();
  assert.equal(await page.locator("tbody tr").count(), 6);
  assert.equal(
    await page
      .getByRole("checkbox", { name: "确认完整 5", exact: true })
      .isChecked(),
    false,
  );
  assert.match(
    await page
      .locator("tbody tr")
      .filter({
        has: page.getByRole("checkbox", { name: "确认完整 5", exact: true }),
      })
      .innerText(),
    /接触待复核/,
  );
  await page.screenshot({
    path: root + "MR0145-touching-test/测量表勾选框.png",
    fullPage: true,
  });
  // 临时测试会话，仅验证用户指定接触组合的导入、勾选和排版，不保存科研审核结果。
  await page.getByRole("checkbox", { name: "确认完整 5", exact: true }).check();
  await page.getByRole("button", { name: "图版排版", exact: true }).click();
  await page
    .getByRole("button", { name: "载入已确认对象", exact: true })
    .click();
  await page.getByTestId("plate-item").waitFor();
  assert.equal(await page.getByTestId("plate-item").count(), 1);
  await page
    .getByLabel("图版标签", { exact: true })
    .fill("接触组合 · 排版演示");
  await page.screenshot({
    path: root + "MR0145-touching-test/接触组合排版演示.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS Image026: 6 candidates; contact group #5 retained, checkbox and plate cutout verified",
  );
} finally {
  await browser.close();
}
