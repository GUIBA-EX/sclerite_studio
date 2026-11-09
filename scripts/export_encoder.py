"""Development only: export the pinned frozen encoder and verify CPU parity."""
import hashlib
import json
import argparse
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "src-tauri/models"
OUT.mkdir(parents=True, exist_ok=True)
parser = argparse.ArgumentParser()
parser.add_argument("--verify-only", action="store_true")
args = parser.parse_args()
target = OUT / "encoder.onnx"
metadata_path = OUT / "encoder.json"
if args.verify_only:
    metadata = json.loads(metadata_path.read_text())
    if hashlib.sha256(target.read_bytes()).hexdigest() != metadata["sha256"]:
        raise SystemExit("编码器哈希不符，停止验证")
elif target.exists():
    raise SystemExit("编码器已存在，拒绝覆盖")

import numpy as np
import onnx
import onnxruntime as ort
import timm
import torch
torch.manual_seed(20260922)
torch.set_num_threads(4)
name = "mobilenetv4_conv_small.e2400_r224_in1k"
model = timm.create_model(name, pretrained=True, num_classes=0).eval()
x = torch.randn(1, 3, 256, 256)
if not args.verify_only:
    torch.onnx.export(model, x, target, input_names=["image"], output_names=["features"],
                      opset_version=18, dynamo=False)
onnx.checker.check_model(str(target))
session = ort.InferenceSession(str(target), providers=["CPUExecutionProvider"])
errors = []
with torch.no_grad():
    for _ in range(5):
        x = torch.randn(1, 3, 256, 256)
        expected = model(x).numpy()
        actual = session.run(None, {"image": x.numpy()})[0]
        assert actual.shape == (1, 1280)
        error = float(np.max(np.abs(expected - actual)))
        assert np.allclose(expected, actual, atol=2e-4, rtol=2e-4), error
        errors.append(error)
if not args.verify_only:
    metadata = dict(model=name, sha256=hashlib.sha256(target.read_bytes()).hexdigest(),
                input=[1, 3, 256, 256], output=[1, 1280], opset=18,
                torch=torch.__version__, timm=timm.__version__,
                onnx=onnx.__version__, onnxruntime=ort.__version__,
                max_absolute_errors=errors, parity_tolerance=dict(atol=2e-4, rtol=2e-4))
else:
    metadata.update(onnxruntime=ort.__version__, max_absolute_errors=errors)
metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")
print(json.dumps(metadata, indent=2))
