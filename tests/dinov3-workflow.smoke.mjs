// 真实照片与模拟原生通信检查 UI，真实推理另由原生 IPC 测试验证。
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../../", import.meta.url).pathname;
const out = root + "outputs/分类功能-0.12.3验证/";
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:"chrome",headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:1420");
  await page.getByTestId("project-input").setInputFiles(root+"work/classifier-qa/labeled-project.zip");
  await page.getByRole("tab",{name:"分类",exact:true}).click();
  await expect(page.locator(".class-card")).toHaveCount(13);
  const initialLabels = await page.locator(".class-card strong").allTextContents();
  await page.evaluate(()=>{
    const cache=new Set(); window.__featureCalls=[];
    window.__TAURI_INTERNALS__={transformCallback:()=>1,invoke:async(cmd,args,options)=>{
      if(cmd==="classifier_current")return null;
      if(cmd==="classifier_encoders")return [
        {id:"mobilenetv4-small",name:"MobileNetV4 · 轻量",dim:1280,available:true},
        {id:"dinov3-vits16",name:"DINOv3 · 通用视觉特征",dim:384,available:true}];
      if(cmd==="plugin:event|listen")return 1;
      if(cmd==="plugin:event|unlisten")return;
      if(cmd==="classifier_feature"){
        const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",args))].map(b=>b.toString(16).padStart(2,"0")).join("");
        const key=options.headers["x-sclerite-encoder"]+hash;
        const cached=cache.has(key);cache.add(key);window.__featureCalls.push({cached,headers:options.headers});return {key:hash,cached};
      }
      throw Error("Unexpected mock call: "+cmd);
    }};
    window.isTauri=true;
  });
  await page.locator(".class-card-select").first().click();
  await page.locator(".class-training-options summary").click();
  const encoder=page.getByLabel("特征模型");
  await expect(encoder.locator('option[value="dinov3-vits16"]')).not.toHaveAttribute("disabled", "");
  await page.getByLabel("运行后端").selectOption("coreml");
  await encoder.selectOption("dinov3-vits16");
  await expect(page.getByLabel("运行后端")).toHaveValue("cpu");
  await expect(page.getByLabel("运行后端").locator('option[value="coreml"]')).toHaveAttribute("disabled", "");
  const prepare=page.getByRole("button",{name:"准备特征",exact:true});
  await prepare.click();
  await expect(page.getByTestId("feature-readiness")).toContainText("13/13");
  await expect(prepare).toBeEnabled();
  await prepare.click();
  await expect(page.locator(".class-status")).toContainText("缓存命中 13 枚");
  const calls=await page.evaluate(()=>window.__featureCalls);
  assert.equal(calls.length,26);
  assert(calls.slice(13).every(c=>c.cached));
  assert(calls.every(c=>c.headers["x-sclerite-encoder"]==="dinov3-vits16"&&c.headers["x-sclerite-backend"]==="cpu"));
  await encoder.selectOption("mobilenetv4-small");
  await expect(page.getByTestId("feature-readiness")).toContainText("0/13");
  await encoder.selectOption("dinov3-vits16");
  await expect(page.getByTestId("feature-readiness")).toContainText("13/13");
  assert.deepEqual(await page.locator(".class-card strong").allTextContents(), initialLabels);
  await page.screenshot({path:out+"dinov3-1440.png",fullPage:true});
  await page.setViewportSize({width:1040,height:720});
  await page.screenshot({path:out+"dinov3-1040.png",fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log("PASS DINO availability, CPU switching, 13 crops cache reuse/isolation, label preservation, 1440/1040 layout (mock inference)");
} finally {await browser.close();}
