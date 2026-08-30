use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    model::{CursorAccountRecord, CursorAccountSummary, CursorAccountView, ACCOUNT_SCHEMA_VERSION},
};

const INDEX_FILE: &str = "cursor_accounts.json";
const ACCOUNTS_DIR: &str = "cursor_accounts";

#[derive(Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct AccountIndex {
    schema_version: u32,
    accounts: Vec<CursorAccountSummary>,
}

pub struct AccountStore {
    root: PathBuf,
}

impl AccountStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn upsert(&self, account: CursorAccountRecord) -> AppResult<CursorAccountView> {
        validate_account_id(&account.id)?;
        if account.schema_version != ACCOUNT_SCHEMA_VERSION {
            return Err(AppError::Storage("不支持的账号存储版本".to_owned()));
        }
        let existing = self
            .list_records()?
            .into_iter()
            .find(|item| item.id == account.id || accounts_are_duplicates(item, &account));
        let account = match existing {
            Some(primary) => merge_account(primary, account),
            None => account,
        };
        write_json_atomic(&self.account_path(&account.id)?, &account, true)?;

        let mut index = self.load_index_or_rebuild()?;
        if let Some(summary) = index.accounts.iter_mut().find(|item| item.id == account.id) {
            *summary = account.summary();
        } else {
            index.accounts.push(account.summary());
        }
        write_json_atomic(&self.index_path(), &index, true)?;
        Ok(account.view(None))
    }

    pub fn list_records(&self) -> AppResult<Vec<CursorAccountRecord>> {
        let index = self.load_index_or_rebuild()?;
        let mut records = Vec::with_capacity(index.accounts.len());
        for summary in index.accounts {
            if let Ok(record) = read_json_with_backup(&self.account_path(&summary.id)?) {
                records.push(record);
            }
        }
        Ok(records)
    }

    pub fn list_views(&self, current_id: Option<&str>) -> AppResult<Vec<CursorAccountView>> {
        Ok(self
            .list_records()?
            .into_iter()
            .map(|account| account.view(current_id))
            .collect())
    }

    pub fn get(&self, account_id: &str) -> AppResult<CursorAccountRecord> {
        read_json_with_backup(&self.account_path(account_id)?)
    }

    pub fn export_json(&self, account_ids: &[String]) -> AppResult<String> {
        let accounts = account_ids
            .iter()
            .map(|id| self.get(id))
            .collect::<AppResult<Vec<_>>>()?;
        serde_json::to_string_pretty(&accounts).map_err(storage_error)
    }

    pub fn delete(&self, account_id: &str) -> AppResult<()> {
        let account_path = self.account_path(account_id)?;
        remove_if_exists(&account_path)?;
        remove_if_exists(&backup_path(&account_path)?)?;

        let mut index = self.load_index_or_rebuild()?;
        index.accounts.retain(|account| account.id != account_id);
        let index_path = self.index_path();
        write_json_atomic(&index_path, &index, false)?;
        remove_if_exists(&backup_path(&index_path)?)?;
        Ok(())
    }

    fn load_index_or_rebuild(&self) -> AppResult<AccountIndex> {
        let path = self.index_path();
        if path.exists() {
            if let Ok(index) = read_json_with_backup::<AccountIndex>(&path) {
                if index.schema_version == ACCOUNT_SCHEMA_VERSION {
                    return Ok(index);
                }
            }
        }
        self.rebuild_index()
    }

    fn rebuild_index(&self) -> AppResult<AccountIndex> {
        let directory = self.accounts_dir();
        let mut accounts = Vec::new();
        if directory.exists() {
            let entries = fs::read_dir(&directory).map_err(storage_error)?;
            for entry in entries {
                let path = entry.map_err(storage_error)?.path();
                if path.extension().and_then(|value| value.to_str()) != Some("json") {
                    continue;
                }
                if let Ok(account) = read_json_with_backup::<CursorAccountRecord>(&path) {
                    if account.schema_version == ACCOUNT_SCHEMA_VERSION
                        && validate_account_id(&account.id).is_ok()
                    {
                        accounts.push(account.summary());
                    }
                }
            }
        }
        accounts.sort_by(|left, right| right.last_used.cmp(&left.last_used));
        accounts.dedup_by(|left, right| left.id == right.id);
        let index = AccountIndex {
            schema_version: ACCOUNT_SCHEMA_VERSION,
            accounts,
        };
        write_json_atomic(&self.index_path(), &index, true)?;
        Ok(index)
    }

    fn index_path(&self) -> PathBuf {
        self.root.join(INDEX_FILE)
    }

    fn accounts_dir(&self) -> PathBuf {
        self.root.join(ACCOUNTS_DIR)
    }

    fn account_path(&self, account_id: &str) -> AppResult<PathBuf> {
        validate_account_id(account_id)?;
        Ok(self.accounts_dir().join(format!("{account_id}.json")))
    }
}

