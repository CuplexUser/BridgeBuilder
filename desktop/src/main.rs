//! The desktop app: a Tauri window around the same web build as the site and the Android app.
//! Tauri serves dist/ from its own origin, so modules, workers and storage behave as on the web.
//! The window's WebView keeps saves in its storage under the user's app data. This shell remembers
//! the window, opens outside links in the browser, and adds a save dialog for exported levels and
//! collapse clips.
//!
//!   npm run desktop        build, then run the app
//!   npm run desktop:dev    run the app against the Vite dev server, with reloads
//!   npm run desktop:dist   build a Windows installer and a portable .exe into release/

// No console window behind the game in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::Path;

use tauri::ipc::{InvokeBody, Request};
use tauri::webview::{NewWindowResponse, PageLoadEvent};
use tauri::window::Color;
use tauri::{AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_window_state::StateFlags;

/// What the page sees as `window.bridgeDesktop` (src/desktop.ts), and the keys a browser shell
/// would otherwise handle. Runs before the page's own scripts, like an Electron preload.
const BRIDGE_SCRIPT: &str = include_str!("bridge.js");

/// Whether a page may load in the window: the app's own origin, and in development the dev server.
fn is_app_url(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => url.host_str() == Some("tauri.localhost") || (cfg!(debug_assertions) && url.host_str() == Some("localhost")),
        _ => true,
    }
}

/// Links out of the game (such as the privacy policy) open in the browser.
fn open_outside(app: &AppHandle, url: &Url) {
    if matches!(url.scheme(), "http" | "https") {
        let _ = app.opener().open_url(url.as_str(), None::<&str>);
    }
}

/// Asks where to save a file and writes it there. The body is the file's bytes and the
/// `x-name` header its suggested name. Returns false if the player cancels.
#[tauri::command]
async fn save_file(app: AppHandle, window: WebviewWindow, request: Request<'_>) -> Result<bool, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("expected the file's bytes".into());
    };
    let name = request
        .headers()
        .get("x-name")
        .and_then(|v| v.to_str().ok())
        .map(|v| percent_encoding::percent_decode_str(v).decode_utf8_lossy().into_owned())
        .unwrap_or_default();
    let name = Path::new(&name).file_name().and_then(|n| n.to_str()).unwrap_or("bridge").to_owned();
    let ext = Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("").to_owned();

    let paths = app.path();
    let folder = if ext == "json" { paths.document_dir() } else { paths.video_dir() };
    let mut dialog = app.dialog().file().set_parent(&window).set_file_name(&name);
    if let Ok(folder) = folder {
        dialog = dialog.set_directory(folder);
    }
    if !ext.is_empty() {
        dialog = dialog.add_filter(ext.to_uppercase(), &[ext.as_str()]);
    }
    let Some(path) = dialog.blocking_save_file() else {
        return Ok(false);
    };
    let path = path.into_path().map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())?;
    Ok(true)
}

/// F11: the window has no menu bar to offer full screen, so the page asks for it.
#[tauri::command]
fn toggle_fullscreen(window: WebviewWindow) -> Result<(), String> {
    let full = window.is_fullscreen().map_err(|e| e.to_string())?;
    window.set_fullscreen(!full).map_err(|e| e.to_string())
}

fn create_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let script = BRIDGE_SCRIPT
        .replace("__VERSION__", &app.package_info().version.to_string())
        .replace("__DEV__", if cfg!(debug_assertions) { "true" } else { "false" });
    let nav_app = app.clone();
    let popup_app = app.clone();
    WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("Bridge Builder")
        .inner_size(1440.0, 900.0)
        .min_inner_size(960.0, 600.0)
        .center()
        .visible(false)
        .background_color(Color(0x0b, 0x1d, 0x38, 0xff))
        .initialization_script(script)
        .on_navigation(move |url| {
            let allowed = is_app_url(url);
            if !allowed {
                open_outside(&nav_app, url);
            }
            allowed
        })
        .on_new_window(move |url, _| {
            open_outside(&popup_app, &url);
            NewWindowResponse::Deny
        })
        // Shown once the page has drawn, so there is no blank window first.
        .on_page_load(|window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                let _ = window.show();
            }
        })
        .build()
}

fn main() {
    tauri::Builder::default()
        // One window: a second launch brings the first to the front.
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        // Remembers the window's size and place. It stays hidden until the page has loaded.
        .plugin(tauri_plugin_window_state::Builder::new().with_state_flags(StateFlags::all() - StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![save_file, toggle_fullscreen])
        .setup(|app| {
            create_window(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("the desktop app failed to start");
}
