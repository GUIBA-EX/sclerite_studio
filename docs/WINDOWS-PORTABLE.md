# Sclerite Studio 0.12.3 · Windows x64 绿色版

## 中文

解压完整文件夹，双击 `Sclerite-Studio.exe`。不要在压缩包内直接运行，不要遗漏 `DirectML.dll`。首次默认中文，右上角可切换 English。应用本身无需安装，但以下微软系统组件必须可用：

- x64 Windows 的 Microsoft Edge WebView2 Runtime：[官方下载](https://developer.microsoft.com/microsoft-edge/webview2/)。
- Microsoft Visual C++ x64 运行库：[微软安装程序](https://aka.ms/vc14/vc_redist.x64.exe)。若提示缺少 `MSVCP140.dll` 或 `VCRUNTIME140.dll`，请从微软安装；不要从不明 DLL 下载站补文件。

本应用使用 CPU 推理。DirectML.dll 是随 ONNX Runtime 预编译库附带的链接依赖，并不意味着应用已开启 GPU 或 NPU。模型权重嵌入 exe；具体编码器以分类页实际显示为准。

项目需要主动保存。恢复副本和模型缓存保存在 Windows 用户应用数据目录，因此这里的“绿色版”指免安装本应用，并非零系统依赖或零用户目录写入。版本升级时保留已保存的项目和模型包。

本地发布包未作 Windows 代码签名。请核对来源和 SHA256SUMS.txt；不要关闭系统安全保护。本轮完成 macOS→Windows x64 交叉编译、文件结构/依赖检查和前端回归测试，**没有 Windows 实机运行验收**，也没有在 Windows 上重新验证模型数值一致性。

分割和模型建议需人工复核；置信分数不是物种概率，软件测试不是生物学验证。

## English

Extract the whole folder and run `Sclerite-Studio.exe`. Keep `DirectML.dll` beside it. The app starts in Chinese; select English at the top right.

The application needs no installer, but Microsoft Edge WebView2 Runtime and the Microsoft Visual C++ x64 runtime must be available. Use only Microsoft installers linked above. CPU inference is used; the DirectML DLL is a dependency of the prebuilt ONNX Runtime, not an enabled GPU/NPU backend.

Model weights are embedded. Recovery and feature caches use the Windows user application-data directory, so this is not a zero-write portable environment. Save project files explicitly.

This local build is unsigned. Verify its source and SHA256SUMS.txt. Cross-compilation and frontend tests do not constitute Windows hardware or native-inference validation. All outputs require scientific review. Third-party model and runtime terms are provided in `licenses/`.
