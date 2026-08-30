mod cockpit_import;
mod cursor_db;
mod error;
mod model;
mod provider;
mod state;
mod storage;

use tauri::{Manager, State};
use zeroize::Zeroizing;

use model::{BatchAccountResult, CursorAccountView};
use state::AppState;

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

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            app.manage(
                AppState::new(data_dir)
                    .map_err(|error| std::io::Error::other(error.to_string()))?,
            );
            Ok(())
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
            clear_cursor_credentials,
            export_cursor_accounts,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Cursor Usage Viewer");
}
