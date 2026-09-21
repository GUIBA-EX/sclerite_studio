// Package the actual runtime dependency and notices, without research data.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const build = path.resolve(process.argv[2] || path.join(root, "src-tauri/target/release"));
const dest = path.resolve(process.argv[3] || path.join(root, "dist/windows-portable"));
if (dest === build) throw new Error("Use a separate output folder");
const files = [
  [path.join(build,"sclerite-studio.exe"), "Sclerite-Studio.exe"],
  [path.join(build,"DirectML.dll"), "DirectML.dll"],
  [path.join(root,"docs/WINDOWS-PORTABLE.md"), "README.md"],
  [path.join(root,"src-tauri/models/LICENSE.txt"), "licenses/MobileNet-model.txt"],
  [path.join(root,"src-tauri/models/Apache-2.0.txt"), "licenses/Apache-2.0.txt"],
  [path.join(root,"src-tauri/models/dinov3/LICENSE.txt"), "licenses/DINOv3.txt"],
  [path.join(root,"src-tauri/runtime/LICENSE"), "licenses/ONNX-Runtime.txt"],
  [path.join(root,"src-tauri/runtime/ThirdPartyNotices.txt"), "licenses/ThirdPartyNotices.txt"],
  [path.join(root,"src-tauri/runtime/DirectML-LICENSE.txt"), "licenses/DirectML.txt"],
  [path.join(root,"src-tauri/runtime/DirectML-ThirdPartyNotices.txt"), "licenses/DirectML-ThirdPartyNotices.txt"],
];
const exe = await fs.readFile(files[0][0]);
const pe = exe.readUInt32LE(0x3c);
if (exe.toString("ascii",0,2)!=="MZ" || exe.readUInt32LE(pe)!==0x4550 || exe.readUInt16LE(pe+4)!==0x8664)
  throw new Error("Expected a Windows x64 PE executable");
await Promise.all(files.map(([source])=>fs.access(source)));
const hashes=[];
for (const [source,name] of files) {
  const output=path.join(dest,name);
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.copyFile(source,output);
  const bytes=await fs.readFile(output);
  hashes.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
}
await fs.writeFile(path.join(dest,"SHA256SUMS.txt"),hashes.join("\n")+"\n");
console.log(`Packaged ${files.length} files in ${dest}`);
