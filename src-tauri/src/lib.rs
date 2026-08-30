mod cockpit_import;
mod cursor_db;
mod error;
mod model;
mod provider;
mod state;

use tauri::{Manager, State};
use zeroize::Zeroizing;

use model::{AccountSummary, QuotaSnapshot};
use state::AppState;

#[tauri::command]
fn load_current_cursor_account(state: State<'_, AppState>) -> Result<AccountSummary, String> {
    let account = cursor_db::read_default_cursor_account().map_err(|error| error.to_string())?;
    let managed = account
        .into_managed()
        .ok_or_else(|| error::AppError::AccessTokenMissing.to_string())?;
    state
        .upsert_local_account(managed)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn import_cockpit_accounts_json(
    payload: String,
    state: State<'_, AppState>,
) -> Result<Vec<AccountSummary>, String> {
    let payload = Zeroizing::new(payload);
    let imported = cockpit_import::parse_cockpit_accounts_json(payload.as_str())
        .map_err(|error| error.to_string())?;
    state
        .replace_cockpit_accounts(imported)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn select_cursor_account(
    account_id: String,
    state: State<'_, AppState>,
) -> Result<AccountSummary, String> {
    state
        .select_account(&account_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn query_cursor_usage(state: State<'_, AppState>) -> Result<QuotaSnapshot, String> {
    let access_token = state
        .access_token_copy()
        .map_err(|error| error.to_string())?;
    state
        .provider
        .fetch_quota_snapshot(access_token.as_str())
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn clear_cursor_credentials(state: State<'_, AppState>) -> Result<(), String> {
    state.clear().map_err(|error| error.to_string())
}

pub fn run() {
    let state = AppState::new().expect("failed to initialize local application state");
    tauri::Builder::default()
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            load_current_cursor_account,
            import_cockpit_accounts_json,
            select_cursor_account,
            query_cursor_usage,
            clear_cursor_credentials
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Cursor usage viewer")
        .run(|app_handle, event| {
            let should_clear = matches!(
                event,
                tauri::RunEvent::ExitRequested { .. }
                    | tauri::RunEvent::Exit
                    | tauri::RunEvent::WindowEvent {
                        event: tauri::WindowEvent::CloseRequested { .. },
                        ..
                    }
            );
            if should_clear {
                let _ = app_handle.state::<AppState>().clear();
            }
        });
}
