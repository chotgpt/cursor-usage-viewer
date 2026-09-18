use std::{
    env,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{Connection, OpenFlags, OptionalExtension, TransactionBehavior};

use crate::{
    error::{AppError, AppResult},
    model::RawCursorAccount,
};

const ACCESS_TOKEN_KEY: &str = "cursorAuth/accessToken";
const REFRESH_TOKEN_KEY: &str = "cursorAuth/refreshToken";
const EMAIL_KEY: &str = "cursorAuth/cachedEmail";
const MEMBERSHIP_KEY: &str = "cursorAuth/stripeMembershipType";
const SUBSCRIPTION_STATUS_KEY: &str = "cursorAuth/stripeSubscriptionStatus";
const SIGNUP_TYPE_KEY: &str = "cursorAuth/cachedSignUpType";
const CURSOR_ACCESS_TOKEN_KEY: &str = "cursor.accessToken";
const CURSOR_EMAIL_KEY: &str = "cursor.email";
const UNKNOWN_EMAIL: &str = "unknown";

pub fn default_cursor_database_path() -> AppResult<PathBuf> {
    #[cfg(target_os = "windows")]
    let base =
        PathBuf::from(env::var_os("APPDATA").ok_or(AppError::AppDataUnavailable)?).join("Cursor");
    #[cfg(target_os = "macos")]
    let base = PathBuf::from(env::var_os("HOME").ok_or(AppError::AppDataUnavailable)?)
        .join("Library/Application Support/Cursor");
    #[cfg(target_os = "linux")]
    let base = PathBuf::from(env::var_os("HOME").ok_or(AppError::AppDataUnavailable)?)
        .join(".config/Cursor");
    Ok(base.join("User").join("globalStorage").join("state.vscdb"))
}

#[cfg(test)]
fn cursor_database_path_for(
    platform: &str,
    appdata: Option<&Path>,
    home: Option<&Path>,
) -> AppResult<PathBuf> {
    let base = match platform {
        "windows" => appdata.ok_or(AppError::AppDataUnavailable)?.join("Cursor"),
        "macos" => home
            .ok_or(AppError::AppDataUnavailable)?
            .join("Library/Application Support/Cursor"),
        "linux" => home
            .ok_or(AppError::AppDataUnavailable)?
            .join(".config/Cursor"),
        _ => return Err(AppError::AppDataUnavailable),
    };
    Ok(base.join("User").join("globalStorage").join("state.vscdb"))
}

pub fn read_default_cursor_account() -> AppResult<RawCursorAccount> {
    read_cursor_account(&default_cursor_database_path()?)
}

pub fn read_cursor_account(path: &Path) -> AppResult<RawCursorAccount> {
    if !path.is_file() {
        return Err(AppError::DatabaseMissing(path.display().to_string()));
    }

    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| AppError::DatabaseOpen(error.to_string()))?;

    Ok(RawCursorAccount {
        access_token: read_value(&connection, ACCESS_TOKEN_KEY)?,
        refresh_token: read_value(&connection, REFRESH_TOKEN_KEY)?,
        email: read_value(&connection, EMAIL_KEY)?,
        membership: read_value(&connection, MEMBERSHIP_KEY)?,
        signup_type: read_value(&connection, SIGNUP_TYPE_KEY)?,
    })
}

fn read_value(connection: &Connection, key: &str) -> AppResult<Option<String>> {
    let raw = connection
        .query_row(
            "SELECT value FROM ItemTable WHERE key = ?1 LIMIT 1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| AppError::DatabaseRead(error.to_string()))?;

    Ok(raw.map(normalize_storage_string))
}

fn normalize_storage_string(raw: String) -> String {
    match serde_json::from_str::<String>(&raw) {
        Ok(value) => value,
        Err(_) => raw,
    }
}

/// Play 一键切号的隔离写入路径（D-033），与只读导入严格分离。
///
/// 只打开已存在的默认数据库：`READ_WRITE | NO_MUTEX`，不带 `CREATE`、不复制
/// 数据库、不修改 journal mode，并设置有界 `busy_timeout`。全部写入在单个
/// `Immediate` 事务中以参数化 `INSERT OR REPLACE` 执行。
///
/// 四个必写键始终覆盖；Refresh Token、套餐、订阅状态仅在账号字段非空时写入，
/// 缺失时保留旧值；邮箱缺失时两个邮箱键写字面值 `unknown`。绝不触碰
/// `cursorAuth/authId`、`cursorAuth/cachedSignUpType` 或其他键。
/// 错误中只含固定键名与 sqlite 错误文本，不含 Token、邮箱或 SQL 值。
pub fn inject_cursor_account_record(
    db_path: &Path,
    account: &crate::model::CursorAccountRecord,
) -> AppResult<()> {
    let access_token = account.access_token.trim();
    if access_token.is_empty() {
        return Err(AppError::AccessTokenMissing);
    }
    if !db_path.is_file() {
        return Err(AppError::DatabaseMissing(db_path.display().to_string()));
    }

    let mut connection = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| AppError::DatabaseOpen(error.to_string()))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| AppError::DatabaseWrite(error.to_string()))?;

    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| AppError::DatabaseWrite(error.to_string()))?;
    let email = non_empty_string(account.email.as_deref()).unwrap_or(UNKNOWN_EMAIL);
    write_item(&transaction, ACCESS_TOKEN_KEY, access_token)?;
    write_item(&transaction, EMAIL_KEY, email)?;
    write_item(&transaction, CURSOR_ACCESS_TOKEN_KEY, access_token)?;
    write_item(&transaction, CURSOR_EMAIL_KEY, email)?;
    if let Some(value) = non_empty_string(account.refresh_token.as_deref()) {
        write_item(&transaction, REFRESH_TOKEN_KEY, value)?;
    }
    if let Some(value) = non_empty_string(account.membership_type.as_deref()) {
        write_item(&transaction, MEMBERSHIP_KEY, value)?;
    }
    if let Some(value) = non_empty_string(account.subscription_status.as_deref()) {
        write_item(&transaction, SUBSCRIPTION_STATUS_KEY, value)?;
    }
    transaction
        .commit()
        .map_err(|error| AppError::DatabaseWrite(error.to_string()))?;
    Ok(())
}

