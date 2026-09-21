// 独立开发测试程序，不编入正式应用；使用隔离的应用标识与真实 WebView IPC。
use sclerite_studio::classification::*;
use sclerite_studio::encoders::*;
use std::{
    fs,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tauri::{Listener, Manager};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let dir = PathBuf::from(std::env::args().nth(1).expect("QA directory"));
    let encoder_id = std::env::args().nth(2).unwrap_or_else(|| MOBILE.into());
    let encoder = get(&encoder_id)?;
    #[cfg(target_os = "macos")]
    ort::init_from(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("runtime/libonnxruntime.1.24.2.dylib"),
    )?
    .with_telemetry(false)
    .commit();
    let list: Vec<serde_json::Value> = serde_json::from_slice(&fs::read(dir.join("crops.json"))?)?;
    let mut crops = vec![];
    for row in &list {
        crops.push(serde_json::json!({"bytes":fs::read(dir.join(row["path"].as_str().unwrap()))?,"label":row["label"],"source":hash(row["source"].as_str().unwrap().as_bytes())}));
    }
    let script = format!(
        r#"(async()=>{{
      const invoke=window.__TAURI_INTERNALS__.invoke;
      try {{
        const encoder={};const crops={};const samples=[];
        const encoders=await invoke('classifier_encoders');
        if(!encoders.find(e=>e.id===encoder&&e.available))throw Error('缺少编码器清单');
        const started=performance.now();
        for(let i=0;i<crops.length;i++){{
          const f=await invoke('classifier_feature',new Uint8Array(crops[i].bytes),{{headers:{{'x-sclerite-backend':'cpu','x-sclerite-encoder':encoder}}}});
          samples.push({{key:f.key,object:'qa-'+i,source:crops[i].source,label:'class-'+crops[i].label,group:'engineering-one-specimen',partition:'train'}});
        }}
        const extractionSeconds=(performance.now()-started)/1000;
        const dataset_signature='a'.repeat(64);
        const model=await invoke('classifier_train',{{data:{{encoder,task:'morphotype',classes:[{{id:'class-0',name:'工程测试 A'}},{{id:'class-1',name:'工程测试 B'}}],samples,formal:false,backend:'cpu',dataset_signature}}}});
        const current=await invoke('classifier_current');
        const selected=await invoke('classifier_current',{{encoder,task:'morphotype'}});
        if(model.encoder!==encoder||model.head.weights[0].length!==encoders.find(e=>e.id===encoder).dim)throw Error('编码器或特征维度错误');
        if(selected.id!==model.id)throw Error('按编码器保存失败');
        if(model.regularization.selected_on!=='fixed'||model.regularization.lambda!==0.001)throw Error('试用模型正则选择错误');
        if(current.id!==model.id)throw Error('模型未自动保存');
        if(current.dataset_signature!==dataset_signature)throw Error('数据快照未保存');
        const prediction=await invoke('classifier_predict',{{model,keys:samples.map(s=>s.key)}});
        const bytes=await invoke('classifier_export',{{model}});
        const loaded=await invoke('classifier_import',new Uint8Array(bytes));
        const after=await invoke('classifier_predict',{{model:loaded,keys:samples.map(s=>s.key)}});
        if(loaded.dataset_signature!==dataset_signature)throw Error('数据快照未随模型包往返');
        if(JSON.stringify(prediction)!==JSON.stringify(after))throw Error('保存加载不一致');
        if(prediction.some(p=>p.length!==2||Math.abs(p[0]+p[1]-1)>1e-6))throw Error('预测分数无效');
        const cached=await invoke('classifier_feature',new Uint8Array(crops[0].bytes),{{headers:{{'x-sclerite-backend':'cpu','x-sclerite-encoder':encoder}}}});
        if(!cached.cached)throw Error('缓存没有命中');
        await invoke('plugin:event|emit',{{event:'classifier-native-test',payload:{{ok:true,encoder,extractionSeconds,crops:crops.length,dimension:model.head.weights[0].length,model:model.id,converged:model.head.converged,packageBytes:bytes.byteLength,predictionRoundtrip:true,cacheHit:true}}}});
      }} catch(e){{await invoke('plugin:event|emit',{{event:'classifier-native-test',payload:{{ok:false,error:String(e)}}}});}}
    }})();"#,
        serde_json::to_string(encoder.id)?,
        serde_json::to_string(&crops)?
    );
    let mut context = tauri::generate_context!();
    context.config_mut().identifier = "org.scleritestudio.classifier-qa".into();
    let fired = Arc::new(AtomicBool::new(false));
    tauri::Builder::default()
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
        .setup(move |app| {
            let handle = app.handle().clone();
            let out = dir.join(format!("native-ipc-{}-report.json", encoder.id));
            app.listen("classifier-native-test", move |event| {
                let payload = event.payload();
                let _ = fs::write(&out, payload);
                println!("{payload}");
                handle.exit(if payload.contains("\"ok\":true") {
                    0
                } else {
                    1
                });
            });
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_title("分类验证（临时测试窗口）");
            }
            Ok(())
        })
        .on_page_load(move |webview, event| {
            if event.event() == tauri::webview::PageLoadEvent::Finished
                && !fired.swap(true, Ordering::SeqCst)
            {
                let _ = webview.eval(&script);
            }
        })
        .run(context)?;
    Ok(())
}
