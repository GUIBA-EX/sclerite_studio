import { microscopyFile } from "./data-path.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const out = decodeURIComponent(
  new URL("../../双语-0.12.3验证/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  locale: "en-US",
});
page.setDefaultTimeout(10000);
const errors = [],
  leftovers = {};
page.on("pageerror", (e) => errors.push(e.message));
const b = (name) => page.getByRole("button", { name, exact: true });
async function audit(name) {
  leftovers[name] = await page.evaluate(() => {
    const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      ),
      texts = [];
    while (walker.nextNode()) {
      const n = walker.currentNode,
        p = n.parentElement;
      if (!p || !p.checkVisibility() || p.closest("option,.language-select"))
        continue;
      if (/[\u3400-\u9fff]/u.test(n.textContent))
        texts.push(n.textContent.trim());
    }
    return [...new Set(texts)].filter(Boolean);
  });
}
try {
  await page.goto("http://127.0.0.1:1420");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
  await expect(b("选择图像")).toBeVisible();
  await page
    .getByRole("combobox", { name: "语言", exact: true })
    .selectOption("en");
  await expect(b("Select images")).toBeVisible();
  await audit("empty");
  await page.screenshot({ path: out + "English-empty.png" });
  await b("Help").click();
  await audit("help");
  await b("Close help").click();
  await page
    .getByTestId("image-input")
    .setInputFiles(microscopyFile("MR0415_Image026.jpg"));
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  await page.getByLabel("Specimen ID", { exact: true }).fill("选择");
  await page
    .getByLabel("Tissue region", { exact: true })
    .selectOption("珊瑚虫 polyp");
  await b("Run segmentation").click();
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  await b("Select all in current list").click();
  await b("Approve selected").click();
  const count = await page.locator(".approval-checkbox:checked").count();
  assert.ok(count > 0);
  await audit("segmented");
  await page
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("zh-CN");
  await expect(page.getByLabel("标本编号", { exact: true })).toHaveValue(
    "选择",
  );
  await expect(page.getByLabel("组织区域", { exact: true })).toHaveValue(
    "珊瑚虫 polyp",
  );
  assert.equal(await page.locator(".approval-checkbox:checked").count(), count);
  await page
    .getByRole("combobox", { name: "语言", exact: true })
    .selectOption("en");
  await page.getByRole("tab", { name: "Classification", exact: true }).click();
  await page.getByPlaceholder("e.g. spindle / club").fill("选择");
  await b("Add class").click();
  await expect(
    page.locator(".class-category").filter({ hasText: "选择" }),
  ).toHaveCount(1);
  await audit("classification");
  await b("View training checks").click();
  await audit("audit");
  await b("Back to labeling").click();
  await page.screenshot({ path: out + "English-classification.png" });
  await page
    .getByRole("tab", { name: "Image processing", exact: true })
    .click();
  await b("Plate layout").click();
  await b("Load approved objects").click();
  await expect(page.getByTestId("plate-item")).toHaveCount(count);
  await expect(b("Back to measurements")).toBeEnabled();
  const layoutBefore = await page
    .getByTestId("plate-item")
    .evaluateAll((es) =>
      es.map((e) => [
        e.getAttribute("data-key"),
        e.getAttribute("transform"),
        e.getAttribute("data-angle"),
      ]),
    );
  await page
    .locator(".plate-modal")
    .getByRole("combobox", { name: "Language", exact: true })
    .selectOption("zh-CN");
  await expect(b("返回测量")).toBeVisible();
  await page
    .locator(".plate-modal")
    .getByRole("combobox", { name: "语言", exact: true })
    .selectOption("en");
  assert.deepEqual(
    await page
      .getByTestId("plate-item")
      .evaluateAll((es) =>
        es.map((e) => [
          e.getAttribute("data-key"),
          e.getAttribute("transform"),
          e.getAttribute("data-angle"),
        ]),
      ),
    layoutBefore,
  );
  await audit("plate");
  await page.screenshot({ path: out + "English-plate.png" });
  await b("Back to measurements").click();
  await page.setViewportSize({ width: 1040, height: 720 });
  await page.screenshot({ path: out + "English-small.png" });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  assert.equal(overflow, false);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await writeFile(
    out + "visible-text-audit.json",
    JSON.stringify({ leftovers, errors, count }, null, 2),
  );
  assert.deepEqual(errors, []);
  for (const [name, texts] of Object.entries(leftovers))
    assert.deepEqual(
      texts.filter((t) => t !== "选择"),
      [],
      name,
    );
  console.log(JSON.stringify({ leftovers, errors, count }, null, 2));
} finally {
  await writeFile(
    out + "visible-text-audit.json",
    JSON.stringify({ leftovers, errors }, null, 2),
  );
  await browser.close();
}