fn accounts_are_duplicates(left: &CursorAccountRecord, right: &CursorAccountRecord) -> bool {
    let left_auth = resolved_auth_id(left);
    let right_auth = resolved_auth_id(right);
    match (&left_auth, &right_auth) {
        (Some(left), Some(right)) => return left == right,
        (Some(_), None) | (None, Some(_)) => return false,
        (None, None) => {}
    }

    let left_email = left
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let right_email = right
        .email
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let (Some(left), Some(right)) = (left_email, right_email) {
        if left.eq_ignore_ascii_case(right) {
            return true;
        }
        return false;
    }
    !left.access_token.is_empty() && left.access_token == right.access_token
}

fn resolved_auth_id(account: &CursorAccountRecord) -> Option<String> {
    account
        .auth_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            let raw = account.cursor_auth_raw.as_ref()?.as_object()?;
            ["authId", "workosId", "auth_id", "workos_id"]
                .iter()
                .find_map(|key| raw.get(*key)?.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
        })
        .or_else(|| jwt_string_claim(&account.access_token, "sub"))
}

fn jwt_string_claim(token: &str, claim: &str) -> Option<String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice::<serde_json::Value>(&decoded)
        .ok()?
        .get(claim)?
        .as_str()
        .map(ToOwned::to_owned)
}

fn merge_account(
    mut primary: CursorAccountRecord,
    incoming: CursorAccountRecord,
) -> CursorAccountRecord {
    if incoming
        .email
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        primary.email = incoming.email;
    }
    if incoming
        .auth_id
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        primary.auth_id = incoming.auth_id;
    }
    if incoming
        .name
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        primary.name = incoming.name;
    }
    merge_tags(&mut primary.tags, incoming.tags);
    if !incoming.access_token.is_empty() {
        primary.access_token = incoming.access_token;
    }
    if incoming
        .refresh_token
        .as_deref()
        .is_some_and(|value| !value.is_empty())
    {
        primary.refresh_token = incoming.refresh_token;
    }
    replace_some(&mut primary.membership_type, incoming.membership_type);
    replace_some(
        &mut primary.subscription_status,
        incoming.subscription_status,
    );
    replace_some(&mut primary.sign_up_type, incoming.sign_up_type);
    replace_some(&mut primary.cursor_auth_raw, incoming.cursor_auth_raw);
    replace_some(&mut primary.cursor_usage_raw, incoming.cursor_usage_raw);
    replace_some(&mut primary.status, incoming.status);
    replace_some(&mut primary.status_reason, incoming.status_reason);
    if incoming.core_usage.as_ref().is_some_and(|value| {
        primary
            .core_usage
            .as_ref()
            .is_none_or(|old| value.updated_at >= old.updated_at)
    }) {
        primary.core_usage = incoming.core_usage;
    }
    if sand_timestamp(incoming.sand.as_ref()) >= sand_timestamp(primary.sand.as_ref()) {
        replace_some(&mut primary.sand, incoming.sand);
    }
    if incoming.last_error_at.unwrap_or_default() >= primary.last_error_at.unwrap_or_default() {
        primary.last_error = incoming.last_error;
        primary.last_error_at = incoming.last_error_at;
    }
    primary.created_at = primary.created_at.min(incoming.created_at);
    primary.last_used = primary.last_used.max(incoming.last_used);
    primary
}

fn replace_some<T>(target: &mut Option<T>, incoming: Option<T>) {
    if incoming.is_some() {
        *target = incoming;
    }
}

fn merge_tags(target: &mut Vec<String>, incoming: Vec<String>) {
    for tag in incoming {
        let tag = tag.trim();
        if !tag.is_empty() && !target.iter().any(|item| item.eq_ignore_ascii_case(tag)) {
            target.push(tag.to_owned());
        }
    }
}

fn sand_timestamp(value: Option<&crate::model::SandSnapshot>) -> i64 {
    value
        .map(|snapshot| {
            snapshot
                .usage_updated_at
                .unwrap_or_default()
                .max(snapshot.access_updated_at.unwrap_or_default())
        })
        .unwrap_or_default()
}

fn validate_account_id(account_id: &str) -> AppResult<()> {
    let valid = !account_id.is_empty()
        && account_id.len() <= 256
        && !account_id.contains("..")
        && account_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '_' | '-' | '.')
        });
    if valid {
        Ok(())
    } else {
        Err(AppError::InvalidAccountId)
    }
}

fn backup_path(path: &Path) -> AppResult<PathBuf> {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or(AppError::InvalidAccountId)?;
    Ok(path.with_file_name(format!("{name}.bak")))
}

fn read_json_with_backup<T: DeserializeOwned>(path: &Path) -> AppResult<T> {
    match fs::read(path)
        .map_err(storage_error)
        .and_then(|bytes| serde_json::from_slice(&bytes).map_err(storage_error))
    {
        Ok(value) => Ok(value),
        Err(primary_error) => {
            let backup = backup_path(path)?;
            let bytes = fs::read(&backup).map_err(|_| primary_error)?;
            let value = serde_json::from_slice(&bytes).map_err(storage_error)?;
            write_bytes_atomic(path, &bytes, false)?;
            Ok(value)
        }
    }
}

fn write_json_atomic<T: Serialize>(path: &Path, value: &T, backup: bool) -> AppResult<()> {
    let bytes = serde_json::to_vec_pretty(value).map_err(storage_error)?;
    write_bytes_atomic(path, &bytes, backup)
}

