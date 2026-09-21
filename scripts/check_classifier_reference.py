"""Compare native Rust preprocessing/ORT/head against independent Python implementations."""
import json
import sys
from pathlib import Path
import numpy as np
import onnxruntime as ort
from scipy.optimize import minimize
from scipy.special import logsumexp, softmax

root = Path(__file__).resolve().parents[1]
folder = Path(sys.argv[1])
report = json.loads((folder / "native-report.json").read_text())
rows = json.loads((folder / "crops.json").read_text())
x = np.array(report["features"], dtype=np.float64)
y = np.array(report["labels"])
n, d = x.shape
k = len(set(y))
sample_weights = np.array([1 / (k * sum(y == label)) for label in y])

def loss_grad(flat):
    theta = flat.reshape(k, d+1)
    logits = x @ theta[:, :d].T + theta[:, d]
    loss = np.sum(sample_weights * (logsumexp(logits, axis=1) - logits[np.arange(n), y]))
    loss += 0.0005 * np.sum(theta[:, :d]**2)
    diff = softmax(logits, axis=1)
    diff[np.arange(n), y] -= 1
    diff *= sample_weights[:, None]
    grad = np.column_stack((diff.T @ x + .001*theta[:, :d], diff.sum(axis=0)))
    return loss, grad.ravel()

result = minimize(loss_grad, np.zeros(k*(d+1)), jac=True, method="L-BFGS-B",
                  options=dict(maxiter=200, maxcor=10, gtol=1e-6, ftol=1e-12))
theta = result.x.reshape(k, d+1)
expected = softmax(x @ theta[:, :d].T + theta[:, d], axis=1)
head = report["head"]
actual = softmax(x @ np.array(head["weights"]).T + np.array(head["bias"]), axis=1)
score_error = float(np.max(np.abs(expected-actual)))
assert score_error < 1e-4, score_error
session = ort.InferenceSession(str(root / "src-tauri/models/encoder.onnx"), providers=["CPUExecutionProvider"])
feature_errors=[]
for i,row in enumerate(rows):
    tensor=np.fromfile(folder / (row["path"]+".tensor"), dtype="<f4").reshape(1,3,256,256)
    feature=session.run(None,{"image":tensor})[0].astype(np.float64).ravel()
    feature/=np.linalg.norm(feature)
    error=float(np.max(np.abs(feature-x[i])))
    assert error<2e-5, error
    feature_errors.append(error)
out=dict(engineering_only=True, score_tolerance=1e-4, max_score_error=score_error,
         feature_tolerance=2e-5,max_feature_error=max(feature_errors),
         scipy_converged=bool(result.success), reference_loss=float(result.fun),rust_loss=head["loss"],
         rust_runtime="1.24.2",python_runtime=ort.__version__)
(folder / "reference-check.json").write_text(json.dumps(out,indent=2)+"\n")
print(json.dumps(out,indent=2))
