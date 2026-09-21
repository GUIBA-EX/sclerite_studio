use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct LinearHead {
    pub weights: Vec<Vec<f32>>,
    pub bias: Vec<f32>,
    pub iterations: usize,
    pub converged: bool,
    pub loss: f64,
}

pub fn probabilities(weights: &[Vec<f32>], bias: &[f32], x: &[f32]) -> Vec<f64> {
    let mut p: Vec<f64> = weights
        .iter()
        .zip(bias)
        .map(|(w, b)| {
            w.iter()
                .zip(x)
                .map(|(a, b)| *a as f64 * *b as f64)
                .sum::<f64>()
                + *b as f64
        })
        .collect();
    let max = p.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    p.iter_mut().for_each(|v| *v = (*v - max).exp());
    let sum: f64 = p.iter().sum();
    p.iter_mut().for_each(|v| *v /= sum);
    p
}

pub fn balanced_weights(y: &[usize], groups: &[String], classes: usize) -> Vec<f64> {
    let mut counts = BTreeMap::new();
    let mut per_class = vec![BTreeSet::new(); classes];
    for (label, group) in y.iter().zip(groups) {
        *counts.entry((*label, group)).or_insert(0usize) += 1;
        per_class[*label].insert(group);
    }
    y.iter()
        .zip(groups)
        .map(|(k, g)| 1.0 / (classes * per_class[*k].len() * counts[&(*k, g)]) as f64)
        .collect()
}

fn objective(
    theta: &[f64],
    x: &[Vec<f32>],
    y: &[usize],
    sample_weights: &[f64],
    k: usize,
    lambda: f64,
) -> (f64, Vec<f64>) {
    let d = x[0].len();
    let mut grad = vec![0.0; theta.len()];
    let mut loss = 0.0;
    for ((row, &label), &weight) in x.iter().zip(y).zip(sample_weights) {
        let mut logits = vec![0.; k];
        for c in 0..k {
            let off = c * (d + 1);
            logits[c] = theta[off + d]
                + row
                    .iter()
                    .enumerate()
                    .map(|(j, v)| theta[off + j] * *v as f64)
                    .sum::<f64>();
        }
        let max = logits.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let sum: f64 = logits.iter().map(|v| (*v - max).exp()).sum();
        loss += weight * (max + sum.ln() - logits[label]);
        for c in 0..k {
            let diff =
                weight * ((logits[c] - max).exp() / sum - if c == label { 1.0 } else { 0.0 });
            let off = c * (d + 1);
            for j in 0..d {
                grad[off + j] += diff * row[j] as f64;
            }
            grad[off + d] += diff;
        }
    }
    for c in 0..k {
        for j in 0..d {
            let i = c * (d + 1) + j;
            loss += 0.5 * lambda * theta[i] * theta[i];
            grad[i] += lambda * theta[i];
        }
    }
    (loss, grad)
}

fn dot(a: &[f64], b: &[f64]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}

// 两环 L-BFGS + Armijo 回溯。优化器独立于 GUI，偏置不正则化。
pub fn train(
    x: &[Vec<f32>],
    y: &[usize],
    groups: &[String],
    k: usize,
    progress: impl FnMut(usize, f64) -> Result<(), String>,
) -> Result<LinearHead, String> {
    train_regularized(x, y, groups, k, 0.001, progress)
}

