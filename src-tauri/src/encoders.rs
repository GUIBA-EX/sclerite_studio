//! 明确的受信任编码器清单；不执行用户任意提供的 ONNX。
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::sync::OnceLock;

pub const MOBILE: &str = "mobilenetv4-small";
pub const DINO: &str = "dinov3-vits16";
pub const PREPROCESS: &str = "rgb-mask-gray128-pad5-triangle256-nchw-imagenet-l2/v1";
pub fn default_encoder() -> String {
    MOBILE.into()
}

pub struct Encoder {
    pub id: &'static str,
    pub name: &'static str,
    pub dim: usize,
    pub bytes: &'static [u8],
    pub license: &'static str,
    hash: OnceLock<String>,
    prefix: OnceLock<Sha256>,
}
impl Encoder {
    pub fn hash(&self) -> &str {
        self.hash
            .get_or_init(|| format!("{:x}", Sha256::digest(self.bytes)))
    }
    pub fn key(&self, backend: &str, packet: &[u8]) -> String {
        // 克隆预先计算的摘要状态，兼容旧缓存；不逐枚扫描整份权重。
        let mut digest = self
            .prefix
            .get_or_init(|| {
                let mut d = Sha256::new();
                d.update(self.bytes);
                d.update(PREPROCESS);
                d
            })
            .clone();
        digest.update(backend);
        digest.update(b"ort-1.24-fp32");
        digest.update(packet);
        format!("{:x}", digest.finalize())
    }
}
static MOBILENET: Encoder = Encoder {
    id: MOBILE,
    name: "MobileNetV4 · 轻量",
    dim: 1280,
    bytes: include_bytes!("../models/encoder.onnx"),
    license: concat!(
        include_str!("../models/LICENSE.txt"),
        "\n\n",
        include_str!("../models/Apache-2.0.txt")
    ),
    hash: OnceLock::new(),
    prefix: OnceLock::new(),
};
// 只有提供已授权、经验证的模型资源后才能构建此功能，默认包不冒充已安装。
#[cfg(feature = "dinov3")]
static DINOV3: Encoder = Encoder {
    id: DINO,
    name: "DINOv3 · 通用视觉特征",
    dim: 384,
    bytes: include_bytes!("../models/dinov3/encoder.onnx"),
    license: include_str!("../models/dinov3/LICENSE.txt"),
    hash: OnceLock::new(),
    prefix: OnceLock::new(),
};
pub fn get(id: &str) -> Result<&'static Encoder, String> {
    match id {
        MOBILE => Ok(&MOBILENET),
        #[cfg(feature = "dinov3")]
        DINO => Ok(&DINOV3),
        #[cfg(not(feature = "dinov3"))]
        DINO => Err("DINOv3 权重尚未安装并完成验证；请选择 MobileNetV4".into()),
        _ => Err("不支持的特征模型".into()),
    }
}
#[derive(Serialize)]
pub struct EncoderInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub dim: usize,
    pub available: bool,
}
#[tauri::command]
pub fn classifier_encoders() -> Vec<EncoderInfo> {
    vec![
        EncoderInfo {
            id: MOBILE,
            name: MOBILENET.name,
            dim: 1280,
            available: true,
        },
        EncoderInfo {
            id: DINO,
            name: "DINOv3 · 通用视觉特征",
            dim: 384,
            available: get(DINO).is_ok(),
        },
    ]
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn encoder_availability_matches_bundled_resources() {
        let rows = classifier_encoders();
        assert_eq!(rows[1].available, cfg!(feature = "dinov3"));
        #[cfg(feature = "dinov3")]
        {
            let dino = get(DINO).unwrap();
            assert_eq!(dino.dim, 384);
            assert!(dino.license.contains("DINOv3 License"));
            assert_ne!(dino.hash(), get(MOBILE).unwrap().hash());
            assert_ne!(
                dino.key("cpu", &[1, 2]),
                get(MOBILE).unwrap().key("cpu", &[1, 2])
            );
        }
    }
    #[test]
    fn cached_hash_keeps_old_feature_identity() {
        let e = get(MOBILE).unwrap();
        let mut d = Sha256::new();
        d.update(e.bytes);
        d.update(PREPROCESS);
        d.update("cpu");
        d.update(b"ort-1.24-fp32");
        d.update([1, 2, 3]);
        assert_eq!(e.key("cpu", &[1, 2, 3]), format!("{:x}", d.finalize()));
        assert_ne!(e.key("cpu", &[1, 2, 3]), e.key("coreml", &[1, 2, 3]));
        assert!(get("arbitrary.onnx").is_err());
    }
}
