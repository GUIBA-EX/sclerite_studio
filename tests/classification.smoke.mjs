import { microscopyFile } from "./data-path.mjs";
import {chromium,expect} from "@playwright/test";
import {mkdir,writeFile,readFile} from "node:fs/promises";
import assert from "node:assert/strict";
const base=new URL("../../../work/classifier-qa/",import.meta.url).pathname;
await mkdir(base,{recursive:true});
const browser=await chromium.launch({channel:"chrome",headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
const errors=[];page.on("pageerror",e=>errors.push(e.message));
const b=name=>page.getByRole("button",{name,exact:true});
try{
  await page.goto("http://127.0.0.1:1420");
  const files=["MR0415_Image018.jpg","MR0415_Image026.jpg"];
  await page.getByTestId("image-input").setInputFiles(files.map(f=>microscopyFile(f)));
  await page.locator(".processing").waitFor({state:"hidden",timeout:60000});
  await b("处理全部 2 张图像").click();
  await page.locator(".processing").waitFor({state:"hidden",timeout:60000});
  for(const file of files){await page.locator(".image-item").filter({hasText:file}).click();await b("全选当前列表").click();await b("确认选中").click();}
  await page.getByRole("tab",{name:"分类",exact:true}).click();
  await expect(page.locator(".class-card")).toHaveCount(13);
  for(const name of ["工程测试 A","工程测试 B"]){await page.getByLabel("新类别名称").fill(name);await b("添加类别").click();}
  await page.getByLabel("新标本名称").fill("MR0145 工程测试标本");await b("创建标本").click();
  const id=await page.getByLabel("所属标本").inputValue();
  const photos=await page.getByLabel("分类照片").locator("option").evaluateAll(els=>els.map(e=>e.value).filter(Boolean));
  await page.getByLabel("分类照片").selectOption(photos.find(p=>p!==photos[1])??photos[0]);
  await page.getByLabel("所属标本").selectOption(id);
  const cards=page.locator(".class-card-select");
  await cards.nth(0).click();await cards.nth(1).click({modifiers:["Meta"]});
  await expect(page.locator(".class-card.selected")).toHaveCount(2);
  const categoryIds=await page.getByLabel("赋予类别").locator("option").evaluateAll(els=>els.map(e=>e.value).filter(Boolean));
  await page.getByLabel("赋予类别").selectOption(categoryIds[0]);await b("确认类别").click();
  await expect(page.locator(".class-card-info strong").filter({hasText:"工程测试 A"})).toHaveCount(2);
  await cards.nth(2).click();await cards.nth(3).click({modifiers:["Meta"]});
  await page.getByLabel("赋予类别").selectOption(categoryIds[1]);await b("确认类别").click();
  await expect(b("训练分类器")).toBeDisabled();
  await b("撤销标注").click();
  await expect(page.locator(".class-card-info strong").filter({hasText:"工程测试 B"})).toHaveCount(0);
  await b("重做标注").click();
  await expect(page.locator(".class-card-info strong").filter({hasText:"工程测试 B"})).toHaveCount(2);
  await page.keyboard.press("Meta+z");
  await expect(page.locator(".class-card-info strong").filter({hasText:"工程测试 B"})).toHaveCount(0);
  await page.keyboard.press("Meta+Shift+z");
  await expect(page.locator(".class-card-info strong").filter({hasText:"工程测试 B"})).toHaveCount(2);
  await b("查看训练前检查").click();
  const audit=page.getByRole("dialog",{name:"训练前检查"});
  await expect(audit).toContainText("检查通过");
  await expect(audit).toContainText("9 枚尚未标注");
  await page.screenshot({path:base+"training-audit-1440.png"});
  await audit.getByRole("checkbox").check();
  await expect(audit).toContainText("每类至少需要 3 个独立");
  await expect(audit.getByRole("button",{name:"开始训练",exact:true})).toBeDisabled();
  await page.setViewportSize({width:1040,height:720});
  await page.screenshot({path:base+"training-audit-1040.png"});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await audit.getByRole("checkbox").uncheck();
  await b("关闭训练前检查").click();
  await page.setViewportSize({width:1440,height:960});
  await b("重命名 工程测试 A").click();await page.getByLabel("类别新名称").fill("工程测试 A 校对");await b("保存名称").click();
  await expect(page.locator(".class-card-info strong").filter({hasText:"工程测试 A 校对"})).toHaveCount(2);
  await b("重命名 工程测试 A 校对").click();await page.getByLabel("类别新名称").fill("工程测试 A");await b("保存名称").click();
  await cards.nth(0).click();await cards.nth(3).click({modifiers:["Shift"]});await expect(page.locator(".class-card.selected")).toHaveCount(4);
  await page.keyboard.press("Meta+a");await expect(page.locator(".class-card.selected")).toHaveCount(13);
  await page.getByLabel("筛选来源照片").selectOption(photos[0]);await expect(page.locator(".class-card")).toHaveCount(4);
  await page.getByLabel("筛选来源照片").selectOption("all");await expect(page.locator(".class-card")).toHaveCount(13);
  await cards.nth(2).click();await cards.nth(3).click({modifiers:["Meta"]});
  await page.screenshot({path:base+"classification-1440.png"});
  await page.setViewportSize({width:1040,height:720});await page.screenshot({path:base+"classification-1040.png"});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.setViewportSize({width:1440,height:960});
  const download=page.waitForEvent("download");await b("保存项目（含版面）").click();await (await download).saveAs(base+"labeled-project.zip");
  const cropContext=await browser.newContext();const originalPages=await cropContext.newPage();await originalPages.goto("http://127.0.0.1:1420");
  const buffers=[];
  // 用同一个原图解码和分割函数生成原分辨率裁剪；仅工程分组，不是生物学真值。
  for(let i=0;i<files.length;i++){
    if(process.env.UI_ONLY)continue;
    const bytes=[...await readFile(microscopyFile(files[i]))];
    const crops=await originalPages.evaluate(async({bytes,name})=>{
      const {loadImage}=await import("/src/io.ts");const {segment}=await import("/src/engine.ts");const {cropPacket}=await import("/src/classification.ts");
      const e=await loadImage(new File([new Uint8Array(bytes)],name,{type:"image/jpeg"}));
      e.analysis=segment(e.data,e.width,e.height,e.params);
      return e.analysis.objects.map(o=>({id:o.id,packet:[...cropPacket(e,o)]}));
    },{bytes,name:files[i]});
    for(const c of crops){const name=`${i}-${c.id}.bin`;await writeFile(base+name,new Uint8Array(c.packet));buffers.push({path:name,label:i,source:files[i]});}
  }
  if(buffers.length)await writeFile(base+"crops.json",JSON.stringify(buffers,null,2));await originalPages.close();
  const clean=await browser.newContext({viewport:{width:1440,height:960}}),restored=await clean.newPage();await restored.goto("http://127.0.0.1:1420");
  await restored.getByTestId("project-input").setInputFiles(base+"labeled-project.zip");
  await restored.locator(".processing").waitFor({state:"hidden",timeout:60000});await restored.getByRole("tab",{name:"分类",exact:true}).click();
  await expect(restored.locator(".class-card-info strong").filter({hasText:"工程测试 A"})).toHaveCount(2);
  await expect(restored.locator(".class-card-info strong").filter({hasText:"工程测试 B"})).toHaveCount(2);
  assert.deepEqual(errors,[]);console.log("PASS tabs, real-photo cards, multiselect, annotation, specimen assignment, 1040/1440 layout, project round-trip; crops",buffers.length);
}finally{await browser.close();}
