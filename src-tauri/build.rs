fn main() {
    if std::env::var_os("CARGO_FEATURE_DINOV3").is_some() {
        use sha2::{Digest, Sha256};
        let root = std::path::Path::new("models/dinov3");
        for name in ["encoder.onnx", "encoder.json", "LICENSE.txt"] {
            println!("cargo:rerun-if-changed={}", root.join(name).display());
        }
        let metadata: serde_json::Value = serde_json::from_slice(
            &std::fs::read(root.join("encoder.json"))
                .expect("DINOv3 尚未准备：先运行 scripts/export_dinov3.py，并完成目标平台验证"),
        )
        .expect("DINOv3 配置无效");
        let bytes = std::fs::read(root.join("encoder.onnx")).expect("缺少 DINOv3 权重");
        assert!(bytes.len() < 100_000_000, "DINOv3 权重超过受支持上限");
        assert_eq!(
            metadata["sha256"],
            format!("{:x}", Sha256::digest(&bytes)),
            "DINOv3 权重哈希不符"
        );
        assert_eq!(
            metadata["model"],
            "facebook/dinov3-vits16-pretrain-lvd1689m"
        );
        assert_eq!(metadata["input"], serde_json::json!([1, 3, 256, 256]));
        assert_eq!(metadata["output"], serde_json::json!([1, 384]));
        assert_eq!(
            metadata["preprocessing"],
            "rgb-mask-gray128-pad5-triangle256-nchw-imagenet-l2/v1"
        );
        assert_eq!(
            metadata["onnxruntime"], "1.24.2",
            "必须使用应用同版本运行库完成 CPU 一致性验证"
        );
        assert!(
            metadata["real_crop_count"].as_u64().unwrap_or(0) >= 5,
            "至少验证 5 枚真实裁剪"
        );
        assert_eq!(metadata["parity_passed"], true, "DINOv3 一致性验证未通过");
        assert!(
            std::fs::metadata(root.join("LICENSE.txt"))
                .expect("缺少 DINOv3 独立许可")
                .len()
                > 100
        );
    }
    tauri_build::build()
}
