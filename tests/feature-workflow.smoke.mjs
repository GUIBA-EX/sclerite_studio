// 用真实照片项目验证界面；此处模拟推理通信，原生推理由 IPC 测试另验。
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const root = new URL("../../../", import.meta.url).pathname;
const out = root + "outputs/分类功能-0.12.2验证/";
await mkdir(out, {recursive:true});
const browser = await chromium.launch({channel:"chrome",headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await page.goto("http://127.0.0.1:1420");
  await page.getByTestId("project-input").setInputFiles(root+"work/classifier-qa/labeled-project.zip");
  await page.getByRole("tab",{name:"分类",exact:true}).click();
  await expect(page.locator(".class-card")).toHaveCount(13);
  await page.locator(".class-card-select").first().click();
  await page.keyboard.press("Meta+a");
  await page.getByRole("button",{name:"清除选中人工标签",exact:true}).click();
  await page.evaluate(()=>{
    const cache=new Set(); window.__featureCalls=[];
    window.__TAURI_INTERNALS__={transformCallback:()=>1,invoke:async(cmd,args,options)=>{
      if(cmd==="classifier_current")return null;
      if(cmd==="classifier_encoders")return [
        {id:"mobilenetv4-small",name:"MobileNetV4 · 轻量",dim:1280,available:true},
        {id:"dinov3-vits16",name:"DINOv3 · 通用视觉特征",dim:384,available:false}];
      if(cmd==="plugin:event|listen")return 1;
      if(cmd==="plugin:event|unlisten")return;
      if(cmd==="classifier_feature"){
        const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",args))].map(b=>b.toString(16).padStart(2,"0")).join("");
        const cached=cache.has(hash);cache.add(hash);window.__featureCalls.push({cached,headers:options.headers});return {key:hash,cached};
      }
      throw Error("Unexpected mock call: "+cmd);
    }};
    window.isTauri=true;
  });
  await page.locator(".class-card-select").first().click();
  const prepare=page.getByRole("button",{name:"准备特征",exact:true});
  await expect(prepare).toBeEnabled();
  await prepare.click();
  await expect(page.getByTestId("feature-readiness")).toContainText("13/13");
  await expect(prepare).toBeEnabled();
  const category=await page.getByLabel("赋予类别").locator("option").nth(1).getAttribute("value");
  await page.getByLabel("赋予类别").selectOption(category);
  await page.getByRole("button",{name:"确认类别",exact:true}).click();
  await expect(page.getByTestId("feature-readiness")).toContainText("13/13");
  await prepare.click();
  await expect(page.locator(".class-status")).toContainText("缓存命中 13 枚");
  const calls=await page.evaluate(()=>window.__featureCalls);
  assert.equal(calls.length,26);assert(calls.slice(13).every(c=>c.cached));
  assert(calls.every(c=>c.headers["x-sclerite-encoder"]==="mobilenetv4-small"));
  await page.locator(".class-training-options summary").click();
  await expect(page.getByLabel("特征模型").locator('option[value="dinov3-vits16"]')).toHaveAttribute("disabled", "");
  await expect(page.getByRole("checkbox",{name:"用验证集选择正则强度"})).toBeDisabled();
  await page.getByRole("checkbox",{name:"按独立标本分组评估",exact:true}).check();
  await expect(page.getByRole("checkbox",{name:"用验证集选择正则强度"})).toBeEnabled();
  await page.screenshot({path:out+"feature-workflow-1440.png",fullPage:true});
  await page.setViewportSize({width:1040,height:720});
  await page.screenshot({path:out+"feature-workflow-1040.png",fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  assert.deepEqual(errors,[]);
  console.log("PASS unlabeled preparation, cache retention after labels, 13/13 reuse, unavailable encoder, validation-only controls, 1440/1040 layout (mock inference)");
} finally {await browser.close();}
