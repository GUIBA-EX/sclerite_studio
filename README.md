<p align="center">
  <img src="src-tauri/icons/128x128@2x.png" width="112" height="112" alt="Sclerite Studio logo" />
</p>
<h1 align="center">Sclerite Studio</h1>
<p align="center">骨针工作室 · 从光镜照片到可复核的骨针测量与分类</p>
<p align="center"><strong>0.12.3 · 中文 / English · Windows / macOS</strong></p>
<p align="center"><strong>简体中文</strong> · <a href="README.en.md">English</a></p>
<p align="center">
  <a href="https://github.com/GUIBA-EX/sclerite_studio/releases/download/v0.12.3/Sclerite-Studio-0.12.3-bilingual-DINOv3-mac-arm64.zip"><strong>下载 Mac 版</strong></a> ·
  <a href="https://github.com/GUIBA-EX/sclerite_studio/releases/download/v0.12.3/Sclerite-Studio-0.12.3-Windows-x64-portable.zip"><strong>下载 Windows 绿色版</strong></a> ·
  <a href="https://github.com/GUIBA-EX/sclerite_studio/releases/tag/v0.12.3">发行说明与 SHA-256</a>
</p>
<p align="center">Mac：Apple Silicon · macOS 14+ ｜ Windows：x64 · 需 WebView2 与 Visual C++ 运行库</p>

---

## 简介

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

源码仓库只存放源码、图标、测试与模型配置/许可文本，不包含研究照片、用户项目、训练缓存或权重文件。Release 应用包内嵌 MobileNetV4 与 DINOv3 权重，并随附相应许可；使用和再分发须遵守各自条款。自行构建 DINOv3 版本时须合法取得 Meta 权重。第三方许可见 [models](src-tauri/models/) 与 [runtime](src-tauri/runtime/)。本仓库没有额外授予一份未声明的开源许可证。

## 开发

前端：**React · TypeScript · Vite**。桌面：**Tauri 2 · Rust**。推理：**ONNX Runtime**；Windows 使用 CPU，Mac 的 MobileNet Core ML CPU/GPU 为实验功能。DINOv3 使用 CPU，不启用 NPU。

```sh
npm ci
npm test
npm run dev
```

浏览器支持图像处理、排版和标签整理；原生训练与预测需要桌面版。前端测试不依赖模型权重。

### 构建桌面版前准备模型

桌面程序嵌入 `src-tauri/models/encoder.onnx`，该权重不放入 Git。使用独立的 Python 开发环境导出 MobileNet 编码器：

```sh
python -m venv .venv
# 按操作系统激活该虚拟环境。
python -m pip install torch torchvision timm onnx onnxruntime numpy
python scripts/export_encoder.py
```

导出脚本对比 ONNX 与 PyTorch 输出，并记录版本、哈希及一致性结果。重新导出的权重可能具有不同哈希；若需兼容既有缓存与模型，不要替换发行版编码器。Python 仅为开发依赖，用户运行应用无需安装。

```sh
# Windows 绿色版构建：先安装 Rust MSVC 与 C++ 构建工具。
npm run build
cargo build --release --locked --manifest-path src-tauri/Cargo.toml
node scripts/package-windows.mjs

# macOS：先在 src-tauri/runtime 准备 ONNX Runtime 1.24.2。
npm run desktop:build -- --config src-tauri/tauri.macos.conf.json --bundles app
```

可选的 DINOv3 构建需要授权检查点、许可及 `scripts/export_dinov3.py` 生成的验证元数据，然后添加 `--features dinov3`。不要提交带签名的下载链接或个人授权信息。详见 [开发记录](docs/DEVELOPMENT.md) 和 [验证说明](VERIFICATION.md)；其中历史本地产物路径不是仓库下载地址。

浏览器冒烟测试使用本地提供的显微图像；按需将 `SCLERITE_TEST_DATA` 指向 MR0145 目录。需要标注项目或原生推理数据的测试独立于 `npm test`。

## 仓库结构

```text
src/                 界面、分割、测量与排版
src-tauri/src/       原生推理、模型验证与训练
src-tauri/models/    模型元数据与许可（不含权重）
src-tauri/icons/     应用 logo 与平台图标
scripts/            开发阶段模型导出与验证
tests/              单元测试与本地浏览器工作流
docs/               开发与运行说明
```
