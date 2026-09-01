#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod domain;
mod providers;
mod storage;
mod tools;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            storage::initialize(&data_dir.join("juniper.db"))?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::system_info,
            commands::app_data_directory,
            commands::load_app_data,
            commands::save_app_data,
            commands::health_check,
            commands::list_models,
            commands::inspect_model,
            commands::pull_model,
            commands::cancel_model_pull,
            commands::import_gguf,
            commands::cancel_gguf_import,
            commands::delete_model,
            commands::running_models,
            commands::chat_stream,
            commands::cancel_chat,
            commands::resolve_permission,
            commands::pick_attachment,
            commands::pick_gguf,
            commands::read_attachment,
            commands::secure_set_credential,
            commands::secure_has_credential,
            commands::secure_delete_credential,
            commands::tool_evaluate,
            commands::tool_convert,
            commands::tool_execute
        ])
        .run(tauri::generate_context!())
        .expect("error while running Juniper");
}
