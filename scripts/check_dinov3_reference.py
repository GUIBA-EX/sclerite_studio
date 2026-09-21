"""核对原生 Rust 产出的 DINOv3 特征与 Python ONNX Runtime 参考输出。"""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import onnxruntime as ort

parser = argparse.ArgumentParser()
parser.add_argument("--qa", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / "src-tauri/models/dinov3"
metadata = json.loads((root / "encoder.json").read_text())
assert ort.__version__ == metadata["onnxruntime"] == "1.24.2"
native = json.loads((args.qa / "dinov3-native-features.json").read_text())
assert native["crops"] >= 5
options = ort.SessionOptions()
options.intra_op_num_threads = 4
session = ort.InferenceSession(str(root / "encoder.onnx"), options, providers=["CPUExecutionProvider"])
errors = []
for row in native["rows"]:
    path = args.qa / (row["path"] + ".tensor")
    assert hashlib.sha256(path.read_bytes()).hexdigest() in metadata["fixture_hashes"]
    x = np.fromfile(path, dtype="<f4").reshape(1, 3, 256, 256)
    expected = session.run(None, {"image": x})[0][0].astype(np.float64)
    expected = (expected / np.linalg.norm(expected)).astype(np.float32)
    actual = np.array(row["features"], dtype=np.float32)
    np.testing.assert_allclose(actual, expected, rtol=1e-5, atol=1e-6)
    errors.append(float(np.max(np.abs(expected - actual))))
report = {k:v for k,v in native.items() if k != "rows"}
report.update(reference="Python ONNX Runtime 1.24.2 CPU", native_max_error=max(errors),
              pytorch_onnx_max_error=max(metadata["normalized_max_errors"]),
              encoder_sha256=metadata["sha256"], passed=True, engineering_only=True)
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
