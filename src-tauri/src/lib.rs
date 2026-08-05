use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, State,
};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

/// Shared application state. Holds a file that was requested to be opened before
/// the frontend finished loading (e.g. via a double-click file association on the
/// very first launch). The frontend fetches it once with `get_initial_file`.
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

/// User-configurable behaviour persisted to a JSON file in the app config dir.
#[derive(Clone, Serialize, Deserialize)]
struct Settings {
    /// When true, clicking the window close button hides the app to the system
    /// tray instead of quitting.
    close_to_tray: bool,
    /// When true, minimizing the window sends it to the tray (hides it) instead
    /// of keeping it on the taskbar.
    minimize_to_tray: bool,
    /// Last window geometry so we can restore it on next launch.
    window: WindowState,
}

#[derive(Clone, Copy, Default, Serialize, Deserialize)]
struct WindowState {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            close_to_tray: false,
            minimize_to_tray: false,
            window: WindowState::default(),
        }
    }
}

/// In-memory, mutable copy of `Settings` shared across commands and the window
/// event handler. Persisted to disk on every change so it survives restarts.
struct SettingsState {
    inner: Mutex<Settings>,
}

impl SettingsState {
    fn load(app: &AppHandle) -> Self {
        if let Ok(dir) = app.path().app_config_dir() {
            let path = dir.join("settings.json");
            if let Ok(text) = std::fs::read_to_string(&path) {
                if let Ok(s) = serde_json::from_str::<Settings>(&text) {
                    return SettingsState {
                        inner: Mutex::new(s),
                    };
                }
            }
        }
        SettingsState {
            inner: Mutex::new(Settings::default()),
        }
    }

    fn save(&self, app: &AppHandle) {
        let s = self.inner.lock().unwrap();
        if let Ok(dir) = app.path().app_config_dir() {
            let _ = std::fs::create_dir_all(&dir);
            if let Ok(text) = serde_json::to_string_pretty(&*s) {
                let _ = std::fs::write(dir.join("settings.json"), text);
            }
        }
    }
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

/// Return the current settings (read by the settings UI to initialize controls).
#[tauri::command]
fn get_settings(state: State<SettingsState>) -> Settings {
    state.inner.lock().unwrap().clone()
}

/// Update whether closing the window keeps the app in the tray.
/// Takes effect immediately for subsequent close actions — no restart needed.
#[tauri::command]
fn set_close_to_tray(app: AppHandle, value: bool) -> Result<(), String> {
    let state = app.state::<SettingsState>();
    state.inner.lock().unwrap().close_to_tray = value;
    state.save(&app);
    Ok(())
}

/// Update whether minimizing the window sends it to the tray.
/// Takes effect immediately for subsequent minimize actions — no restart needed.
#[tauri::command]
fn set_minimize_to_tray(app: AppHandle, value: bool) -> Result<(), String> {
    let state = app.state::<SettingsState>();
    state.inner.lock().unwrap().minimize_to_tray = value;
    state.save(&app);
    Ok(())
}

/// Restore the main window from the tray (show + focus).
#[tauri::command]
fn show_main(app: AppHandle) {
    focus_main(&app);
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
            save_file,
            get_settings,
            set_close_to_tray,
            set_minimize_to_tray,
            show_main
        ])
        .setup(|app| {
            // On the first launch, the OS passes the double-clicked file as a CLI arg.
            let args: Vec<String> = std::env::args().collect();
            for arg in &args {
                if try_open(app.handle(), arg) {
                    break;
                }
            }

            // Load persisted settings (incl. window geometry) and make them
            // available to commands + the window-event handler.
            let settings_state = SettingsState::load(app.handle());
            app.manage(settings_state);

            // Restore the last window position/size if we have a valid one.
            let saved = app.state::<SettingsState>().inner.lock().unwrap().window;
            if saved.width > 0.0 && saved.height > 0.0 {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_position(PhysicalPosition::new(saved.x as i32, saved.y as i32));
                    let _ = win.set_size(PhysicalSize::new(saved.width as u32, saved.height as u32));
                }
            }

            // Build the system tray with a Show / Quit menu.
            let show_i = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("折简")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => focus_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        focus_main(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        // Window lifecycle handling registered on the Builder: keep the app in
        // the tray on close / minimize (per settings) and remember geometry.
        // State is fetched dynamically from the AppHandle because window events
        // fire after `setup` has managed it.
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            let app_handle = window.app_handle();
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let settings = app_handle.state::<SettingsState>();
                    let close_to_tray = settings.inner.lock().unwrap().close_to_tray;
                    if close_to_tray {
                        // Keep the app running in the tray instead of quitting.
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
                tauri::WindowEvent::Moved(pos) => {
                    let settings = app_handle.state::<SettingsState>();
                    {
                        let mut s = settings.inner.lock().unwrap();
                        s.window.x = pos.x as f64;
                        s.window.y = pos.y as f64;
                    }
                    settings.save(&app_handle);
                }
                tauri::WindowEvent::Resized(size) => {
                    let settings = app_handle.state::<SettingsState>();
                    {
                        let mut s = settings.inner.lock().unwrap();
                        s.window.width = size.width as f64;
                        s.window.height = size.height as f64;
                    }
                    settings.save(&app_handle);
                }
                _ => {}
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running jam_md_view");
}
