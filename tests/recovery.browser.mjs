import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:1420/src/history.ts');
  const result = await page.evaluate(async () => {
    const open = version => new Promise((resolve, reject) => {
      const request = indexedDB.open('sclerite-recovery', version);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const old = await open(1);
    await new Promise((resolve, reject) => {
      const tx = old.transaction('snapshots', 'readwrite');
      tx.objectStore('snapshots').put({ version: 1, date: 'old', images: [], items: [] }, 'latest');
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    });
    old.close();
    const api = await import('/src/recovery.ts');
    const legacy = await api.readRecovery();
    const blob = new Blob(['source']);
    const a = { id:'a', name:'a', original:blob, data:new Uint8ClampedArray(4), url:'', undo:[], notes:{}, analysis:{ labels:Int32Array.from([0,1,1,0]), objects:[], threshold:4 } };
    const b = { ...a, id:'b' };
    await api.writeRecovery([a,b], []);
    const puts = [], originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) { puts.push(key); return originalPut.call(this, value, key); };
    const changed = { ...a, notes: { '1':'changed' } };
    await api.writeRecovery([changed,b], []);
    IDBObjectStore.prototype.put = originalPut;
    const snapshot = await api.readRecovery();
    const db = await open(2);
    const keys = await new Promise((resolve, reject) => { const req=db.transaction('snapshots').objectStore('snapshots').getAllKeys(); req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error); });
    db.close();
    await api.writeRecovery([changed], []);
    const reduced = await api.readRecovery();
    return { legacy, keys, puts, ids:snapshot.images.map(i=>i.id), labels:[...snapshot.images[0].analysis.labels], note:snapshot.images[0].notes['1'], reduced:reduced.images.map(i=>i.id) };
  });
  assert.equal(result.legacy.version, 1);
  assert.deepEqual(result.ids, ['a','b']);
  assert.deepEqual(result.labels, [0,1,1,0]);
  assert.equal(result.note, 'changed');
  assert.deepEqual(result.puts, ['image:a', 'manifest']);
  assert(!result.keys.includes('latest'));
  assert.deepEqual(result.reduced, ['a']);
  console.log('PASS: IndexedDB v1 migration, v2 read/write, grayscale labels, deletion');
} finally { await browser.close(); }
