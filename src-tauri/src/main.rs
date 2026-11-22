#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use percent_encoding::percent_decode_str;
use std::path::PathBuf;
use tauri::Manager;

/// Path passed on the command line ("Open with…" / dropping a file on the exe).
#[tauri::command]
fn initial_file() -> Option<String> {
    std::env::args()
        .nth(1)
        .filter(|p| !p.starts_with('-') && PathBuf::from(p).is_file())
}

/// Let the webview stream this one file through the asset protocol.
#[tauri::command]
fn allow_video(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("not a file".into());
    }
    app.asset_protocol_scope()
        .allow_file(&p)
        .map_err(|e| e.to_string())
}

/// Write encoded image bytes (raw IPC body) to the path given in the `x-path` header.
#[tauri::command]
fn save_image(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err("expected binary body".into());
    };
    let raw = request
        .headers()
        .get("x-path")
        .and_then(|v| v.to_str().ok())
        .ok_or("missing path")?;
    let path = percent_decode_str(raw)
        .decode_utf8()
        .map_err(|e| e.to_string())?
        .into_owned();
    std::fs::write(PathBuf::from(path), data).map_err(|e| e.to_string())
}

/// Show the saved file selected in File Explorer.
#[tauri::command]
fn reveal(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            initial_file,
            allow_video,
            save_image,
            reveal
        ])
        .run(tauri::generate_context!())
        .expect("error while running FrameGrab");
}
