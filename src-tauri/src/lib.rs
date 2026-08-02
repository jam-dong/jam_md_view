use std::sync::Mutex;

use serde::Serialize;
use tauri::{
    AppHandle, Emitter, Manager, State,
};

/// Shared application state. Holds a file that was requested to be opened before
/// the frontend finished loading (e.g. via a double-click file association on the
/// first launch). The frontend fetches it once with `get_initial_file`.
#[derive(Default)]
struct AppState {
    pending: Mutex<Option<FilePayload>>,
}

/// Serializable payload describing an opened Markdown document.
#[derive(Clone, Serialize)]
struct FilePayload {
    path: String,
    name: String,
    content: String,
}

/// If `arg` looks like a Markdown file, read it and:
///  * store it as the pending file (so the frontend can fetch it on first load),
///  * emit an `open-file` event (so an already-running window can react).
/// Returns `true` when a Markdown file was handled.
fn try_open(app: &AppHandle, arg: &str) -> bool {
    let lower = arg.to_ascii_lowercase();
    if !(lower.ends_with(".md") || lower.ends_with(".markdown")) {
        return false;
    }

    match std::fs::read_to_string(arg) {
        Ok(content) => {
            let name = std::path::Path::new(arg)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| arg.to_string());

            let payload = FilePayload {
                path: arg.to_string(),
                name,
                content,
            };

            if let Some(state) = app.try_state::<AppState>() {
                *state.pending.lock().unwrap() = Some(payload.clone());
            }
            let _ = app.emit("open-file", &payload);
            true
        }
        Err(e) => {
            eprintln!("jam_md_view: failed to read {arg}: {e}");
            false
        }
    }
}

/// Bring the main window to the foreground (used when a second instance forwards a
/// file to the running one).
fn focus_main(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

/// Frontend fetches this once on startup to pick up a file opened via association
/// on the very first launch (the emit would otherwise be missed).
#[tauri::command]
fn get_initial_file(state: State<AppState>) -> Option<FilePayload> {
    state.pending.lock().unwrap().take()
}

/// Read a Markdown file from disk and return its contents.
#[tauri::command]
fn read_file(path: String) -> Result<FilePayload, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let name = std::path::Path::new(&path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    Ok(FilePayload {
        path,
        name,
        content,
    })
}

/// Persist the current document back to disk.
#[tauri::command]
fn save_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_single_instance::Builder::new()
                .callback(|app, args, _cwd| {
                    for arg in &args {
                        if try_open(app, arg) {
                            break;
                        }
                    }
                    focus_main(app);
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_initial_file,
            read_file,
            save_file
        ])
        .setup(|app| {
            // On the first launch, the OS passes the double-clicked file as a CLI arg.
            let args: Vec<String> = std::env::args().collect();
            for arg in &args {
                if try_open(app.handle(), arg) {
                    break;
                }
            }
            Ok(())
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running jam_md_view");
}
