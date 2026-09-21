<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="112" height="112" alt="Sclerite Studio logo" />
</p>
<h1 align="center">Sclerite Studio</h1>
<p align="center">骨针工作室 · 从光镜照片到可复核的骨针测量与分类</p>
<p align="center">An offline microscopy workspace for sclerite segmentation, measurement and classification.</p>
<p align="center"><strong>0.12.3 · 中文 / English · Windows / macOS</strong></p>

---

## 中文

Sclerite Studio 面向八放珊瑚骨针光镜照片，将实例分割、完整性复核、形态测量、分类与科研图版排版放在同一个本地桌面工作区。**首次启动默认中文**，右上角可切换 English，并记住本机选择。

### 主要功能

- **图像处理**：PNG、JPEG、单页 TIFF；背景校正、阈值分割、接触组合切分；画笔、擦除、合并和撤销。
- **完整性复核**：逐枚或批量确认；结果只导出已确认完整的对象。不补画遮挡轮廓，自动切分仍需人工检查。
- **测量与校准**：原图保留；校准后输出长度、宽度、面积、长宽比和圆度。长度是二维最大 Feret 径，不是弧长。
- **分类**：人工类别与标本标签 → 冻结特征 → 轻量逻辑回归 → 批量预测与人工复核。默认 MobileNetV4；具备授权资源的构建可启用 DINOv3 ViT-S/16。
- **分组验证**：按记录的标本、群体、出版物及重复原图检查关联，避免骨针级随机划分造成泄漏。试用模型不提供独立验证结论。
- **联合排版**：保持原始尺寸关系，沿长轴转正；逐枚移动、旋转与缩放；多选、多页、黑白背景、来源注释和比例尺。
- **本地保存**：原图、mask、确认状态、标签与可编辑版面可保存到项目；支持恢复副本、CSV 和 PNG 导出。照片不上传。

### 使用

1. 导入显微照片，填写标本与组织信息，检查比例尺。
2. 运行分割，修正粘连或错误轮廓，确认完整对象。
3. 导出测量，或进入分类页整理标签、训练和复核。
4. 在图版排版中联合多个视野，调整版面后导出。

**Windows 绿色版**：解压完整文件夹后运行其中的 `.exe`，无需安装本应用；不要遗漏随附运行库。需要 x64 Windows、Microsoft Edge WebView2 Runtime 和 Visual C++ x64 运行库。详见 [运行说明](docs/WINDOWS-PORTABLE.md)。本地交叉编译不等于 Windows 实机验收。

**macOS**：现有应用包面向 Apple Silicon、macOS 14+。本地测试包未经过 Apple 公证。

### 科学与许可边界

软件测试不等于生物学准确率验证。模型分数不是真实物种概率；一枚骨针不是独立标本，分类也不等于物种界定。照片、组织、批次、来源和标签质量仍需研究者核查。未校准对象不能用于绝对尺寸比较。

本仓库只存放源码、图标、测试与模型配置/许可文本；不包含研究照片、用户项目、训练缓存或模型二进制。DINOv3 须由使用者合法取得 Meta 权重并遵守其许可。第三方许可见 [models](src-tauri/models/) 与 [runtime](src-tauri/runtime/)。本仓库没有额外授予一份未声明的开源许可证。

## English

Sclerite Studio brings light-micrograph segmentation, completeness review, morphometrics, classification and plate layout into one offline desktop workspace. It starts in Chinese; choose **English** at the top right. Switching language preserves images, masks, approvals, layouts and user-authored labels.

### Features

- Segment individual sclerites, split touching groups and edit masks manually.
- Approve intact objects before exporting measurements; never reconstruct invisible outlines.
- Calibrate physical scale and measure 2D maximum Feret diameter, width, area, aspect ratio and circularity.
- Train a lightweight classification head on frozen MobileNetV4 features; optionally use authorized DINOv3 weights. Review predictions without overwriting manual labels.
- Keep recorded related specimens and sources together for independent evaluation.
- Compose multi-photo, multi-page plates with long-axis alignment, individual transforms, scale bars and black/white backgrounds.
- Save editable projects locally and export CSV, crops, masks and PNG plates.

The Windows portable package requires an x64 system, WebView2 and the Visual C++ x64 runtime. Keep the executable with accompanying runtime files. See the [portable guide](docs/WINDOWS-PORTABLE.md). Mac packages target Apple Silicon and macOS 14+. Build checks are not biological validation or Windows hardware testing.

## Development

Frontend: **React · TypeScript · Vite**. Desktop: **Tauri 2 · Rust**. Inference: **ONNX Runtime**, CPU on Windows; MobileNet Core ML CPU/GPU is experimental on Mac. DINOv3 uses CPU. NPU is not enabled.

```sh
npm ci
npm test
npm run dev
```

The browser supports image processing, layout and label organization. Native training and prediction require a desktop build. Frontend tests do not require model weights.

### Prepare models before a desktop build

The desktop embeds `src-tauri/models/encoder.onnx`, which is deliberately excluded from Git. Export the MobileNet encoder using a separate Python development environment:

```sh
python -m venv .venv
# Activate the environment using the command for your operating system.
python -m pip install torch torchvision timm onnx onnxruntime numpy
python scripts/export_encoder.py
```

The exporter checks ONNX output against PyTorch and records versions, hashes and parity results. A new export may have a different hash; do not replace a release encoder if you need cache/model compatibility. Python is a development dependency, not an end-user requirement.

```sh
# Windows portable build, with Rust MSVC and C++ build tools installed:
npm run build
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
node scripts/package-windows.mjs

# macOS, after preparing ONNX Runtime 1.24.2 in src-tauri/runtime:
npm run desktop:build -- --config src-tauri/tauri.macos.conf.json --bundles app
```

Optional DINOv3 builds require an authorized checkpoint, its license and validation metadata from `scripts/export_dinov3.py`; then add `--features dinov3`. Never commit signed download URLs or personal authorization messages. See [development history](docs/DEVELOPMENT.md) and [verification notes](VERIFICATION.md). Historical local artifact paths in those notes are not repository downloads.

Browser smoke tests use locally supplied microscopy data. Set `SCLERITE_TEST_DATA` to your MR0145 folder where required. Tests needing a prepared labeled project or native inference fixtures are separate from `npm test`.

## Repository layout

```text
src/                 Interface, segmentation, measurements and layout
src-tauri/src/       Native inference, model validation and training
src-tauri/models/    Model metadata and license notices (no weights)
src-tauri/icons/     Application logo and platform icons
scripts/            Development-only model export and verification
tests/              Unit tests and local browser workflows
docs/               Development history
```
