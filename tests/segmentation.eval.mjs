import { chromium } from '@playwright/test';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const dir = process.env.SCLERITE_EVAL_DATA;
if (!dir) throw new Error('请设置 SCLERITE_EVAL_DATA 指向人工标注项目 ZIP 目录');
const files = (await readdir(dir)).filter(name => name.toLowerCase().endsWith('.zip')).sort();
if (!files.length) throw new Error('真值目录中没有 ZIP 项目');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
const results = [];
try {
  await page.goto('http://127.0.0.1:1420');
  await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'eval-file'; document.body.append(input); });
  for (const filename of files) {
    await page.locator('#eval-file').setInputFiles(resolve(dir, filename));
    const images = await page.evaluate(async () => {
      const { importProject } = await import('/src/io.ts');
      const { segment } = await import('/src/engine.ts');
      const { segmentationMetrics } = await import('/tests/seg-metrics.ts');
      const file = document.querySelector('#eval-file').files[0];
      const entries = await importProject(file);
      try {
        return entries.map(entry => {
          if (!entry.analysis) throw new Error(`缺少人工真值标签: ${entry.name}`);
          const modes = {};
          for (const [name, params] of Object.entries({ recorded: entry.params, completeOnlyOff: { ...entry.params, completeOnly: false } })) {
            const prediction = segment(entry.data, entry.width, entry.height, params);
            modes[name] = segmentationMetrics(entry.analysis.labels, prediction.labels, entry.width, entry.height);
          }
          return { image: entry.name, width: entry.width, height: entry.height, modes };
        });
      } finally { entries.forEach(entry => URL.revokeObjectURL(entry.url)); }
    });
    results.push({ project: filename, images });
  }
} finally { await browser.close(); }
const date = new Intl.DateTimeFormat('en-CA').format(new Date());
const out = resolve('eval-output');
await mkdir(out, { recursive: true });
const stem = join(out, `segmentation-${date}`);
await writeFile(stem + '.json', JSON.stringify({ date, matching: 'greedy IoU >= 0.5', results }, null, 2) + '\n', { flag: 'wx' });
const lines = ['# 分割评估', '', '| 项目 | 图像 | 参数 | 范围 | TP | FP | FN | F1@0.5 | 平均 IoU | 欠切 | 过切 |', '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|'];
for (const project of results) for (const image of project.images) for (const [mode, scopes] of Object.entries(image.modes)) for (const [scope, m] of Object.entries(scopes)) lines.push(`| ${project.project.replaceAll('|','\\|')} | ${image.image.replaceAll('|','\\|')} | ${mode} | ${scope} | ${m.tp} | ${m.fp} | ${m.fn} | ${m.f1.toFixed(3)} | ${m.meanIoU === null ? '—' : m.meanIoU.toFixed(3)} | ${m.undersegmented} | ${m.oversegmented} |`);
await writeFile(stem + '.md', lines.join('\n') + '\n', { flag: 'wx' });
console.log(`已输出 ${stem}.json 和 .md`);