pub fn train_regularized(
    x: &[Vec<f32>],
    y: &[usize],
    groups: &[String],
    k: usize,
    lambda: f64,
    mut progress: impl FnMut(usize, f64) -> Result<(), String>,
) -> Result<LinearHead, String> {
    if ![0.0001, 0.001, 0.01].contains(&lambda) {
        return Err("不支持的正则强度".into());
    }
    if x.is_empty() || x.len() != y.len() || x.len() != groups.len() || k < 2 || k > 100 {
        return Err("训练数据尺寸无效".into());
    }
    let d = x[0].len();
    if d == 0
        || d > 4096
        || x.iter()
            .any(|v| v.len() != d || v.iter().any(|v| !v.is_finite()))
        || y.iter().any(|v| *v >= k)
        || (0..k).any(|v| !y.contains(&v))
    {
        return Err("训练特征或类别无效".into());
    }
    let weights = balanced_weights(y, groups, k);
    let mut theta = vec![0.; k * (d + 1)];
    let (mut loss, mut grad) = objective(&theta, x, y, &weights, k, lambda);
    let mut history: Vec<(Vec<f64>, Vec<f64>, f64)> = vec![];
    let mut converged = false;
    let mut iterations = 0;
    for iter in 0..200 {
        progress(iter, loss)?;
        if grad.iter().fold(0.0_f64, |m, v| m.max(v.abs())) < 1e-6 {
            converged = true;
            break;
        }
        let mut q = grad.clone();
        let mut alphas = vec![0.; history.len()];
        for (i, (s, v, rho)) in history.iter().enumerate().rev() {
            alphas[i] = rho * dot(s, &q);
            for j in 0..q.len() {
                q[j] -= alphas[i] * v[j];
            }
        }
        if let Some((s, v, _)) = history.last() {
            let scale = dot(s, v) / dot(v, v);
            q.iter_mut().for_each(|n| *n *= scale);
        }
        for (i, (s, v, rho)) in history.iter().enumerate() {
            let beta = rho * dot(v, &q);
            for j in 0..q.len() {
                q[j] += s[j] * (alphas[i] - beta);
            }
        }
        q.iter_mut().for_each(|n| *n = -*n);
        let mut slope = dot(&grad, &q);
        if !slope.is_finite() || slope >= 0. {
            q = grad.iter().map(|n| -*n).collect();
            slope = -dot(&grad, &grad);
            history.clear();
        }
        let mut step = 1.;
        let mut accepted = None;
        for _ in 0..32 {
            let trial: Vec<_> = theta.iter().zip(&q).map(|(a, b)| a + step * b).collect();
            let (new_loss, new_grad) = objective(&trial, x, y, &weights, k, lambda);
            if new_loss.is_finite() && new_loss <= loss + 1e-4 * step * slope {
                accepted = Some((trial, new_loss, new_grad));
                break;
            }
            step *= 0.5;
        }
        let Some((new_theta, new_loss, new_grad)) = accepted else {
            break;
        };
        let s: Vec<_> = new_theta.iter().zip(&theta).map(|(a, b)| a - b).collect();
        let v: Vec<_> = new_grad.iter().zip(&grad).map(|(a, b)| a - b).collect();
        let curvature = dot(&s, &v);
        if curvature > 1e-12 {
            if history.len() == 10 {
                history.remove(0);
            }
            history.push((s, v, 1. / curvature));
        }
        theta = new_theta;
        loss = new_loss;
        grad = new_grad;
        iterations = iter + 1;
    }
    progress(iterations, loss)?;
    let head = LinearHead {
        weights: (0..k)
            .map(|c| {
                theta[c * (d + 1)..c * (d + 1) + d]
                    .iter()
                    .map(|v| *v as f32)
                    .collect()
            })
            .collect(),
        bias: (0..k).map(|c| theta[c * (d + 1) + d] as f32).collect(),
        iterations,
        converged,
        loss,
    };
    // 保存为 FP32 前后对所有训练点检查分数，不静默接受精度漂移。
    for row in x {
        let logits: Vec<f64> = (0..k)
            .map(|c| {
                theta[c * (d + 1) + d]
                    + row
                        .iter()
                        .enumerate()
                        .map(|(j, v)| theta[c * (d + 1) + j] * *v as f64)
                        .sum::<f64>()
            })
            .collect();
        let max = logits.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let sum: f64 = logits.iter().map(|v| (*v - max).exp()).sum();
        let p = probabilities(&head.weights, &head.bias, row);
        if p.iter()
            .enumerate()
            .any(|(c, v)| (v - (logits[c] - max).exp() / sum).abs() > 1e-5)
        {
            return Err("FP32 导出一致性检查未通过".into());
        }
    }
    Ok(head)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn gradient_and_balancing() {
        let x = vec![vec![1., 0.], vec![0.8, 0.2], vec![0., 1.]];
        let y = vec![0, 0, 1];
        let groups = vec!["a".into(), "a".into(), "b".into()];
        let w = balanced_weights(&y, &groups, 2);
        assert_eq!(w, vec![0.25, 0.25, 0.5]);
        let t = vec![0.1, -0.2, 0.3, -0.1, 0.2, -0.3];
        let (_, g) = objective(&t, &x, &y, &w, 2, 0.001);
        for i in 0..t.len() {
            let mut a = t.clone();
            let mut b = t.clone();
            a[i] += 1e-6;
            b[i] -= 1e-6;
            let diff = (objective(&a, &x, &y, &w, 2, 0.001).0
                - objective(&b, &x, &y, &w, 2, 0.001).0)
                / 2e-6;
            assert!((diff - g[i]).abs() < 1e-7);
        }
        let head = train(&x, &y, &groups, 2, |_, _| Ok(())).unwrap();
        assert!(head.converged);
        assert!(probabilities(&head.weights, &head.bias, &x[0])[0] > 0.97);
        assert!(probabilities(&head.weights, &head.bias, &x[2])[1] > 0.97);
    }
    #[test]
    fn cancellation_is_not_a_model() {
        assert!(train(
            &[vec![1.], vec![-1.]],
            &[0, 1],
            &["a".into(), "b".into()],
            2,
            |_, _| Err("已取消".into())
        )
        .is_err());
    }
}
