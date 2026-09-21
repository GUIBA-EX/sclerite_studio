import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";

const out = new URL("../../Logo-0.7.1验证/", import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://127.0.0.1:1420");
  const logo = page.locator("img.brand-icon");
  await expect(logo).toBeVisible();
  await expect(logo).toHaveJSProperty("naturalWidth", 256);
  const src = await logo.evaluate((img) => img.src);
  const response = await page.request.get(src);
  assert.deepEqual(await response.body(), await readFile(new URL("../src-tauri/icons/128x128@2x.png", import.meta.url)));
  for (const [width, height] of [[1440, 960], [1040, 720]]) {
    await page.setViewportSize({ width, height });
    const bounds = await logo.boundingBox();
    assert.equal(bounds.width, 44);
    assert.equal(bounds.height, 44);
    assert.ok(await page.locator(".brand").evaluate((el) => el.scrollWidth <= el.clientWidth));
    await page.screenshot({ path: decodeURIComponent(new URL(`界面-${width}.png`, out).pathname) });
  }
  assert.deepEqual(errors, []);
  console.log("PASS native icon bytes match; high-DPI image loads; both window sizes fit; no page errors");
} finally {
  await browser.close();
}
