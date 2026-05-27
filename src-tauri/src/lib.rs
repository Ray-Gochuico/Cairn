// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod yahoo;

use yahoo::{yahoo_quote_summary, YahooState};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        // YahooState is a singleton (single reqwest cookie jar + shared crumb
        // cache) used by `yahoo_quote_summary`. See `src/yahoo.rs`.
        .manage(YahooState::new())
        .invoke_handler(tauri::generate_handler![greet, yahoo_quote_summary])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
