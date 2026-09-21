use crate::classifier_math::{self, LinearHead};
use crate::encoders::{self, default_encoder, Encoder};
use image::{imageops::FilterType, Rgb, RgbImage};
use ort::{session::Session, value::Tensor};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Emitter, Manager,
};

pub const ENCODER: &[u8] = include_bytes!("../models/encoder.onnx");
pub use crate::encoders::PREPROCESS;
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Default)]
pub struct ClassifierState {
    session: Mutex<Option<(String, Session)>>,
    busy: AtomicBool,
    cancel: AtomicBool,
}
struct Guard<'a>(&'a AtomicBool);
impl Drop for Guard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl ClassifierState {
    fn enter(&self) -> Result<Guard<'_>, String> {
        self.busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "分类任务正在运行".to_string())?;
        Ok(Guard(&self.busy))
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Category {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Sample {
    pub key: String,
    pub object: String,
    pub source: String,
    pub label: String,
    pub group: String,
    pub partition: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Metrics {
    pub count: usize,
    pub groups: usize,
    pub macro_f1: f64,
    pub confusion: Vec<Vec<usize>>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Model {
    #[serde(default = "default_encoder")]
    pub encoder: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub regularization: Option<Regularization>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset_signature: Option<String>,
    pub schema: String,
    pub id: String,
    pub created: u64,
    pub task: String,
    pub classes: Vec<Category>,
    pub encoder_hash: String,
    pub preprocessing: String,
    pub backend: String,
    pub head: LinearHead,
    pub formal: bool,
    pub samples: Vec<Sample>,
    pub evaluation: BTreeMap<String, Metrics>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct TrainRequest {
    #[serde(default = "default_encoder")]
    pub encoder: String,
    #[serde(default)]
    pub auto_regularization: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dataset_signature: Option<String>,
    pub task: String,
    pub classes: Vec<Category>,
    pub samples: Vec<Sample>,
    pub formal: bool,
    pub backend: String,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Regularization {
    pub lambda: f64,
    pub selected_on: String,
    pub candidates: Vec<RegularizationCandidate>,
}
#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct RegularizationCandidate {
    pub lambda: f64,
    pub validation_macro_f1: f64,
    pub converged: bool,
}
#[derive(Serialize)]
pub struct FeatureResult {
    key: String,
    cached: bool,
}
#[derive(Clone, Serialize)]
struct Progress {
    phase: String,
    completed: usize,
    total: usize,
}

fn data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let p = app
        .path()
        .app_data_dir()
        .map_err(err)?
        .join("classification");
    fs::create_dir_all(&p).map_err(err)?;
    Ok(p)
}
fn cache_dir(app: &tauri::AppHandle, encoder: &Encoder) -> Result<PathBuf, String> {
    let mut p = app.path().app_cache_dir().map_err(err)?.join("features-v1");
    // MobileNet 旧缓存原位复用；其他编码器不可读取这一目录。
    if encoder.id != encoders::MOBILE {
        p = p.join(encoder.hash());
    }
    fs::create_dir_all(&p).map_err(err)?;
    Ok(p)
}
fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension("partial");
    let mut f = fs::File::create(&temp).map_err(err)?;
    f.write_all(bytes).map_err(err)?;
    f.sync_all().map_err(err)?;
    fs::rename(temp, path).map_err(err)
}

// 包体为 LE u32 width,height + 原分辨率 RGBA。alpha 是实例 mask，不经过浏览器缩放。
pub fn preprocess(packet: &[u8]) -> Result<Vec<f32>, String> {
    if packet.len() < 12 || packet.len() > 48_000_008 {
        return Err("裁剪数据大小无效".into());
    }
    let w = u32::from_le_bytes(packet[0..4].try_into().unwrap());
    let h = u32::from_le_bytes(packet[4..8].try_into().unwrap());
    if w == 0
        || h == 0
        || w > 12000
        || h > 12000
        || w as u64 * h as u64 > 12_000_000
        || packet.len() != 8 + w as usize * h as usize * 4
    {
        return Err("裁剪尺寸无效".into());
    }
    let pad = ((w.max(h) as f64) * 0.05).ceil() as u32;
    let mut padded = RgbImage::from_pixel(w + 2 * pad, h + 2 * pad, Rgb([128, 128, 128]));
    let mut foreground = 0;
    for y in 0..h {
        for x in 0..w {
            let i = 8 + ((y * w + x) * 4) as usize;
            if packet[i + 3] == 255 {
                padded.put_pixel(
                    x + pad,
                    y + pad,
                    Rgb([packet[i], packet[i + 1], packet[i + 2]]),
                );
                foreground += 1;
            } else if packet[i + 3] != 0 {
                return Err("mask 必须为二值".into());
            }
        }
    }
    if foreground == 0 {
        return Err("空 mask 不能分类".into());
    }
    let scale = 256.0 / padded.width().max(padded.height()) as f64;
    let rw = (padded.width() as f64 * scale).round().max(1.) as u32;
    let rh = (padded.height() as f64 * scale).round().max(1.) as u32;
    let resized = image::imageops::resize(&padded, rw, rh, FilterType::Triangle);
    let mut canvas = RgbImage::from_pixel(256, 256, Rgb([128, 128, 128]));
    image::imageops::replace(
        &mut canvas,
        &resized,
        ((256 - rw) / 2) as i64,
        ((256 - rh) / 2) as i64,
    );
    let mean = [0.485_f32, 0.456, 0.406];
    let std = [0.229_f32, 0.224, 0.225];
    let mut out = vec![0.; 3 * 256 * 256];
    for (i, p) in canvas.pixels().enumerate() {
        for c in 0..3 {
            out[c * 65536 + i] = (p[c] as f32 / 255. - mean[c]) / std[c];
        }
    }
    Ok(out)
}

pub fn make_session(backend: &str, cache: &Path) -> Result<Session, String> {
    make_encoder_session(backend, cache, encoders::get(encoders::MOBILE)?)
}
pub fn make_encoder_session(
    backend: &str,
    cache: &Path,
    encoder: &Encoder,
) -> Result<Session, String> {
    if backend == "coreml" && encoder.id == encoders::DINO {
        return Err("DINOv3 的 Core ML 路径尚未验证，请使用 CPU".into());
    }
    let mut builder = Session::builder()
        .map_err(err)?
        .with_intra_threads(4)
        .map_err(err)?;
    match backend {
        "cpu" => {}
        "coreml" => {
            #[cfg(target_os = "macos")]
            {
                use ort::ep::{
                    coreml::{ComputeUnits, ModelFormat},
                    CoreML,
                };
                let path = cache.join(encoder.hash());
                fs::create_dir_all(&path).map_err(err)?;
                builder = builder
                    .with_execution_providers([CoreML::default()
                        .with_compute_units(ComputeUnits::CPUAndGPU)
                        .with_model_format(ModelFormat::MLProgram)
                        .with_static_input_shapes(true)
                        .with_model_cache_dir(path.to_string_lossy())
                        .build()
                        .error_on_failure()])
                    .map_err(err)?;
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = cache;
                return Err("此平台仅支持 CPU".into());
            }
        }
        _ => return Err("不支持的计算后端".into()),
    }
    builder.commit_from_memory(encoder.bytes).map_err(err)
}

pub fn encode(session: &mut Session, tensor: Vec<f32>) -> Result<Vec<f32>, String> {
    encode_dimension(session, tensor, 1280)
}
pub fn encode_dimension(
    session: &mut Session,
    tensor: Vec<f32>,
    dim: usize,
) -> Result<Vec<f32>, String> {
    let input = Tensor::from_array(([1usize, 3, 256, 256], tensor)).map_err(err)?;
    let output = session.run(ort::inputs![input]).map_err(err)?;
    let (shape, values) = output[0].try_extract_tensor::<f32>().map_err(err)?;
    if shape.as_ref() != [1, dim as i64] || values.iter().any(|v| !v.is_finite()) {
        return Err("编码器输出无效".into());
    }
    let norm = values
        .iter()
        .map(|v| (*v as f64).powi(2))
        .sum::<f64>()
        .sqrt();
    if norm < 1e-12 {
        return Err("编码器输出零向量".into());
    }
    Ok(values.iter().map(|v| (*v as f64 / norm) as f32).collect())
}

fn valid_key(key: &str) -> bool {
    key.len() == 64 && key.bytes().all(|c| c.is_ascii_hexdigit())
}
fn read_feature(dir: &Path, key: &str, dim: usize) -> Result<Vec<f32>, String> {
    if !valid_key(key) {
        return Err("特征缓存键无效".into());
    }
    let b = fs::read(dir.join(format!("{key}.bin")))
        .map_err(|_| "特征缓存缺失，请重新提取".to_string())?;
    if b.len() != dim * 4 {
        return Err("特征缓存损坏".into());
    }
    let v: Vec<_> = b
        .chunks_exact(4)
        .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
        .collect();
    let norm = v.iter().map(|v| (*v as f64).powi(2)).sum::<f64>();
    if v.iter().any(|v| !v.is_finite()) || (norm - 1.).abs() > 1e-4 {
        return Err("特征缓存数值无效".into());
    }
    Ok(v)
}

#[tauri::command]
pub async fn classifier_feature(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<FeatureResult, String> {
    let encoder = encoders::get(
        request
            .headers()
            .get("x-sclerite-encoder")
            .and_then(|s| s.to_str().ok())
            .unwrap_or(encoders::MOBILE),
    )?;
    let backend = request
        .headers()
        .get("x-sclerite-backend")
        .and_then(|s| s.to_str().ok())
        .unwrap_or("cpu")
        .to_string();
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("需要二进制裁剪数据".into());
    };
    if bytes.len() > 48_000_008 {
        return Err("裁剪过大".into());
    }
    let bytes = bytes.clone();
    if !["cpu", "coreml"].contains(&backend.as_str()) {
        return Err("不支持的计算后端".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ClassifierState>();
        let _guard = state.enter()?;
        let key = encoder.key(&backend, &bytes);
        let dir = cache_dir(&app, encoder)?;
        if read_feature(&dir, &key, encoder.dim).is_ok() {
            return Ok(FeatureResult { key, cached: true });
        }
        let tensor = preprocess(&bytes)?;
        let mut lock = state.session.lock().map_err(err)?;
        let session_id = format!("{}:{backend}", encoder.hash());
        if lock.as_ref().map(|s| s.0.as_str()) != Some(session_id.as_str()) {
            *lock = Some((
                session_id,
                make_encoder_session(&backend, &dir.join("coreml"), encoder)?,
            ));
        }
        let feature = encode_dimension(&mut lock.as_mut().unwrap().1, tensor, encoder.dim)?;
        let data: Vec<u8> = feature.iter().flat_map(|v| v.to_le_bytes()).collect();
        atomic_write(&dir.join(format!("{key}.bin")), &data)?;
        Ok(FeatureResult { key, cached: false })
    })
    .await
    .map_err(err)?
}

fn validate_classes(classes: &[Category], task: &str) -> Result<(), String> {
    if !["morphotype", "species"].contains(&task) || classes.len() < 2 || classes.len() > 100 {
        return Err("请选择单一任务且至少两个类别".into());
    }
    let mut ids = BTreeSet::new();
    let mut names = BTreeSet::new();
    for c in classes {
        if c.id.is_empty()
            || c.id.len() > 100
            || c.name.trim().is_empty()
            || c.name.len() > 240
            || !ids.insert(&c.id)
            || !names.insert(c.name.trim())
        {
            return Err("类别 ID 或名称重复／无效".into());
        }
    }
    Ok(())
}

fn validate_samples(r: &TrainRequest) -> Result<(), String> {
    encoders::get(&r.encoder)?;
    if r.auto_regularization && !r.formal {
        return Err("自动选择正则强度需要独立验证集；试用模型使用固定值".into());
    }
    if r.dataset_signature.as_ref().is_some_and(|s| !valid_key(s)) {
        return Err("训练数据快照无效".into());
    }
    validate_classes(&r.classes, &r.task)?;
    if r.samples.len() < 2
        || r.samples.len() > 20000
        || !["cpu", "coreml"].contains(&r.backend.as_str())
    {
        return Err("训练规模或后端无效".into());
    }
    let mut groups = BTreeMap::new();
    let mut sources = BTreeMap::new();
    let mut objects = BTreeSet::new();
    let mut keys = BTreeSet::new();
    for s in &r.samples {
        if !valid_key(&s.key)
            || !valid_key(&s.source)
            || s.object.is_empty()
            || s.object.len() > 200
            || s.group.is_empty()
            || s.group.len() > 240
            || !r.classes.iter().any(|c| c.id == s.label)
            || !["train", "validation", "test"].contains(&s.partition.as_str())
        {
            return Err("训练标签或来源不完整".into());
        }
        if !objects.insert(&s.object) || !keys.insert(&s.key) {
            return Err("同一骨针／重复裁剪不能重复进入训练清单".into());
        }
        for (map, key) in [(&mut groups, &s.group), (&mut sources, &s.source)] {
            if map
                .insert(key, &s.partition)
                .is_some_and(|p| p != &s.partition)
            {
                return Err("同一标本或重复原图跨越数据分区，已阻止训练".into());
            }
        }
    }
    for c in &r.classes {
        for partition in if r.formal {
            vec!["train", "validation", "test"]
        } else {
            vec!["train"]
        } {
            if !r
                .samples
                .iter()
                .any(|s| s.label == c.id && s.partition == partition)
            {
                return Err(format!("{} 在 {} 中没有独立数据", c.name, partition));
            }
        }
    }
    if !r.formal && r.samples.iter().any(|s| s.partition != "train") {
        return Err("试用模型仅接受训练区，不得误用测试材料".into());
    }
    Ok(())
}

fn metrics(
    head: &LinearHead,
    rows: &[(Sample, Vec<f32>)],
    classes: &[Category],
    part: &str,
) -> Metrics {
    let k = classes.len();
    let mut confusion = vec![vec![0; k]; k];
    let mut count = 0;
    let mut groups = BTreeSet::new();
    for (s, x) in rows.iter().filter(|(s, _)| s.partition == part) {
        let truth = classes.iter().position(|c| c.id == s.label).unwrap();
        let p = classifier_math::probabilities(&head.weights, &head.bias, x);
        let pred = p
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.total_cmp(b.1))
            .unwrap()
            .0;
        confusion[truth][pred] += 1;
        count += 1;
        groups.insert(&s.group);
    }
    let macro_f1 = (0..k)
        .map(|c| {
            let tp = confusion[c][c] as f64;
            let total = (confusion[c].iter().sum::<usize>()
                + (0..k).map(|r| confusion[r][c]).sum::<usize>()) as f64;
            if total > 0. {
                2. * tp / total
            } else {
                0.
            }
        })
        .sum::<f64>()
        / k as f64;
    Metrics {
        count,
        groups: groups.len(),
        macro_f1,
        confusion,
    }
}

pub fn validate_model(model: &Model) -> Result<(), String> {
    let encoder = encoders::get(&model.encoder)?;
    if model.schema != "sclerite-classifier/1"
        || model.encoder_hash != encoder.hash()
        || model.preprocessing != PREPROCESS
        || model.id.is_empty()
        || model.id.len() > 100
    {
        return Err("模型版本、编码器或预处理不兼容".into());
    }
    validate_samples(&TrainRequest {
        encoder: model.encoder.clone(),
        auto_regularization: false,
        dataset_signature: model.dataset_signature.clone(),
        task: model.task.clone(),
        classes: model.classes.clone(),
        samples: model.samples.clone(),
        formal: model.formal,
        backend: model.backend.clone(),
    })?;
    let k = model.classes.len();
    let h = &model.head;
    if h.weights.len() != k
        || h.bias.len() != k
        || h.weights
            .iter()
            .any(|w| w.len() != encoder.dim || w.iter().any(|v| !v.is_finite() || v.abs() > 1e6))
        || h.bias.iter().any(|v| !v.is_finite() || v.abs() > 1e6)
        || !h.loss.is_finite()
    {
        return Err("分类权重无效".into());
    }
    for m in model.evaluation.values() {
        if !m.macro_f1.is_finite()
            || !(0.0..=1.0).contains(&m.macro_f1)
            || m.confusion.len() != k
            || m.confusion.iter().any(|r| r.len() != k)
        {
            return Err("评估记录无效".into());
        }
    }
    if let Some(r) = &model.regularization {
        if ![0.0001, 0.001, 0.01].contains(&r.lambda)
            || !["fixed", "validation"].contains(&r.selected_on.as_str())
            || (r.selected_on == "validation"
                && (!model.formal
                    || r.candidates.len() != 3
                    || !r
                        .candidates
                        .iter()
                        .any(|c| c.lambda == r.lambda && c.converged)))
            || (r.selected_on == "fixed" && (r.lambda != 0.001 || !r.candidates.is_empty()))
            || r.candidates.iter().any(|c| {
                ![0.0001, 0.001, 0.01].contains(&c.lambda)
                    || !c.validation_macro_f1.is_finite()
                    || !(0.0..=1.0).contains(&c.validation_macro_f1)
            })
        {
            return Err("正则选择记录无效".into());
        }
    }
    Ok(())
}

fn fit_rows(
    rows: &[(Sample, Vec<f32>)],
    classes: &[Category],
    auto: bool,
    mut progress: impl FnMut(usize, usize) -> Result<(), String>,
) -> Result<(LinearHead, Regularization), String> {
    let train: Vec<_> = rows
        .iter()
        .filter(|(s, _)| s.partition == "train")
        .collect();
    let x: Vec<_> = train.iter().map(|(_, x)| x.clone()).collect();
    let y: Vec<_> = train
        .iter()
        .map(|(s, _)| {
            classes
                .iter()
                .position(|c| c.id == s.label)
                .ok_or_else(|| "类别无效".to_string())
        })
        .collect::<Result<_, _>>()?;
    let groups: Vec<_> = train.iter().map(|(s, _)| s.group.clone()).collect();
    if auto
        && !classes.iter().all(|c| {
            rows.iter()
                .any(|(s, _)| s.partition == "validation" && s.label == c.id)
        })
    {
        return Err("验证集必须包含每个类别".into());
    }
    // 同分优先较强正则。选择过程完全不读取测试集分数。
    let grid: &[f64] = if auto {
        &[0.01, 0.001, 0.0001]
    } else {
        &[0.001]
    };
    let mut best: Option<(LinearHead, f64, f64)> = None;
    let mut candidates = Vec::new();
    for (i, &lambda) in grid.iter().enumerate() {
        let head = classifier_math::train_regularized(
            &x,
            &y,
            &groups,
            classes.len(),
            lambda,
            |iteration, _| progress(i * 200 + iteration, grid.len() * 200),
        )?;
        let score = if auto {
            metrics(&head, rows, classes, "validation").macro_f1
        } else {
            0.
        };
        if auto {
            candidates.push(RegularizationCandidate {
                lambda,
                validation_macro_f1: score,
                converged: head.converged,
            });
        }
        if (!auto || head.converged) && best.as_ref().map_or(true, |b| score > b.2 + 1e-12) {
            best = Some((head, lambda, score));
        }
    }
    let (head, lambda, _) = best.ok_or("候选分类器均未收敛，请检查训练数据；旧模型未改变")?;
    Ok((
        head,
        Regularization {
            lambda,
            selected_on: if auto { "validation" } else { "fixed" }.into(),
            candidates,
        },
    ))
}

fn model_path(app: &tauri::AppHandle, encoder: &str, task: &str) -> Result<PathBuf, String> {
    encoders::get(encoder)?;
    if !["morphotype", "species"].contains(&task) {
        return Err("分类任务无效".into());
    }
    Ok(data_dir(app)?.join(format!("{encoder}-{task}.json")))
}
fn save_model(app: &tauri::AppHandle, model: &Model) -> Result<(), String> {
    let bytes = serde_json::to_vec(model).map_err(err)?;
    atomic_write(&model_path(app, &model.encoder, &model.task)?, &bytes)?;
    atomic_write(&data_dir(app)?.join("latest.json"), &bytes)
}

#[tauri::command]
pub async fn classifier_train(app: tauri::AppHandle, data: TrainRequest) -> Result<Model, String> {
    validate_samples(&data)?;
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ClassifierState>();
        let _guard = state.enter()?;
        state.cancel.store(false, Ordering::SeqCst);
        let encoder = encoders::get(&data.encoder)?;
        let mut previous_paths = vec![data_dir(&app)?.join("latest.json")];
        for id in [encoders::MOBILE, encoders::DINO] {
            if encoders::get(id).is_ok() {
                previous_paths.push(model_path(&app, id, &data.task)?);
            }
        }
        for previous in previous_paths.into_iter().filter(|p| p.exists()) {
            let old: Model =
                serde_json::from_slice(&fs::read(previous).map_err(err)?).map_err(err)?;
            if old.formal && old.task == data.task {
                let protected: Vec<_> = old
                    .samples
                    .iter()
                    .filter(|s| s.partition == "test")
                    .collect();
                if data.samples.iter().any(|s| {
                    s.partition != "test"
                        && protected.iter().any(|p| {
                            p.source == s.source || p.group == s.group || p.object == s.object
                        })
                }) {
                    return Err("锁定测试标本不得转入训练或验证".into());
                }
            }
        }
        let dir = cache_dir(&app, encoder)?;
        let rows: Vec<_> = data
            .samples
            .iter()
            .map(|s| Ok((s.clone(), read_feature(&dir, &s.key, encoder.dim)?)))
            .collect::<Result<_, String>>()?;
        let mut last = Instant::now();
        let (head, regularization) = fit_rows(
            &rows,
            &data.classes,
            data.auto_regularization,
            |iteration, total| {
                if state.cancel.load(Ordering::SeqCst) {
                    return Err("已取消；旧模型未改变".into());
                }
                if last.elapsed().as_millis() > 120 || iteration == 0 {
                    let _ = app.emit(
                        "classifier-progress",
                        Progress {
                            phase: if data.auto_regularization {
                                "验证集选择正则强度"
                            } else {
                                "训练分类层"
                            }
                            .into(),
                            completed: iteration,
                            total,
                        },
                    );
                    last = Instant::now();
                }
                Ok(())
            },
        )?;
        let mut evaluation = BTreeMap::new();
        if data.formal {
            for part in ["validation", "test"] {
                evaluation.insert(part.into(), metrics(&head, &rows, &data.classes, part));
            }
        }
        let created = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(err)?
            .as_secs();
        let id = hash(&serde_json::to_vec(&(&head, &data, created)).map_err(err)?);
        let model = Model {
            encoder: data.encoder,
            regularization: Some(regularization),
            dataset_signature: data.dataset_signature,
            schema: "sclerite-classifier/1".into(),
            id,
            created,
            task: data.task,
            classes: data.classes,
            encoder_hash: encoder.hash().into(),
            preprocessing: PREPROCESS.into(),
            backend: data.backend,
            head,
            formal: data.formal,
            samples: data.samples,
            evaluation,
        };
        validate_model(&model)?;
        if state.cancel.load(Ordering::SeqCst) {
            return Err("已取消；旧模型未改变".into());
        }
        save_model(&app, &model)?;
        Ok(model)
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub fn classifier_cancel(state: tauri::State<ClassifierState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub async fn classifier_current(
    app: tauri::AppHandle,
    encoder: Option<String>,
    task: Option<String>,
) -> Result<Option<Model>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let latest = data_dir(&app)?.join("latest.json");
        let selected = match (&encoder, &task) {
            (Some(e), Some(t)) => Some(model_path(&app, e, t)?),
            (None, None) => None,
            _ => return Err("读取模型需要同时指定特征模型与任务".into()),
        };
        let path = selected.filter(|p| p.exists()).unwrap_or(latest);
        if !path.exists() {
            return Ok(None);
        }
        if fs::metadata(&path).map_err(err)?.len() > 20_000_000 {
            return Err("模型元数据过大".into());
        }
        let model: Model = serde_json::from_slice(&fs::read(path).map_err(err)?).map_err(err)?;
        validate_model(&model)?;
        if encoder.as_ref().is_some_and(|e| e != &model.encoder)
            || task.as_ref().is_some_and(|t| t != &model.task)
        {
            return Ok(None);
        }
        Ok(Some(model))
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn classifier_predict(
    app: tauri::AppHandle,
    model: Model,
    keys: Vec<String>,
) -> Result<Vec<Vec<f64>>, String> {
    validate_model(&model)?;
    if keys.len() > 20000 {
        return Err("单批最多 20000 枚".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ClassifierState>();
        let _guard = state.enter()?;
        let encoder = encoders::get(&model.encoder)?;
        let dir = cache_dir(&app, encoder)?;
        keys.iter()
            .map(|key| {
                Ok(classifier_math::probabilities(
                    &model.head.weights,
                    &model.head.bias,
                    &read_feature(&dir, key, encoder.dim)?,
                ))
            })
            .collect()
    })
    .await
    .map_err(err)?
}

pub fn package(model: &Model) -> Result<Vec<u8>, String> {
    validate_model(model)?;
    let encoder = encoders::get(&model.encoder)?;
    let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
    let json = serde_json::to_vec_pretty(model).map_err(err)?;
    let manifest=serde_json::to_vec(&serde_json::json!({"schema":"sclerite-model-package/2","model_sha256":hash(&json),"encoder_sha256":encoder.hash()})).map_err(err)?;
    for (name, data) in [
        ("model.json", json.as_slice()),
        ("encoder.onnx", encoder.bytes),
        ("manifest.json", manifest.as_slice()),
        ("LICENSE.txt", encoder.license.as_bytes()),
    ] {
        zip.start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored),
        )
        .map_err(err)?;
        zip.write_all(data).map_err(err)?;
    }
    Ok(zip.finish().map_err(err)?.into_inner())
}

pub fn unpack(bytes: Vec<u8>) -> Result<Model, String> {
    if bytes.len() > 128_000_000 {
        return Err("模型包超过 128 MB".into());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(err)?;
    if zip.len() != 4 {
        return Err("模型包文件清单无效".into());
    }
    let mut files = BTreeMap::new();
    let mut total = 0;
    for i in 0..zip.len() {
        let mut file = zip.by_index(i).map_err(err)?;
        let name = file.name().to_string();
        if !["model.json", "encoder.onnx", "manifest.json", "LICENSE.txt"].contains(&name.as_str())
            || files.contains_key(&name)
            || file.size()
                > if name == "encoder.onnx" {
                    100_000_000
                } else if name == "model.json" {
                    20_000_000
                } else {
                    1_000_000
                }
        {
            return Err("模型包包含不支持的文件".into());
        }
        total += file.size();
        if total > 128_000_000 {
            return Err("模型包解压尺寸过大".into());
        }
        let mut data = Vec::new();
        file.by_ref()
            .take(if name == "encoder.onnx" {
                100_000_001
            } else if name == "model.json" {
                20_000_001
            } else {
                1_000_001
            })
            .read_to_end(&mut data)
            .map_err(err)?;
        if data.len() as u64 != file.size() {
            return Err("模型包尺寸不符".into());
        }
        files.insert(name, data);
    }
    let manifest: serde_json::Value =
        serde_json::from_slice(&files["manifest.json"]).map_err(err)?;
    let model: Model = serde_json::from_slice(&files["model.json"]).map_err(err)?;
    let encoder = encoders::get(&model.encoder)?;
    if !["sclerite-model-package/1", "sclerite-model-package/2"]
        .iter()
        .any(|s| manifest["schema"] == *s)
        || manifest["model_sha256"] != hash(&files["model.json"])
        || manifest["encoder_sha256"] != encoder.hash()
        || hash(&files["encoder.onnx"]) != encoder.hash()
    {
        return Err("模型哈希不匹配或不是受支持的编码器".into());
    }
    validate_model(&model)?;
    Ok(model)
}

#[tauri::command]
pub async fn classifier_export(model: Model) -> Result<Response, String> {
    tauri::async_runtime::spawn_blocking(move || package(&model).map(Response::new))
        .await
        .map_err(err)?
}
#[tauri::command]
pub async fn classifier_import(
    app: tauri::AppHandle,
    request: Request<'_>,
) -> Result<Model, String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err("需要模型 ZIP 包".into());
    };
    if bytes.len() > 128_000_000 {
        return Err("模型包超过 128 MB".into());
    }
    let bytes = bytes.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<ClassifierState>();
        let _guard = state.enter()?;
        let model = unpack(bytes)?;
        save_model(&app, &model)?;
        Ok(model)
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fit_fixture() -> (Vec<Category>, Vec<(Sample, Vec<f32>)>) {
        let classes = vec![
            Category {
                id: "a".into(),
                name: "A".into(),
            },
            Category {
                id: "b".into(),
                name: "B".into(),
            },
        ];
        let mut rows = vec![];
        for part in ["train", "validation", "test"] {
            for i in 0..8 {
                rows.push((
                    Sample {
                        key: hash(format!("{part}-{i}").as_bytes()),
                        object: format!("{part}-{i}"),
                        source: hash(format!("source-{part}-{i}").as_bytes()),
                        label: classes[i % 2].id.clone(),
                        group: format!("{part}-{i}"),
                        partition: part.into(),
                    },
                    vec![if i % 2 == 0 { -1. } else { 1. }, 0.1],
                ));
            }
        }
        (classes, rows)
    }
    #[test]
    fn test_partition_never_selects_regularization() {
        let (classes, mut rows) = fit_fixture();
        let a = fit_rows(&rows, &classes, true, |_, _| Ok(())).unwrap();
        assert_eq!(a.1.candidates.len(), 3);
        assert_eq!(a.1.lambda, 0.01); // 相同验证成绩时选较强正则。
        for (s, x) in &mut rows {
            if s.partition == "test" {
                s.label = if s.label == "a" { "b" } else { "a" }.into();
                *x = vec![100., -99.];
            }
        }
        let b = fit_rows(&rows, &classes, true, |_, _| Ok(())).unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
        rows.retain(|(s, _)| s.partition != "validation");
        assert!(fit_rows(&rows, &classes, true, |_, _| Ok(())).is_err());
        let fixed = fit_rows(&rows, &classes, false, |_, _| Ok(())).unwrap();
        assert_eq!(fixed.1.selected_on, "fixed");
        assert_eq!(fixed.1.lambda, 0.001);
        assert!(fixed.1.candidates.is_empty());
    }
    #[test]
    fn cancelled_search_never_returns_a_partial_model() {
        let (classes, rows) = fit_fixture();
        assert!(fit_rows(&rows, &classes, true, |_, _| Err("cancel".into())).is_err());
    }
    #[test]
    fn legacy_model_and_package_roundtrip() {
        let (classes, rows) = fit_fixture();
        let (mut head, _) = fit_rows(&rows, &classes, false, |_, _| Ok(())).unwrap();
        for w in &mut head.weights {
            w.resize(1280, 0.);
        }
        let model = Model {
            encoder: default_encoder(),
            regularization: None,
            dataset_signature: None,
            schema: "sclerite-classifier/1".into(),
            id: "legacy".into(),
            created: 0,
            task: "morphotype".into(),
            classes,
            encoder_hash: hash(ENCODER),
            preprocessing: PREPROCESS.into(),
            backend: "cpu".into(),
            head,
            formal: true,
            samples: rows.into_iter().map(|(s, _)| s).collect(),
            evaluation: BTreeMap::new(),
        };
        let mut legacy = serde_json::to_value(&model).unwrap();
        legacy.as_object_mut().unwrap().remove("encoder");
        legacy.as_object_mut().unwrap().remove("regularization");
        let old_json = serde_json::to_vec(&legacy).unwrap();
        let old_manifest = serde_json::to_vec(&serde_json::json!({"schema":"sclerite-model-package/1","model_sha256":hash(&old_json),"encoder_sha256":hash(ENCODER)})).unwrap();
        let mut old_zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (name, bytes) in [
            ("model.json", old_json.as_slice()),
            ("encoder.onnx", ENCODER),
            ("manifest.json", old_manifest.as_slice()),
            ("LICENSE.txt", b"Legacy license fixture".as_slice()),
        ] {
            old_zip
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            old_zip.write_all(bytes).unwrap();
        }
        let old_package = unpack(old_zip.finish().unwrap().into_inner()).unwrap();
        assert_eq!(old_package.encoder, encoders::MOBILE);
        assert!(old_package.regularization.is_none());
        let restored: Model = serde_json::from_value(legacy).unwrap();
        validate_model(&restored).unwrap();
        let decoded = unpack(package(&restored).unwrap()).unwrap();
        assert_eq!(decoded.encoder, encoders::MOBILE);
        assert_eq!(decoded.head.weights, model.head.weights);
        let mut invalid = restored.clone();
        invalid.encoder = "not-installed".into();
        assert!(validate_model(&invalid).is_err());
        invalid = restored;
        invalid.head.weights[0].truncate(384);
        assert!(validate_model(&invalid).is_err());
    }
    #[test]
    fn mask_and_tensor() {
        let mut packet = Vec::new();
        packet.extend(2u32.to_le_bytes());
        packet.extend(1u32.to_le_bytes());
        packet.extend([255, 0, 0, 255, 0, 255, 0, 0]);
        let x = preprocess(&packet).unwrap();
        assert_eq!(x.len(), 196608);
        assert!(x.iter().all(|v| v.is_finite()));
        packet[11] = 0;
        assert!(preprocess(&packet).is_err());
        assert!(preprocess(&[]).is_err());
        assert!(!valid_key("../bad"));
    }
    #[test]
    fn independent_groups_and_duplicates() {
        let mut r = TrainRequest {
            encoder: default_encoder(),
            auto_regularization: false,
            dataset_signature: None,
            task: "morphotype".into(),
            classes: vec![
                Category {
                    id: "a".into(),
                    name: "A".into(),
                },
                Category {
                    id: "b".into(),
                    name: "B".into(),
                },
            ],
            formal: false,
            backend: "cpu".into(),
            samples: vec![],
        };
        for n in 0..2 {
            r.samples.push(Sample {
                key: hash(&[n]),
                object: n.to_string(),
                source: hash(&[10 + n]),
                label: if n == 0 { "a" } else { "b" }.into(),
                group: "specimen1".into(),
                partition: "train".into(),
            });
        }
        assert!(validate_samples(&r).is_ok());
        r.samples[1].partition = "test".into();
        assert!(validate_samples(&r).is_err());
        r.samples[1].partition = "train".into();
        r.samples[1].key = r.samples[0].key.clone();
        assert!(validate_samples(&r).is_err());
    }
}
