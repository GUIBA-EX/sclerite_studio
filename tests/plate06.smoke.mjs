import { microscopyFile } from "./data-path.mjs";
import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import JSZip from "jszip";
const out = decodeURIComponent(
  new URL("../../排版-0.6验证/", import.meta.url).pathname,
);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
  viewport: { width: 1440, height: 960 },
  acceptDownloads: true,
});
const checks = [],
  errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => d.accept());
const b = (name) => page.getByRole("button", { name, exact: true });
const mark = (s) => {
  checks.push(s);
  console.log("PASS", s);
};
const download = async (name, file) => {
  const d = page.waitForEvent("download");
  await b(name).click();
  await (await d).saveAs(out + file);
  return readFile(out + file);
};
try {
  await page.goto("http://127.0.0.1:1420");
  await page
    .getByTestId("image-input")
    .setInputFiles(microscopyFile("MR0415_Image018.jpg"));
  await page
    .locator(".processing")
    .waitFor({ state: "hidden", timeout: 60000 });
  await b("运行自动分割").click();
  await expect(page.locator("tbody tr")).toHaveCount(4, { timeout: 60000 });
  for (const cb of await page.locator(".approval-checkbox").all())
    await cb.check();
  await b("图版排版").click();
  await b("载入已确认对象").click();
  await expect(page.getByTestId("plate-item")).toHaveCount(4);
  const base = JSON.parse(await download("保存版面", "转正初始.json"));
  let stable = 0;
  for (const i of base.items)
    if (i.axisStrength >= 0.12) {
      stable++;
      assert.ok(
        Math.abs(Math.cos(((i.angle + i.longAxisAngle) * Math.PI) / 180)) <
          1e-8,
      );
    }
  assert.ok(stable >= 3);
  mark("真实Image018四枚独立骨针载入时自动沿稳定长轴竖直转正");
  await page.screenshot({ path: out + "白底-自动转正.png", fullPage: true });
  await page.getByLabel("版面背景", { exact: true }).selectOption("black");
  await expect(page.getByTestId("plate-background")).toHaveAttribute(
    "fill",
    "black",
  );
  await expect(
    page.getByTestId("plate-item").first().locator("text"),
  ).toHaveAttribute("fill", "#ffffff");
  await b("撤销排版").click();
  await expect(page.getByLabel("版面背景", { exact: true })).toHaveValue(
    "white",
  );
  await page.getByLabel("版面背景", { exact: true }).selectOption("black");
  const first = page.getByTestId("plate-item").first();
  await first.click();
  const before = await first.getAttribute("transform"),
    box = await first.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box.x + box.width / 2 + 25,
    box.y + box.height / 2 + 15,
    { steps: 5 },
  );
  await page.mouse.up();
  assert.notEqual(await first.getAttribute("transform"), before);
  await page.getByLabel("角度数值", { exact: true }).fill("32");
  await expect(first).toHaveAttribute("data-angle", "32");
  await b("翻转180°").click();
  await expect(first).toHaveAttribute("data-angle", "-148");
  await b("撤销排版").click();
  await expect(first).toHaveAttribute("data-angle", "32");
  const width = Number(await first.locator("image").getAttribute("width"));
  await b("缩小对象").click();
  assert.ok(Number(await first.locator("image").getAttribute("width")) < width);
  const edited = JSON.parse(await download("保存版面", "黑底-手动调整.json"));
  assert.equal(edited.background, "black");
  assert.equal(edited.items[0].angle, 32);
  for (let n = 0; n < 4; n++) {
    assert.equal(edited.items[n].image, base.items[n].image);
    for (const key of ["x", "y", "width", "height", "angle"])
      assert.ok(Number.isFinite(edited.items[n][key]));
  }
  mark("逐枚拖动、角度输入、180度翻转、缩放、撤销；透明原始裁剪不变");
  await page.screenshot({ path: out + "黑底-手动调整.png", fullPage: true });
  for (const background of ["black", "white"]) {
    await page.getByLabel("版面背景", { exact: true }).selectOption(background);
    const bytes = await download("导出版面PNG", `${background}.png`);
    const pixel = await page.evaluate(async (base64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + base64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      return {
        width: c.width,
        height: c.height,
        pixel: [...ctx.getImageData(0, 0, 1, 1).data],
      };
    }, bytes.toString("base64"));
    assert.deepEqual(pixel, {
      width: 2400,
      height: 1800,
      pixel: background === "black" ? [0, 0, 0, 255] : [255, 255, 255, 255],
    });
  }
  mark("黑底/白底预览与2400×1800 PNG导出一致，标签使用反差色");
  await page
    .getByTestId("plate-input")
    .setInputFiles(out + "黑底-手动调整.json");
  await expect(page.getByLabel("版面背景", { exact: true })).toHaveValue(
    "black",
  );
  await expect(first).toHaveAttribute("data-angle", "32");
  await b("自动排版").click();
  await expect(first).toHaveAttribute("data-angle", "32");
  await b("选中转正").click();
  await expect(first).not.toHaveAttribute("data-angle", "32");
  await b("撤销排版").click();
  await expect(first).toHaveAttribute("data-angle", "32");
  await b("返回测量").click();
  const zip = await JSZip.loadAsync(
    await download("保存项目（含版面）", "含黑底项目.zip"),
  );
  const plate = JSON.parse(await zip.file("plate.json").async("string"));
  assert.equal(plate.background, "black");
  assert.equal(plate.items[0].angle, 32);
  await expect(page.locator(".statusbar")).toContainText("本地恢复副本已更新", {
    timeout: 20000,
  });
  await page.reload();
  await b("恢复工作").click();
  await expect(page.locator("tbody tr")).toHaveCount(4);
  await b("图版排版").click();
  await expect(page.getByLabel("版面背景", { exact: true })).toHaveValue(
    "black",
  );
  await expect(first).toHaveAttribute("data-angle", "32");
  mark("独立版面与项目保存背景和角度；自动排版保留手调角度；重启恢复通过");
  const p2 = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  p2.on("pageerror", (e) => errors.push(e.message));
  p2.on("dialog", (d) => d.accept());
  await p2.goto("http://127.0.0.1:1420");
  await p2.getByTestId("project-input").setInputFiles(out + "含黑底项目.zip");
  await expect(p2.locator("tbody tr")).toHaveCount(4, { timeout: 60000 });
  await p2.getByRole("button", { name: "图版排版", exact: true }).click();
  await expect(p2.getByLabel("版面背景", { exact: true })).toHaveValue("black");
  await expect(p2.getByTestId("plate-item").first()).toHaveAttribute(
    "data-angle",
    "32",
  );
  const legacy = structuredClone(edited);
  delete legacy.background;
  for (const i of legacy.items) {
    delete i.longAxisAngle;
    delete i.axisStrength;
  }
  await page
    .getByTestId("plate-input")
    .setInputFiles({
      name: "legacy.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(legacy)),
    });
  await expect(page.getByLabel("版面背景", { exact: true })).toHaveValue(
    "white",
  );
  await b("全部沿长轴转正").click();
  const restored = JSON.parse(
    await download("保存版面", "旧版兼容-重新转正.json"),
  );
  for (const i of restored.items)
    if (i.axisStrength >= 0.12)
      assert.ok(
        Math.abs(Math.cos(((i.angle + i.longAxisAngle) * Math.PI) / 180)) <
          1e-8,
      );
  mark("新空工作台打开项目通过；旧版JSON默认白底，可从透明mask补算长轴");
  assert.deepEqual(errors, []);
  await writeFile(
    out + "verification.json",
    JSON.stringify({ date: new Date().toISOString(), checks, errors }, null, 2),
  );
} finally {
  await browser.close();
}
