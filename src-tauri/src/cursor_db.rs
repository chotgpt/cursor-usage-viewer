use std::{
    env,
    path::{Path, PathBuf},
};

use rusqlite::{Connection, OpenFlags, OptionalExtension};

use crate::{
    error::{AppError, AppResult},
    model::RawCursorAccount,
};

const ACCESS_TOKEN_KEY: &str = "cursorAuth/accessToken";
const REFRESH_TOKEN_KEY: &str = "cursorAuth/refreshToken";
const EMAIL_KEY: &str = "cursorAuth/cachedEmail";
const MEMBERSHIP_KEY: &str = "cursorAuth/stripeMembershipType";
const SIGNUP_TYPE_KEY: &str = "cursorAuth/cachedSignUpType";

pub fn default_cursor_database_path() -> AppResult<PathBuf> {
    let appdata = env::var_os("APPDATA").ok_or(AppError::AppDataUnavailable)?;
    Ok(PathBuf::from(appdata)
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb"))
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
}
