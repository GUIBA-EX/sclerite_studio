use sclerite_studio::{classification::*, classifier_math};
use std::{fs, path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    #[cfg(target_os = "macos")]
    ort::init_from(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("runtime/libonnxruntime.1.24.2.dylib"),
    )?
    .with_telemetry(false)
    .commit();
    let dir = PathBuf::from(std::env::args().nth(1).expect("crop directory"));
    let list: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(dir.join("crops.json"))?)?;
    let mut cpu = make_session("cpu", &dir)?;
    let mut features = vec![];
    let mut labels = vec![];
    let start = Instant::now();
    for item in &list {
        let packet = fs::read(dir.join(item["path"].as_str().unwrap()))?;
        let input = preprocess(&packet)?;
        // 保留唯一 Rust 预处理的输入，用于独立 Python 参考检查。
        fs::write(
            dir.join(format!("{}.tensor", item["path"].as_str().unwrap())),
            input
                .iter()
                .flat_map(|x| x.to_le_bytes())
                .collect::<Vec<_>>(),
        )?;
        features.push(encode(&mut cpu, input)?);
        labels.push(item["label"].as_u64().unwrap() as usize);
    }
    let cpu_seconds = start.elapsed().as_secs_f64();
    let groups = vec!["MR0145-engineering-only".to_string(); features.len()];
    let head = classifier_math::train(&features, &labels, &groups, 2, |_, _| Ok(()))?;
    let classes = vec![
        Category {
            id: "engineering-a".into(),
            name: "Engineering A (not biological truth)".into(),
        },
        Category {
            id: "engineering-b".into(),
            name: "Engineering B (not biological truth)".into(),
        },
    ];
    let samples = list
        .iter()
        .enumerate()
        .map(|(i, v)| Sample {
            key: hash(&fs::read(dir.join(v["path"].as_str().unwrap())).unwrap()),
            object: format!("fixture-{i}"),
            source: hash(v["source"].as_str().unwrap().as_bytes()),
            label: classes[labels[i]].id.clone(),
            group: groups[i].clone(),
            partition: "train".into(),
        })
        .collect();
    let model = Model {
        encoder: "mobilenetv4-small".into(),
        regularization: None,
        dataset_signature: Some(hash(b"engineering-check-only")),
        schema: "sclerite-classifier/1".into(),
        id: "engineering-check-only".into(),
        created: 0,
        task: "morphotype".into(),
        classes,
        encoder_hash: hash(ENCODER),
        preprocessing: PREPROCESS.into(),
        backend: "cpu".into(),
        head: head.clone(),
        formal: false,
        samples,
        evaluation: Default::default(),
    };
    let bytes = package(&model)?;
    let restored = unpack(bytes.clone())?;
    assert_eq!(model.dataset_signature, restored.dataset_signature);
    for x in &features {
        assert_eq!(
            classifier_math::probabilities(&head.weights, &head.bias, x),
            classifier_math::probabilities(&restored.head.weights, &restored.head.bias, x)
        );
    }
    fs::write(dir.join("engineering-model.zip"), &bytes)?;
    let mut bad = bytes.clone();
    bad[100] ^= 1;
    assert!(unpack(bad).is_err());
    let mut coreml = serde_json::json!({"available":false});
    if let Ok(mut session) = make_session("coreml", &dir.join("coreml")) {
        let start = Instant::now();
        let mut max_error = 0.0_f64;
        let mut flips = 0;
        for (i, item) in list.iter().enumerate() {
            let x = encode(
                &mut session,
                preprocess(&fs::read(dir.join(item["path"].as_str().unwrap()))?)?,
            )?;
            for (a, b) in x.iter().zip(&features[i]) {
                max_error = max_error.max((*a as f64 - *b as f64).abs());
            }
            let a = classifier_math::probabilities(&head.weights, &head.bias, &features[i]);
            let b = classifier_math::probabilities(&head.weights, &head.bias, &x);
            if (a[0] > a[1]) != (b[0] > b[1]) {
                flips += 1;
            }
        }
        coreml = serde_json::json!({"available":true,"max_feature_error":max_error,"classification_flips":flips,"seconds":start.elapsed().as_secs_f64()});
    }
    let report = serde_json::json!({"engineering_only":true,"images":2,"crops":list.len(),"cpu_seconds":cpu_seconds,"dimension":features[0].len(),"features":features,"labels":labels,"head":head,"package_roundtrip":true,"corrupt_package_rejected":true,"coreml":coreml});
    fs::write(
        dir.join("native-report.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!(
        "{}",
        serde_json::json!({"crops":list.len(),"cpu_seconds":cpu_seconds,"converged":model.head.converged,"coreml":coreml})
    );
    Ok(())
}
