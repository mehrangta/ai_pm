#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::Manager;

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn apply_main_window_defaults(app: &tauri::App) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("main window not found during setup");
        return;
    };

    if let Err(error) = window.set_fullscreen(false) {
        log::warn!("failed to disable fullscreen during setup: {error}");
    }

    if let Err(error) = window.set_decorations(true) {
        log::warn!("failed to enable window decorations during setup: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_debug_tools::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            #[cfg(not(any(target_os = "android", target_os = "ios")))]
            {
                apply_main_window_defaults(app);
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
