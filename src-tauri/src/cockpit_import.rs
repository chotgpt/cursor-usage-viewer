use std::collections::HashSet;

use serde::Deserialize;
use zeroize::{Zeroize, ZeroizeOnDrop};

use crate::{
    error::{AppError, AppResult},
    model::ManagedAccount,
};

const MAX_IMPORT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ACCOUNTS: usize = 500;

#[derive(Debug, Deserialize, Zeroize, ZeroizeOnDrop)]
struct CockpitAccountImport {
    id: String,
    email: String,
    #[serde(default)]
    tags: Vec<String>,
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    membership_type: Option<String>,
    #[serde(default)]
    sign_up_type: Option<String>,
}

pub fn parse_cockpit_accounts_json(payload: &str) -> AppResult<Vec<ManagedAccount>> {
    if payload.len() > MAX_IMPORT_BYTES {
        return Err(AppError::ImportJsonTooLarge);
    }

    let imports: Vec<CockpitAccountImport> =
        serde_json::from_str(payload).map_err(|_| AppError::ImportJsonInvalid)?;
    if imports.len() > MAX_ACCOUNTS {
        return Err(AppError::ImportAccountLimit);
    }

    let mut ids = HashSet::with_capacity(imports.len());
    let mut accounts = Vec::with_capacity(imports.len());
    for (offset, mut imported) in imports.into_iter().enumerate() {
        let index = offset + 1;
        validate_account(index, &imported)?;
        if !ids.insert(imported.id.clone()) {
            return Err(AppError::ImportAccountInvalid {
                index,
                reason: "账号 ID 重复",
            });
        }

        let has_refresh_token = imported
            .refresh_token
            .as_deref()
            .is_some_and(|value| !value.is_empty());
        accounts.push(ManagedAccount {
            id: std::mem::take(&mut imported.id),
            email: std::mem::take(&mut imported.email),
            membership: imported.membership_type.take(),
            signup_type: imported.sign_up_type.take(),
            tags: std::mem::take(&mut imported.tags),
            source: "cockpit-tools".to_owned(),
            access_token: std::mem::take(&mut imported.access_token),
            has_refresh_token,
        });
    }
    Ok(accounts)
}

fn validate_account(index: usize, account: &CockpitAccountImport) -> AppResult<()> {
    if !valid_text(&account.id, 256) {
        return invalid(index, "账号 ID 缺失或过长");
    }
    if !valid_text(&account.email, 320) {
        return invalid(index, "邮箱缺失或过长");
    }
    if !valid_jwt(&account.access_token) {
        return invalid(index, "Access Token 不是受支持的 JWT 形态");
    }
    if account.tags.len() > 32 || account.tags.iter().any(|tag| !valid_text(tag, 128)) {
        return invalid(index, "标签数量或长度超限");
    }
    for value in [
        account.membership_type.as_deref(),
        account.sign_up_type.as_deref(),
    ]
    .into_iter()
    .flatten()
    {
        if !valid_text(value, 64) {
            return invalid(index, "套餐或注册方式字段无效");
        }
    }
    Ok(())
}

fn valid_text(value: &str, max_len: usize) -> bool {
    !value.is_empty() && value.len() <= max_len && !value.chars().any(char::is_control)
}

fn valid_jwt(value: &str) -> bool {
    if value.is_empty() || value.len() > 32 * 1024 {
        return false;
    }
    let mut segments = value.split('.');
    segments.next().is_some_and(|part| !part.is_empty())
        && segments.next().is_some_and(|part| !part.is_empty())
        && segments.next().is_some_and(|part| !part.is_empty())
        && segments.next().is_none()
}

fn invalid<T>(index: usize, reason: &'static str) -> AppResult<T> {
    Err(AppError::ImportAccountInvalid { index, reason })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn imports_only_the_required_cockpit_fields() {
        let fake_access = "header.payload.signature";
        let fake_refresh = "refresh.payload.signature";
        let fixture = serde_json::json!([{
            "id": "cursor_example",
            "email": "person@example.com",
            "tags": ["测试标签"],
            "access_token": fake_access,
            "refresh_token": fake_refresh,
            "membership_type": "pro",
            "sign_up_type": "Auth_0",
            "cursor_auth_raw": { "accessToken": "ignored.secret.value" },
            "cursor_usage_raw": { "plan": { "apiPercentUsed": 99 } }
        }]);

        let accounts = parse_cockpit_accounts_json(&fixture.to_string()).unwrap();
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, "cursor_example");
        assert_eq!(accounts[0].email, "person@example.com");
        assert_eq!(accounts[0].tags, ["测试标签"]);
        assert_eq!(accounts[0].access_token, fake_access);
        assert!(accounts[0].has_refresh_token);

        let summary = accounts[0].to_summary(true);
        let serialized = serde_json::to_string(&summary).unwrap();
        assert!(!serialized.contains(fake_access));
        assert!(!serialized.contains(fake_refresh));
        assert!(!serialized.contains("ignored.secret.value"));
        assert!(!serialized.contains("apiPercentUsed"));
    }

    #[test]
    fn rejects_malformed_or_duplicate_accounts_without_echoing_secrets() {
        let duplicate = serde_json::json!([
            {"id":"same","email":"one@example.com","access_token":"a.b.c"},
            {"id":"same","email":"two@example.com","access_token":"d.e.f"}
        ]);
        assert!(matches!(
            parse_cockpit_accounts_json(&duplicate.to_string()),
            Err(AppError::ImportAccountInvalid { index: 2, .. })
        ));

        let malformed = serde_json::json!([
            {"id":"one","email":"one@example.com","access_token":"not-a-jwt"}
        ]);
        let error = parse_cockpit_accounts_json(&malformed.to_string())
            .unwrap_err()
            .to_string();
        assert!(!error.contains("not-a-jwt"));
    }

    #[test]
    fn imports_multiple_accounts_from_one_json_array() {
        let fixture = serde_json::json!([
            {
                "id": "cursor_one",
                "email": "one@example.com",
                "access_token": "one.payload.signature"
            },
            {
                "id": "cursor_two",
                "email": "two@example.com",
                "access_token": "two.payload.signature",
                "tags": ["第二个账号"]
            }
        ]);

        let accounts = parse_cockpit_accounts_json(&fixture.to_string()).unwrap();
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].id, "cursor_one");
        assert_eq!(accounts[1].id, "cursor_two");
    }

    #[test]
    fn rejects_payloads_over_eight_mib() {
        let payload = " ".repeat(MAX_IMPORT_BYTES + 1);
        assert!(matches!(
            parse_cockpit_accounts_json(&payload),
            Err(AppError::ImportJsonTooLarge)
        ));
    }
}
