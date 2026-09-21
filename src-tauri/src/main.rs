#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    use sclerite_studio::classification::*;
    use sclerite_studio::encoders::*;
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                use tauri::Manager;
                let path = app
                    .path()
                    .resource_dir()?
                    .join("runtime/libonnxruntime.1.24.2.dylib");
                let path = if cfg!(debug_assertions) && !path.exists() {
                    std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                        .join("runtime/libonnxruntime.1.24.2.dylib")
                } else {
                    path
                };
                ort::init_from(path)?.with_telemetry(false).commit();
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = app;
                ort::init().with_telemetry(false).commit();
            }
            Ok(())
        })
        .manage(ClassifierState::default())
        .invoke_handler(tauri::generate_handler![
            classifier_feature,
            classifier_encoders,
            classifier_train,
            classifier_cancel,
            classifier_current,
            classifier_predict,
            classifier_export,
            classifier_import
        ])
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .run(tauri::generate_context!())
        .expect("Unable to start Sclerite Studio");
}
