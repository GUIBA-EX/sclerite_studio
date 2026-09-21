// 使用生产预处理和推理函数，保存真实裁剪的原生特征以独立核对。
use sclerite_studio::{classification::*, encoders};
use std::{fs, path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = PathBuf::from(std::env::args().nth(1).expect("QA directory"));
    #[cfg(target_os = "macos")]
    ort::init_from(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime/libonnxruntime.1.24.2.dylib"),
    )?
    .with_telemetry(false)
    .commit();
    let encoder = encoders::get(encoders::DINO)?;
    let list: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(dir.join("crops.json"))?)?;
    let start = Instant::now();
    let mut session = make_encoder_session("cpu", &dir, encoder)?;
    let initialization_seconds = start.elapsed().as_secs_f64();
    let start = Instant::now();
    let mut rows = vec![];
    for item in &list {
        let packet = fs::read(dir.join(item["path"].as_str().unwrap()))?;
        let input = preprocess(&packet)?;
        let features = encode_dimension(&mut session, input.clone(), encoder.dim)?;
        assert_eq!(features.len(), 384);
        let norm = features
            .iter()
            .map(|v| (*v as f64).powi(2))
            .sum::<f64>()
            .sqrt();
        assert!((norm - 1.).abs() < 1e-6);
        assert_eq!(
            features,
            encode_dimension(&mut session, input, encoder.dim)?
        );
        assert_ne!(
            encoder.key("cpu", &packet),
            encoders::get(encoders::MOBILE)?.key("cpu", &packet)
        );
        rows.push(serde_json::json!({"path":item["path"],"features":features}));
    }
    let seconds = start.elapsed().as_secs_f64();
    assert!(make_encoder_session("coreml", &dir, encoder).is_err());
    let report = serde_json::json!({"encoder":encoder.id,"crops":rows.len(),"dimension":384,"initialization_seconds":initialization_seconds,"two_pass_seconds":seconds,"deterministic":true,"cache_separation":true,"coreml_blocked":true,"rows":rows});
    fs::write(
        dir.join("dinov3-native-features.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!(
        "{}",
        serde_json::json!({"crops":list.len(),"initialization_seconds":initialization_seconds,"two_pass_seconds":seconds,"passed":true})
    );
    Ok(())
}
