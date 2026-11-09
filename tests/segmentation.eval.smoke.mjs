import { chromium } from '@playwright/test';
import JSZip from 'jszip';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const dir = await mkdtemp(join(tmpdir(), 'sclerite-eval-'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await page.setContent('<canvas width="32" height="32"></canvas>');
  const png = await page.locator('canvas').screenshot();
  const zip = new JSZip(), labels = Buffer.alloc(32 * 32 * 4);
  for (let y=8; y<24; y++) for (let x=8; x<24; x++) labels.writeUInt32LE(1, (y*32+x)*4);
  zip.file('images/a/original', png);
  zip.file('images/a/labels.u32', labels);
  zip.file('project.json', JSON.stringify({ schema:'sclerite-studio/1', version:'0.12.3', images:[{ id:'a', name:'synthetic.png', mime:'image/png', originalPath:'images/a/original', maskPath:'images/a/labels.u32' }] }));
  await writeFile(join(dir,'synthetic.zip'), await zip.generateAsync({type:'nodebuffer'}));
  const runner = resolve('tests/segmentation.eval.mjs');
  execFileSync(process.execPath, [runner], { cwd:dir, env:{...process.env,SCLERITE_EVAL_DATA:dir}, stdio:'inherit', timeout:60000 });
  const date = new Intl.DateTimeFormat('en-CA').format(new Date());
  const output = JSON.parse(await readFile(join(dir,'eval-output',`segmentation-${date}.json`),'utf8'));
  assert.equal(output.results[0].images[0].image,'synthetic.png');
  assert.ok(output.results[0].images[0].modes.recorded.all);
  assert.ok(output.results[0].images[0].modes.completeOnlyOff.withoutBorder);
  console.log('PASS: synthetic project import and both segmentation evaluation modes');
} finally { await browser.close(); }
