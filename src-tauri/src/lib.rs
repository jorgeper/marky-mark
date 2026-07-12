use std::sync::Mutex;
use tauri::{Emitter, Manager};

/// Files the OS asked us to open (file association double-click, CLI args)
/// before the frontend registered its listener. Drained once by
/// `take_pending_open_files`; after that, opens are emitted live.
struct OpenState {
    frontend_ready: bool,
    pending: Vec<String>,
}

#[tauri::command]
fn take_pending_open_files(state: tauri::State<'_, Mutex<OpenState>>) -> Vec<String> {
    let mut s = state.lock().unwrap();
    s.frontend_ready = true;
    std::mem::take(&mut s.pending)
}

/// SPEC18 §2: native print of the calling webview (the printview window).
/// `window.print()` is a silent no-op in WKWebView — this is the real one,
/// opening the OS print dialog (macOS: PDF ▾ / Save as PDF).
#[tauri::command]
fn print_view(webview_window: tauri::WebviewWindow) -> Result<(), String> {
    webview_window.print().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Windows/Linux file associations arrive as plain CLI arguments.
    let cli_files: Vec<String> = std::env::args()
        .skip(1)
        .filter(|a| !a.starts_with('-'))
        .collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Mutex::new(OpenState {
            frontend_ready: false,
            pending: cli_files,
        }))
        .invoke_handler(tauri::generate_handler![take_pending_open_files, print_view])
        .build(tauri::generate_context!())
        .expect("error while building Marky Mark")
        .run(|app, event| {
            // macOS delivers file-association opens as RunEvent::Opened.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths: Vec<String> = urls
                    .iter()
                    .filter_map(|u| u.to_file_path().ok())
                    .map(|p| p.to_string_lossy().into_owned())
                    .collect();
                if paths.is_empty() {
                    return;
                }
                let state = app.state::<Mutex<OpenState>>();
                let mut s = state.lock().unwrap();
                if s.frontend_ready {
                    let _ = app.emit("mm://open-file", paths);
                } else {
                    s.pending.extend(paths);
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
