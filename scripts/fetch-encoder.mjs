import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../src-tauri/models/', import.meta.url);
const target = fileURLToPath(new URL('encoder.onnx', root));
const metadata = JSON.parse(await readFile(new URL('encoder.json', root), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
if (!/^[a-f0-9]{64}$/.test(metadata.sha256 ?? '')) throw new Error('编码器元数据中的 SHA-256 无效');
let existing;
try { existing = await readFile(target); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (existing) {
  if (hash(existing) !== metadata.sha256) throw new Error('已有编码器哈希不符，拒绝覆盖');
  console.log('本地编码器已通过 SHA-256 校验');
} else {
  const url = process.env.SCLERITE_ENCODER_URL || 'https://github.com/GUIBA-EX/sclerite_studio/releases/download/models-v1/mobilenetv4-encoder.onnx';
  const response = await fetch(url);
  if (!response.ok) throw new Error(`编码器下载失败：HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (hash(bytes) !== metadata.sha256) throw new Error('下载的编码器哈希不符，未写入文件');
  await writeFile(target, bytes, { flag: 'wx' });
  console.log('编码器下载完成，SHA-256 校验通过');
}
