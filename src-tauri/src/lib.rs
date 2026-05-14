#[cfg(not(any(target_os = "android", target_os = "ios")))]
use tauri::{webview::PageLoadEvent, Manager};

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

#[cfg(not(any(target_os = "android", target_os = "ios")))]
fn main_window_startup_plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    let mut main_window_initialized = false;

    tauri::plugin::Builder::new("main-window-startup")
        .on_page_load(move |webview, payload| {
            if main_window_initialized
                || webview.window().label() != "main"
                || payload.event() != PageLoadEvent::Finished
            {
                return;
            }

            main_window_initialized = true;
            let window = webview.window();

            if let Err(error) = window.set_fullscreen(false) {
                log::warn!("failed to disable fullscreen after page load: {error}");
            }

            if let Err(error) = window.set_decorations(true) {
                log::warn!("failed to enable window decorations after page load: {error}");
            }

            if let Err(error) = window.maximize() {
                log::warn!("failed to maximize main window after page load: {error}");
            }

            if let Err(error) = window.show() {
                log::warn!("failed to show main window after page load: {error}");
            }
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder.plugin(main_window_startup_plugin());

    builder
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