fn non_empty_string(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|text| !text.is_empty())
}

fn write_item(transaction: &rusqlite::Transaction, key: &str, value: &str) -> AppResult<()> {
    transaction
        .execute(
            "INSERT OR REPLACE INTO ItemTable (key, value) VALUES (?1, ?2)",
            rusqlite::params![key, value],
        )
        .map_err(|error| AppError::DatabaseWrite(format!("{key}: {error}")))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use tempfile::tempdir;

    use super::*;

    #[test]
    fn reads_only_the_five_authorized_keys() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.vscdb");
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)",
                [],
            )
            .unwrap();
        for (key, value) in [
            (ACCESS_TOKEN_KEY, "secret-access"),
            (REFRESH_TOKEN_KEY, "secret-refresh"),
            (EMAIL_KEY, "\"person@example.com\""),
            (MEMBERSHIP_KEY, "pro"),
            (SIGNUP_TYPE_KEY, "email"),
            ("unrelated/private", "must-not-be-read"),
        ] {
            connection
                .execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                    [key, value],
                )
                .unwrap();
        }
        drop(connection);

        let account = read_cursor_account(&path).unwrap();
        assert_eq!(account.email.as_deref(), Some("person@example.com"));
        assert_eq!(account.membership.as_deref(), Some("pro"));
        assert_eq!(account.signup_type.as_deref(), Some("email"));
        assert_eq!(account.access_token.as_deref(), Some("secret-access"));
        assert_eq!(account.refresh_token.as_deref(), Some("secret-refresh"));
    }

    #[test]
    fn refuses_a_missing_database_without_creating_it() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("missing.vscdb");
        assert!(matches!(
            read_cursor_account(&path),
            Err(AppError::DatabaseMissing(_))
        ));
        assert!(!path.exists());
    }

    #[test]
    fn resolves_cursor_database_paths_for_all_desktop_platforms() {
        let appdata = Path::new("C:/Fixture/Roaming");
        let home = Path::new("/fixture/home");
        assert_eq!(
            cursor_database_path_for("windows", Some(appdata), None).unwrap(),
            appdata.join("Cursor/User/globalStorage/state.vscdb")
        );
        assert_eq!(
            cursor_database_path_for("macos", None, Some(home)).unwrap(),
            home.join("Library/Application Support/Cursor/User/globalStorage/state.vscdb")
        );
        assert_eq!(
            cursor_database_path_for("linux", None, Some(home)).unwrap(),
            home.join(".config/Cursor/User/globalStorage/state.vscdb")
        );
    }

    fn fixture_state_db(path: &Path, entries: &[(&str, &str)]) {
        let connection = Connection::open(path).unwrap();
        connection
            .execute(
                "CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)",
                [],
            )
            .unwrap();
        for (key, value) in entries {
            connection
                .execute(
                    "INSERT INTO ItemTable (key, value) VALUES (?1, ?2)",
                    [key, value],
                )
                .unwrap();
        }
        drop(connection);
    }

    fn read_raw_key(path: &Path, key: &str) -> Option<String> {
        let connection = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .unwrap();
        connection
            .query_row(
                "SELECT value FROM ItemTable WHERE key = ?1 LIMIT 1",
                [key],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .unwrap()
    }

    fn switch_account() -> crate::model::CursorAccountRecord {
        let mut account = crate::model::CursorAccountRecord::fake_for_test(
            "cursor_switch",
            "switch@example.invalid",
            "switch.header.signature",
        );
        account.refresh_token = Some("switch-refresh".to_owned());
        account.membership_type = Some("pro".to_owned());
        account.subscription_status = Some("active".to_owned());
        account
    }

    #[test]
    fn inject_writes_four_required_keys_and_three_conditional_keys() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.vscdb");
        fixture_state_db(
            &path,
            &[
                ("cursorAuth/accessToken", "old-access"),
                ("cursorAuth/refreshToken", "old-refresh"),
                ("cursorAuth/cachedEmail", "old@example.invalid"),
                ("cursorAuth/stripeMembershipType", "old-plan"),
                ("cursorAuth/stripeSubscriptionStatus", "old-status"),
                ("cursor.accessToken", "old-access"),
                ("cursor.email", "old@example.invalid"),
                ("cursorAuth/authId", "auth0|user_keep"),
                ("cursorAuth/cachedSignUpType", "Google"),
                ("unrelated/private", "must-not-change"),
            ],
        );

        super::inject_cursor_account_record(&path, &switch_account()).unwrap();

        assert_eq!(
            read_raw_key(&path, "cursorAuth/accessToken").as_deref(),
            Some("switch.header.signature")
        );
        assert_eq!(
            read_raw_key(&path, "cursor.accessToken").as_deref(),
            Some("switch.header.signature")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/cachedEmail").as_deref(),
            Some("switch@example.invalid")
        );
        assert_eq!(
            read_raw_key(&path, "cursor.email").as_deref(),
            Some("switch@example.invalid")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/refreshToken").as_deref(),
            Some("switch-refresh")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/stripeMembershipType").as_deref(),
            Some("pro")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/stripeSubscriptionStatus").as_deref(),
            Some("active")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/authId").as_deref(),
            Some("auth0|user_keep")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/cachedSignUpType").as_deref(),
            Some("Google")
        );
        assert_eq!(
            read_raw_key(&path, "unrelated/private").as_deref(),
            Some("must-not-change")
        );
    }

    #[test]
    fn inject_keeps_old_values_when_optional_fields_are_missing() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.vscdb");
        fixture_state_db(
            &path,
            &[
                ("cursorAuth/accessToken", "old-access"),
                ("cursorAuth/refreshToken", "old-refresh"),
                ("cursorAuth/cachedEmail", "old@example.invalid"),
                ("cursorAuth/stripeMembershipType", "old-plan"),
                ("cursorAuth/stripeSubscriptionStatus", "old-status"),
                ("cursor.accessToken", "old-access"),
                ("cursor.email", "old@example.invalid"),
            ],
        );
        let mut account = switch_account();
        account.refresh_token = None;
        account.membership_type = None;
        account.subscription_status = None;

        super::inject_cursor_account_record(&path, &account).unwrap();

        assert_eq!(
            read_raw_key(&path, "cursorAuth/accessToken").as_deref(),
            Some("switch.header.signature")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/refreshToken").as_deref(),
            Some("old-refresh")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/stripeMembershipType").as_deref(),
            Some("old-plan")
        );
        assert_eq!(
            read_raw_key(&path, "cursorAuth/stripeSubscriptionStatus").as_deref(),
            Some("old-status")
        );
    }

    #[test]
    fn inject_writes_unknown_email_when_account_has_no_email() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.vscdb");
        fixture_state_db(&path, &[]);
        let mut account = switch_account();
        account.email = None;

        super::inject_cursor_account_record(&path, &account).unwrap();

        assert_eq!(
            read_raw_key(&path, "cursorAuth/cachedEmail").as_deref(),
            Some("unknown")
        );
        assert_eq!(
            read_raw_key(&path, "cursor.email").as_deref(),
            Some("unknown")
        );
    }

    #[test]
    fn inject_fails_without_creating_a_missing_database() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("missing.vscdb");

        assert!(matches!(
            super::inject_cursor_account_record(&path, &switch_account()),
            Err(AppError::DatabaseMissing(_))
        ));
        assert!(!path.exists());
    }

    #[test]
    fn inject_fails_without_creating_tables_or_leaving_partial_writes() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.vscdb");
        Connection::open(&path).unwrap();

        let result = super::inject_cursor_account_record(&path, &switch_account());

        assert!(matches!(result, Err(AppError::DatabaseWrite(_))));
        let connection = Connection::open(&path).unwrap();
        let table_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'ItemTable'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(table_count, 0);
    }

    #[test]
    fn inject_rejects_an_empty_access_token_before_touching_the_database() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("state.vscdb");
        fixture_state_db(&path, &[("cursorAuth/accessToken", "old-access")]);
        let mut account = switch_account();
        account.access_token.clear();

        assert!(matches!(
            super::inject_cursor_account_record(&path, &account),
            Err(AppError::AccessTokenMissing)
        ));
        assert_eq!(
            read_raw_key(&path, "cursorAuth/accessToken").as_deref(),
            Some("old-access")
        );
    }
}
