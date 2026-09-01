mod cockpit_import;
mod cursor_db;
mod desktop;
mod error;
#[allow(dead_code)]
mod linux_updater;
mod model;
mod provider;
mod state;
mod storage;
mod updater;

use tauri::{Emitter, Manager, State};
use zeroize::Zeroizing;

use desktop::{CloseBehavior, DesktopSettings};
use model::{BatchAccountResult, CursorAccountView};
use state::AppState;
use updater::{PendingNotes, ReleaseHistoryItem, UpdateSettings};

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopPlatformInfo {
    platform: &'static str,
    arch: &'static str,
}

#[tauri::command]
fn list_cursor_accounts(state: State<'_, AppState>) -> Result<Vec<CursorAccountView>, String> {
    state.list().map_err(|error| error.to_string())
}

#[tauri::command]
fn load_current_cursor_account(state: State<'_, AppState>) -> Result<CursorAccountView, String> {
    let record = cursor_db::read_default_cursor_account()
        .map_err(|error| error.to_string())?
        .into_record()
        .ok_or_else(|| error::AppError::AccessTokenMissing.to_string())?;
    state
        .upsert(record, true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_cockpit_accounts_json(
    payload: String,
    state: State<'_, AppState>,
) -> Result<Vec<CursorAccountView>, String> {
    let payload = Zeroizing::new(payload);
    let records = cockpit_import::parse_cockpit_accounts_json(payload.as_str())
        .map_err(|error| error.to_string())?;
    state.import(records).map_err(|error| error.to_string())
}

#[tauri::command]
fn select_cursor_account(
    account_id: String,
    state: State<'_, AppState>,
) -> Result<CursorAccountView, String> {
    state.select(&account_id).map_err(|error| error.to_string())
}

#[tauri::command]
async fn query_cursor_usage(state: State<'_, AppState>) -> Result<CursorAccountView, String> {
    let account = state.active_record().map_err(|error| error.to_string())?;
    let refreshed = state
        .provider
        .refresh_account(account)
        .await
        .map_err(|error| error.to_string())?;
    state.persist(refreshed).map_err(|error| error.to_string())
}

#[tauri::command]
async fn refresh_cursor_account(
    account_id: String,
    state: State<'_, AppState>,
) -> Result<CursorAccountView, String> {
    let account = state
        .record(&account_id)
        .map_err(|error| error.to_string())?;
    let refreshed = state
        .provider
        .refresh_account(account)
        .await
        .map_err(|error| error.to_string())?;
    state.persist(refreshed).map_err(|error| error.to_string())
}

#[tauri::command]
async fn refresh_cursor_accounts(
    account_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<Vec<BatchAccountResult<CursorAccountView>>, String> {
    let mut results = Vec::with_capacity(account_ids.len());
    for account_id in account_ids {
        let outcome = match state.record(&account_id) {
            Ok(account) => match state.provider.refresh_account(account).await {
                Ok(refreshed) => match state.persist(refreshed) {
                    Ok(view) => BatchAccountResult {
                        account_id,
                        result: Some(view),
                        error: None,
                    },
                    Err(error) => BatchAccountResult {
                        account_id,
                        result: None,
                        error: Some(error.to_string()),
                    },
                },
                Err(error) => BatchAccountResult {
                    account_id,
                    result: None,
                    error: Some(error.to_string()),
                },
            },
            Err(error) => BatchAccountResult {
                account_id,
                result: None,
                error: Some(error.to_string()),
            },
        };
        results.push(outcome);
    }
    Ok(results)
}

#[tauri::command]
fn delete_cursor_account(account_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.delete(&account_id).map_err(|error| error.to_string())
}

#[tauri::command]
fn delete_cursor_accounts(
    account_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .delete_many(&account_ids)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_desktop_settings(state: State<'_, AppState>) -> Result<DesktopSettings, String> {
    state
        .desktop_settings_for_ui()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_desktop_settings(
    settings: DesktopSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .save_desktop_settings(&settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn update_cursor_account_tags(
    account_id: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
) -> Result<CursorAccountView, String> {
    state
        .update_tags(&account_id, tags)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_cursor_credentials(state: State<'_, AppState>) -> Result<(), String> {
    let ids = state
        .list()
        .map_err(|error| error.to_string())?
        .into_iter()
        .map(|account| account.id)
        .collect::<Vec<_>>();
    for id in ids {
        state.delete(&id).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn export_cursor_accounts(
    account_ids: Vec<String>,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state
        .export_json(&account_ids)
        .map(|json| json.to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_cursor_accounts_export(
    account_ids: Vec<String>,
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let json = state
        .export_json(&account_ids)
        .map_err(|error| error.to_string())?;
    let path = std::path::PathBuf::from(path);
    // The user explicitly chose this export path; unlike app-data account
    // persistence, an export must not create a second credential-bearing
    // backup beside the file.
    storage::write_bytes_atomic(&path, json.as_bytes(), false)
        .map_err(|error| format!("保存 JSON 失败：{error}"))?;
    state
        .remember_saved_export(path)
        .map_err(|error| format!("记录导出位置失败：{error}"))
}

#[tauri::command]
fn reveal_saved_cursor_accounts_export(
    path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let path = state
        .authorize_saved_export(std::path::Path::new(&path))
        .map_err(|error| error.to_string())?;
    tauri_plugin_opener::reveal_item_in_dir(path)
        .map_err(|error| format!("打开保存位置失败：{error}"))
}

#[tauri::command]
fn perform_close_action(
    action: String,
    remember: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    match action.as_str() {
        "tray" => {
            if remember {
                state
                    .set_close_behavior(CloseBehavior::MinimizeToTray)
                    .map_err(|error| error.to_string())?;
            }
            if let Some(window) = app.get_webview_window("main") {
                window.hide().map_err(|error| error.to_string())?;
            }
        }
        "exit" => {
            if remember {
                state
                    .set_close_behavior(CloseBehavior::Exit)
                    .map_err(|error| error.to_string())?;
            }
            app.exit(0);
        }
        _ => return Err("未知关闭动作".to_owned()),
    }
    Ok(())
}

#[tauri::command]
fn get_update_settings(state: State<'_, AppState>) -> Result<UpdateSettings, String> {
    state
        .update_settings_for_ui()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_update_settings(
    settings: UpdateSettings,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .save_update_settings(&settings)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn mark_update_checked(state: State<'_, AppState>) -> Result<UpdateSettings, String> {
    state
        .mark_update_checked()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn prepare_update_install(
    from_version: String,
    to_version: String,
    notes: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state
        .prepare_update_install(&from_version, &to_version, &notes)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn consume_version_change(
    current_version: String,
    state: State<'_, AppState>,
) -> Result<Option<PendingNotes>, String> {
    state
        .consume_version_change(&current_version)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn get_release_history(limit: Option<usize>) -> Vec<ReleaseHistoryItem> {
    updater::release_history(limit)
}

#[tauri::command]
fn get_desktop_platform() -> Result<DesktopPlatformInfo, String> {
    let platform = match std::env::consts::OS {
        "windows" => "windows",
        "macos" => "darwin",
        "linux" => "linux",
        other => return Err(format!("不支持的更新平台：{other}")),
    };
    let arch = match std::env::consts::ARCH {
        "x86_64" => "x86_64",
        "aarch64" => "aarch64",
        other => return Err(format!("不支持的更新架构：{other}")),
    };
    Ok(DesktopPlatformInfo { platform, arch })
}

#[tauri::command]
async fn download_linux_package_update(
    expected_version: String,
    app: tauri::AppHandle,
) -> Result<linux_updater::PreparedLinuxUpdate, String> {
    #[cfg(target_os = "linux")]
    {
        let updates = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("updates");
        return linux_updater::download_package_update(&app, &updates, &expected_version)
            .await
            .map_err(|error| error.to_string());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (expected_version, app);
        Err("Linux 包更新仅在 Linux 可用".to_owned())
    }
}

#[tauri::command]
fn install_linux_package_update(version: String, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    {
        let updates = app
            .path()
            .app_data_dir()
            .map_err(|error| error.to_string())?
            .join("updates");
        return linux_updater::install_package_update(&updates, &version)
            .map_err(|error| error.to_string());
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (version, app);
        Err("Linux 包更新仅在 Linux 可用".to_owned())
    }
}

#[tauri::command]
fn discard_linux_package_update(version: String, app: tauri::AppHandle) -> Result<(), String> {
    let updates = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("updates");
    linux_updater::discard_prepared_package(&updates, &version).map_err(|error| error.to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let state = AppState::new(data_dir)
                .map_err(|error| std::io::Error::other(error.to_string()))?;
            let desktop_settings = state.desktop_settings();
            app.manage(state);
            if let Some(window) = app.get_webview_window("main") {
                if desktop_settings.remember_window {
                    if let (Some(x), Some(y)) =
                        (desktop_settings.window_x, desktop_settings.window_y)
                    {
                        // A monitor may have been disconnected since the last
                        // run. Only restore coordinates that still land on an
                        // available monitor; otherwise retain the framework's
                        // safe default placement.
                        if window
                            .monitor_from_point(x as f64, y as f64)
                            .ok()
                            .flatten()
                            .is_some()
                        {
                            let _ = window.set_position(tauri::Position::Physical(
                                tauri::PhysicalPosition::new(x, y),
                            ));
                        }
                    }
                    if let (Some(width), Some(height)) = (
                        desktop_settings.window_width,
                        desktop_settings.window_height,
                    ) {
                        let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize::new(
                            width, height,
                        )));
                    }
                }
                if desktop_settings.start_minimized {
                    let _ = window.hide();
                }
            }
            let show =
                tauri::menu::MenuItem::with_id(app, "show", "显示 / 隐藏", true, None::<&str>)?;
            let update =
                tauri::menu::MenuItem::with_id(app, "update", "检查更新", true, None::<&str>)?;
            let quit = tauri::menu::MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = tauri::menu::Menu::with_items(app, &[&show, &update, &quit])?;
            tauri::tray::TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                    "update" => {
                        let _ = app.emit("manual-update-requested", ());
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let mut settings = state.desktop_settings();
                if settings.remember_window {
                    if let Ok(position) = window.outer_position() {
                        settings.window_x = Some(position.x);
                        settings.window_y = Some(position.y);
                    }
                    if let Ok(size) = window.outer_size() {
                        settings.window_width = Some(size.width);
                        settings.window_height = Some(size.height);
                    }
                    let _ = state.save_desktop_settings(&settings);
                }
                match state.close_behavior() {
                    CloseBehavior::Ask => {
                        api.prevent_close();
                        let _ = window.emit("close-requested", ());
                    }
                    CloseBehavior::MinimizeToTray => {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                    CloseBehavior::Exit => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            list_cursor_accounts,
            load_current_cursor_account,
            import_cockpit_accounts_json,
            select_cursor_account,
            query_cursor_usage,
            refresh_cursor_account,
            refresh_cursor_accounts,
            delete_cursor_account,
            delete_cursor_accounts,
            update_cursor_account_tags,
            get_desktop_settings,
            save_desktop_settings,
            clear_cursor_credentials,
            export_cursor_accounts,
            save_cursor_accounts_export,
            reveal_saved_cursor_accounts_export,
            perform_close_action,
            get_update_settings,
            save_update_settings,
            mark_update_checked,
            prepare_update_install,
            consume_version_change,
            get_release_history,
            get_desktop_platform,
            download_linux_package_update,
            install_linux_package_update,
            discard_linux_package_update,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Cursor Usage Viewer");
}
