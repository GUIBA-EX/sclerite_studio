"""开发工具：从已获授权的本地 checkpoint 导出，不下载权重、不接受远程代码。

输入 .tensor 必须来自 classifier_check 的 Rust 预处理输出。
ONNX Runtime 必须与 Studio 一致；Python 不随应用分发。
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tempfile
import subprocess
import sys

META_REVISION = "6876159a11b4df116f30f667f8c9888617df0751"
META_WEIGHT_SHA256 = "08c60483bc63c04f533611e34bf70b120eedb7240f469bc16e9e20bf344b941d"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--tensors", type=Path, required=True)
    parser.add_argument("--license", type=Path, required=True)
    parser.add_argument("--meta-repo", type=Path, help="已审阅的 Meta 官方本地源码，加载原始 .pth 时必需")
    args = parser.parse_args()
    import numpy as np
    import onnx
    import onnxruntime as ort
    import torch
    torch.manual_seed(20260922)
    torch.set_num_threads(4)
    if ort.__version__ != "1.24.2":
        raise RuntimeError("请在独立导出环境安装 onnxruntime==1.24.2，与 Studio 对齐")
    fixtures = sorted(args.tensors.glob("*.tensor"))
    if len(fixtures) < 5:
        raise RuntimeError("至少需要 5 枚真实骨针的 Rust .tensor 输入")
    license_text = args.license.read_text()
    if "DINOv3" not in license_text or len(license_text) < 100:
        raise RuntimeError("请提供官方 DINOv3 完整许可")
    out = Path(__file__).resolve().parents[1] / "src-tauri/models/dinov3"
    if out.exists():
        raise RuntimeError("输出目录已存在；请先审阅并自行备份，工具不会覆盖")
    meta_format = args.checkpoint.is_file()
    provenance = {}
    if meta_format:
        if args.meta_repo is None:
            raise RuntimeError("原始 .pth 需要 --meta-repo 指定已审阅的官方实现")
        checkpoint_hash = hashlib.sha256(args.checkpoint.read_bytes()).hexdigest()
        if checkpoint_hash != META_WEIGHT_SHA256:
            raise RuntimeError("权重不是已验证的官方 ViT-S/16 LVD-1689M 文件")
        revision = subprocess.check_output(["git", "-C", str(args.meta_repo), "rev-parse", "HEAD"], text=True).strip()
        if revision != META_REVISION:
            raise RuntimeError("官方实现版本不符，需要重新审阅和验证")
        if subprocess.check_output(["git", "-C", str(args.meta_repo), "status", "--porcelain"], text=True).strip():
            raise RuntimeError("官方实现存在本地修改，拒绝使用")
        if args.license.read_bytes() != (args.meta_repo / "LICENSE.md").read_bytes():
            raise RuntimeError("必须保留官方完整许可")
        sys.path.insert(0, str(args.meta_repo.resolve()))
        from dinov3.hub.backbones import dinov3_vits16
        backbone = dinov3_vits16(pretrained=False)
        state = torch.load(args.checkpoint, map_location="cpu", weights_only=True)
        backbone.load_state_dict(state, strict=True)
        provenance = dict(source_format="meta-pth", checkpoint_sha256=checkpoint_hash,
                          reference_repository="https://github.com/facebookresearch/dinov3",
                          reference_revision=revision)
    else:
        from transformers import AutoModel
        backbone = AutoModel.from_pretrained(str(args.checkpoint.resolve()), local_files_only=True,
                                             trust_remote_code=False, attn_implementation="eager")
        config = backbone.config
        if (config.hidden_size, config.patch_size, config.num_hidden_layers) != (384, 16, 12):
            raise RuntimeError("仅支持 DINOv3 ViT-S/16")
        if config.model_type != "dinov3_vit":
            raise RuntimeError("不是 DINOv3 ViT checkpoint")
        provenance = dict(source_format="huggingface-local")

    class Encoder(torch.nn.Module):
        def __init__(self):
            super().__init__()
            self.backbone = backbone

        def forward(self, image):
            if meta_format:
                return self.backbone.forward_features(image)["x_norm_clstoken"]
            return self.backbone(pixel_values=image).last_hidden_state[:, 0, :]

    model = Encoder().float().cpu().eval().requires_grad_(False)
    with tempfile.TemporaryDirectory(prefix="dinov3-export-", dir=out.parent) as scratch:
        stage = Path(scratch)
        target = stage / "encoder.onnx"
        torch.onnx.export(model, torch.randn(1, 3, 256, 256), str(target),
                          input_names=["image"], output_names=["features"],
                          opset_version=18, dynamo=False)
        graph = onnx.load(str(target), load_external_data=False)
        if any(t.data_location == onnx.TensorProto.EXTERNAL for t in graph.graph.initializer):
            raise RuntimeError("模型必须为单文件，不能引用外部权重")
        onnx.checker.check_model(graph)
        options = ort.SessionOptions()
        options.intra_op_num_threads = 4
        session = ort.InferenceSession(str(target), options, providers=["CPUExecutionProvider"])
        errors = []
        with torch.inference_mode():
            for path in fixtures:
                x = np.fromfile(path, dtype="<f4").reshape(1, 3, 256, 256)
                expected = model(torch.from_numpy(x.copy())).numpy()
                actual = session.run(None, {"image": x})[0]
                if actual.shape != (1, 384) or not np.isfinite(actual).all():
                    raise RuntimeError("输出尺寸或数值无效")
                np.testing.assert_allclose(actual, expected, atol=2e-4, rtol=2e-4)
                for values in [expected, actual]:
                    if np.linalg.norm(values) < 1e-12:
                        raise RuntimeError("输出零向量")
                normalized_error = float(np.max(np.abs(actual / np.linalg.norm(actual) - expected / np.linalg.norm(expected))))
                if normalized_error > 2e-4:
                    raise RuntimeError("归一化后的特征误差超标")
                errors.append(normalized_error)
        metadata = dict(model="facebook/dinov3-vits16-pretrain-lvd1689m",
                        sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                        input=[1, 3, 256, 256], output=[1, 384], opset=18,
                        onnxruntime=ort.__version__, torch=torch.__version__,
                        real_crop_count=len(fixtures), parity_passed=True,
                        normalized_max_errors=errors,
                        fixture_hashes=[hashlib.sha256(p.read_bytes()).hexdigest() for p in fixtures],
                        preprocessing="rgb-mask-gray128-pad5-triangle256-nchw-imagenet-l2/v1",
                        coreml_verified=False)
        metadata.update(provenance)
        (stage / "encoder.json").write_text(json.dumps(metadata, indent=2) + "\n")
        (stage / "LICENSE.txt").write_text(license_text)
        shutil.copytree(stage, out)
        print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()
