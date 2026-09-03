use std::{
    collections::HashSet,
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use zeroize::Zeroizing;

use crate::{
    error::{AppError, AppResult},
    model::{CursorAccountRecord, ACCOUNT_SCHEMA_VERSION},
    provider::map_core_usage,
};

const MAX_IMPORT_BYTES: usize = 8 * 1024 * 1024;
const MAX_ACCOUNTS: usize = 500;

pub fn parse_cockpit_accounts_json(payload: &str) -> AppResult<Vec<CursorAccountRecord>> {
    if payload.len() > MAX_IMPORT_BYTES {
        return Err(AppError::ImportJsonTooLarge);
    }
    let value: Value = serde_json::from_str(payload).map_err(|_| AppError::ImportJsonInvalid)?;
    let values = unwrap_accounts(value)?;
    if values.len() > MAX_ACCOUNTS {
        return Err(AppError::ImportAccountLimit);
    }
    let mut records = Vec::with_capacity(values.len());
    let mut ids = HashSet::with_capacity(values.len());
    for (offset, value) in values.into_iter().enumerate() {
        let record = parse_account(value, offset + 1)?;
        if !ids.insert(record.id.clone()) {
            return invalid(offset + 1, "账号 ID 重复");
        }
        records.push(record);
    }
    Ok(records)
}

fn unwrap_accounts(value: Value) -> AppResult<Vec<Value>> {
    match value {
        Value::Array(values) if !values.is_empty() => Ok(values),
        Value::Array(_) => Err(AppError::ImportJsonInvalid),
        Value::Object(mut object) => {
            if object.contains_key("access_token") || object.contains_key("accessToken") {
                return Ok(vec![Value::Object(object)]);
            }
            object
                .remove("accounts")
                .or_else(|| object.remove("items"))
                .and_then(|value| value.as_array().cloned())
                .filter(|values| !values.is_empty())
                .ok_or(AppError::ImportJsonInvalid)
        }
        _ => Err(AppError::ImportJsonInvalid),
    }
}

fn parse_account(value: Value, index: usize) -> AppResult<CursorAccountRecord> {
    let object = value.as_object().ok_or(AppError::ImportAccountInvalid {
        index,
        reason: "账号必须是对象",
    })?;
    let auth_raw = object_value(object, &["cursor_auth_raw", "cursorAuthRaw"]);
    let usage_raw = object_value(object, &["cursor_usage_raw", "cursorUsageRaw"]);
    let access_token = string_value(
        object,
        &[
            "access_token",
            "accessToken",
            "token",
            "cursor_access_token",
        ],
    )
    .or_else(|| auth_string(auth_raw.as_ref(), &["accessToken"]))
    .ok_or(AppError::ImportAccountInvalid {
        index,
        reason: "缺少 Access Token",
    })?;
    if !valid_jwt(&access_token) {
        return invalid(index, "Access Token 不是受支持的 JWT 形态");
    }
    let email = string_value(object, &["email", "cachedEmail", "cursor_email"])
        .or_else(|| auth_string(auth_raw.as_ref(), &["cachedEmail"]));
    if email
        .as_deref()
        .is_some_and(|value| !valid_text(value, 320))
    {
        return invalid(index, "邮箱字段过长或无效");
    }
    let auth_id = string_value(object, &["auth_id", "authId", "workos_id", "workosId"])
        .or_else(|| auth_string(auth_raw.as_ref(), &["authId", "workosId"]))
        .or_else(|| jwt_claim(&access_token, "sub"));
    let seed = auth_id
        .as_deref()
        .or(email.as_deref())
        .unwrap_or(access_token.as_str());
    let id = string_value(object, &["id"])
        .filter(|value| valid_account_id(value))
        .unwrap_or_else(|| format!("cursor_{:016x}", fnv1a64(seed.as_bytes())));
    let tags = object
        .get("tags")
        .and_then(Value::as_array)
        .map(|values| {
            values
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if tags.len() > 32 || tags.iter().any(|tag| !valid_text(tag, 128)) {
        return invalid(index, "标签数量或长度超限");
    }
    let now = now_seconds();
    let usage_updated_at =
        integer_value(object, &["usage_updated_at", "usageUpdatedAt"]).unwrap_or(now);
    Ok(CursorAccountRecord {
        schema_version: ACCOUNT_SCHEMA_VERSION,
        id,
        email,
        auth_id,
        name: string_value(object, &["name", "displayName"]),
        tags,
        access_token,
        refresh_token: string_value(
            object,
            &["refresh_token", "refreshToken", "cursor_refresh_token"],
        )
        .or_else(|| auth_string(auth_raw.as_ref(), &["refreshToken"])),
        membership_type: string_value(
            object,
            &[
                "membership_type",
                "membershipType",
                "stripeMembershipType",
                "plan",
            ],
        )
        .or_else(|| auth_string(auth_raw.as_ref(), &["stripeMembershipType"])),
        subscription_status: string_value(
            object,
            &[
                "subscription_status",
                "subscriptionStatus",
                "stripeSubscriptionStatus",
            ],
        )
        .or_else(|| auth_string(auth_raw.as_ref(), &["stripeSubscriptionStatus"])),
        sign_up_type: string_value(object, &["sign_up_type", "signUpType", "cachedSignUpType"])
            .or_else(|| auth_string(auth_raw.as_ref(), &["cachedSignUpType"])),
        cursor_auth_raw: auth_raw,
        cursor_usage_raw: usage_raw.clone(),
        status: string_value(object, &["status"]),
        status_reason: string_value(object, &["status_reason", "statusReason"]),
        source: "cockpit-tools".to_owned(),
        core_usage: usage_raw
            .as_ref()
            .map(|value| map_core_usage(value, usage_updated_at, "imported_cache")),
        sand: None,
        auxiliary_errors: Vec::new(),
        last_error: None,
        last_error_at: None,
        created_at: integer_value(object, &["created_at", "createdAt"]).unwrap_or(now),
        last_used: integer_value(object, &["last_used", "lastUsed"]).unwrap_or(now),
    })
}

fn string_value(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        object
            .get(*key)?
            .as_str()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}
fn integer_value(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<i64> {
    keys.iter().find_map(|key| object.get(*key)?.as_i64())
}
fn object_value(object: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<Value> {
    keys.iter()
        .find_map(|key| object.get(*key).filter(|value| value.is_object()).cloned())
}
fn auth_string(raw: Option<&Value>, keys: &[&str]) -> Option<String> {
    string_value(raw?.as_object()?, keys)
}
pub(crate) fn jwt_claim(token: &str, claim: &str) -> Option<String> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    let decoded = Zeroizing::new(URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?);
    serde_json::from_slice::<Value>(&decoded)
        .ok()?
        .get(claim)?
        .as_str()
        .map(ToOwned::to_owned)
}
fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}
pub(crate) fn valid_jwt(value: &str) -> bool {
    value.len() <= 32 * 1024
        && value.split('.').count() == 3
        && value.split('.').all(|part| !part.is_empty())
}
fn valid_account_id(value: &str) -> bool {
    valid_text(value, 256)
        && !value.contains("..")
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.'))
}
fn fnv1a64(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
    })
}
fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn invalid<T>(index: usize, reason: &'static str) -> AppResult<T> {
    Err(AppError::ImportAccountInvalid { index, reason })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fake_token(subject: &str) -> String {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        format!(
            "e30.{}.signature",
            URL_SAFE_NO_PAD.encode(serde_json::json!({"sub": subject}).to_string())
        )
    }
    #[test]
    fn imports_single_array_and_wrapped_accounts_with_cached_usage() {
        let account = serde_json::json!({"email":"person@example.invalid","access_token":fake_token("auth0|user_test"),"tags":["A"],"cursor_usage_raw":{"billingCycleEnd":"2026-09-20T00:00:00Z","limitType":"team","individualUsage":{"plan":{"apiPercentUsed":100.0,"autoPercentUsed":11.0,"totalPercentUsed":20.0},"onDemand":{"enabled":true,"limit":80}},"teamUsage":{"onDemand":{"used":50}},"spendLimitUsage":{"pooledLimit":200}},"usage_updated_at":123});
        for payload in [
            account.clone(),
            serde_json::json!([account.clone()]),
            serde_json::json!({"accounts":[account.clone()]}),
            serde_json::json!({"items":[account.clone()]}),
        ] {
            let records = parse_cockpit_accounts_json(&payload.to_string()).unwrap();
            assert_eq!(records[0].auth_id.as_deref(), Some("auth0|user_test"));
            let usage = records[0].core_usage.as_ref().unwrap();
            assert_eq!(usage.source, "imported_cache");
            assert_eq!(usage.api.percent_used, Some(100.0));
            assert_eq!(usage.on_demand.used, Some(50.0));
            assert_eq!(usage.on_demand.limit, Some(200.0));
            assert_eq!(usage.updated_at, 123);
        }
    }
    #[test]
    fn rejects_limits_and_never_echoes_a_bad_token() {
        let bad = "not-a-session-token";
        let error = parse_cockpit_accounts_json(
            &serde_json::json!({"email":"x@example.invalid","access_token":bad}).to_string(),
        )
        .unwrap_err()
        .to_string();
        assert!(!error.contains(bad));
        assert!(matches!(
            parse_cockpit_accounts_json(&" ".repeat(MAX_IMPORT_BYTES + 1)),
            Err(AppError::ImportJsonTooLarge)
        ));
    }
}
