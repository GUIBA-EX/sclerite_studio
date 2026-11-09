import { chromium, expect } from '@playwright/test';
import { microscopyFile } from './data-path.mjs';

const browser = await chromium.launch({channel:'chrome',headless:true});
try {
  const page = await browser.newPage({viewport:{width:1440,height:960}});
  await page.goto('http://127.0.0.1:1420');
  await page.getByTestId('image-input').setInputFiles(microscopyFile('MR0415_Image026.jpg'));
  await page.locator('.processing').waitFor({state:'hidden',timeout:60000});
  await page.getByRole('button',{name:'运行自动分割',exact:true}).click();
  await page.locator('.processing').waitFor({state:'hidden',timeout:60000});
  const check = page.getByRole('checkbox',{name:'确认完整 5',exact:true});
  await check.check();
  await expect(check).toBeChecked();
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await expect(check).not.toBeChecked();
  await page.getByRole('button',{name:'重做',exact:true}).click();
  await expect(check).toBeChecked();
  await page.getByRole('button',{name:'撤销',exact:true}).click();
  await expect(check).not.toBeChecked();
  console.log('PASS: real image approval undo → redo → undo');
} finally { await browser.close(); }