fn write_bytes_atomic(path: &Path, bytes: &[u8], create_backup: bool) -> AppResult<()> {
    let parent = path
        .parent()
        .ok_or_else(|| AppError::Storage("无法定位存储目录".to_owned()))?;
    fs::create_dir_all(parent).map_err(storage_error)?;
    if create_backup && path.exists() {
        fs::copy(path, backup_path(path)?).map_err(storage_error)?;
    }
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let temporary = parent.join(format!(".{name}.{}.{}.tmp", std::process::id(), nonce));
    let mut file = File::create(&temporary).map_err(storage_error)?;
    file.write_all(bytes).map_err(storage_error)?;
    file.flush().map_err(storage_error)?;
    file.sync_all().map_err(storage_error)?;
    drop(file);
    if path.exists() {
        fs::remove_file(path).map_err(storage_error)?;
    }
    fs::rename(&temporary, path).map_err(|error| {
        let _ = fs::remove_file(&temporary);
        storage_error(error)
    })?;
    Ok(())
}

fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(error.to_string())
}

fn remove_if_exists(path: &Path) -> AppResult<()> {
    if path.exists() {
        fs::remove_file(path).map_err(storage_error)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::AccountStore;
    use crate::model::CursorAccountRecord;

    #[test]
    fn saved_account_is_restored_without_exposing_tokens_in_the_view() {
        let directory = tempdir().unwrap();
        let store = AccountStore::new(directory.path().to_path_buf());
        let account = CursorAccountRecord::fake_for_test(
            "cursor_test",
            "person@example.invalid",
            "fake.header.signature",
        );

        store.upsert(account).unwrap();

        let reopened = AccountStore::new(directory.path().to_path_buf());
        let views = reopened.list_views(None).unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].email.as_deref(), Some("person@example.invalid"));
        let serialized = serde_json::to_string(&views).unwrap();
        assert!(!serialized.contains("fake.header.signature"));
    }

    #[test]
    fn duplicate_auth_identity_merges_into_the_stable_primary_record() {
        let directory = tempdir().unwrap();
        let store = AccountStore::new(directory.path().to_path_buf());
        let mut primary = CursorAccountRecord::fake_for_test(
            "cursor_stable",
            "old@example.invalid",
            "old.header.signature",
        );
        primary.auth_id = Some("auth0|user_same".to_owned());
        primary.tags = vec!["First".to_owned()];
        primary.created_at = 10;
        primary.last_used = 20;
        store.upsert(primary).unwrap();

        let mut duplicate = CursorAccountRecord::fake_for_test(
            "cursor_imported",
            "new@example.invalid",
            "new.header.signature",
        );
        duplicate.auth_id = Some("auth0|user_same".to_owned());
        duplicate.tags = vec!["first".to_owned(), "Second".to_owned()];
        duplicate.created_at = 30;
        duplicate.last_used = 40;
        let view = store.upsert(duplicate).unwrap();

        assert_eq!(view.id, "cursor_stable");
        assert_eq!(view.email.as_deref(), Some("new@example.invalid"));
        assert_eq!(view.tags, ["First", "Second"]);
        assert_eq!(view.created_at, 10);
        assert_eq!(view.last_used, 40);
        assert_eq!(store.list_views(None).unwrap().len(), 1);
    }

    #[test]
    fn corrupt_index_is_rebuilt_from_valid_account_details() {
        let directory = tempdir().unwrap();
        let store = AccountStore::new(directory.path().to_path_buf());
        store
            .upsert(CursorAccountRecord::fake_for_test(
                "cursor_recover",
                "recover@example.invalid",
                "recover.header.signature",
            ))
            .unwrap();
        std::fs::write(directory.path().join("cursor_accounts.json"), b"not-json").unwrap();
        std::fs::write(
            directory.path().join("cursor_accounts.json.bak"),
            b"also-bad",
        )
        .unwrap();

        let views = AccountStore::new(directory.path().to_path_buf())
            .list_views(None)
            .unwrap();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].id, "cursor_recover");
    }

    #[test]
    fn deleting_an_account_removes_credential_files_and_backups() {
        let directory = tempdir().unwrap();
        let store = AccountStore::new(directory.path().to_path_buf());
        let account = CursorAccountRecord::fake_for_test(
            "cursor_delete",
            "delete@example.invalid",
            "delete.header.signature",
        );
        store.upsert(account.clone()).unwrap();
        store.upsert(account).unwrap();

        store.delete("cursor_delete").unwrap();

        assert!(store.list_views(None).unwrap().is_empty());
        assert!(!directory
            .path()
            .join("cursor_accounts/cursor_delete.json")
            .exists());
        assert!(!directory
            .path()
            .join("cursor_accounts/cursor_delete.json.bak")
            .exists());
        let all_bytes = std::fs::read(directory.path().join("cursor_accounts.json")).unwrap();
        assert!(!String::from_utf8_lossy(&all_bytes).contains("cursor_delete"));
        assert!(!directory.path().join("cursor_accounts.json.bak").exists());
    }
}
