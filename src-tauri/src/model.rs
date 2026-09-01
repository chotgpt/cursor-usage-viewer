use serde::{Deserialize, Serialize};
use serde_json::Value;
use zeroize::{Zeroize, ZeroizeOnDrop};

pub const ACCOUNT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageAmount {
    pub enabled: Option<bool>,
    pub used: Option<f64>,
    pub limit: Option<f64>,
    pub remaining: Option<f64>,
    pub percent_used: Option<f64>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CoreUsageSnapshot {
    pub total: UsageAmount,
    pub auto_composer: UsageAmount,
    pub api: UsageAmount,
    pub on_demand: UsageAmount,
    #[serde(default)]
    pub on_demand_limit_type: Option<String>,
    #[serde(default)]
    pub is_unlimited: bool,
    pub billing_cycle_start: Option<String>,
    pub billing_cycle_end: Option<String>,
    pub source: String,
    pub updated_at: i64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SandSnapshot {
    pub usage_percent: Option<f64>,
    pub has_available_usage: Option<bool>,
    pub has_non_zero_included_limit: Option<bool>,
    pub grok_plan_label: Option<String>,
    pub current_period_start: Option<String>,
    pub next_reset_timestamp_utc: Option<String>,
    pub access_granted: Option<bool>,
    pub access_state: Option<String>,
    pub block_reason: Option<String>,
    pub is_paid_trial_plan: Option<bool>,
    pub pro_and_super_grok_plans_grant_access: Option<bool>,
    pub usage_updated_at: Option<i64>,
    pub access_updated_at: Option<i64>,
    pub usage_error: Option<String>,
    pub access_error: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorAccountRecord {
    pub schema_version: u32,
    pub id: String,
    pub email: Option<String>,
    pub auth_id: Option<String>,
    pub name: Option<String>,
    pub tags: Vec<String>,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub membership_type: Option<String>,
    pub subscription_status: Option<String>,
    pub sign_up_type: Option<String>,
    pub cursor_auth_raw: Option<Value>,
    pub cursor_usage_raw: Option<Value>,
    pub status: Option<String>,
    pub status_reason: Option<String>,
    pub source: String,
    pub core_usage: Option<CoreUsageSnapshot>,
    pub sand: Option<SandSnapshot>,
    #[serde(default)]
    pub auxiliary_errors: Vec<String>,
    pub last_error: Option<String>,
    pub last_error_at: Option<i64>,
    pub created_at: i64,
    pub last_used: i64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CursorAccountSummary {
    pub schema_version: u32,
    pub id: String,
    pub email: Option<String>,
    pub auth_id: Option<String>,
    pub tags: Vec<String>,
    pub membership_type: Option<String>,
    pub subscription_status: Option<String>,
    pub source: String,
    pub created_at: i64,
    pub last_used: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CursorAccountView {
    pub id: String,
    pub email: Option<String>,
    pub auth_id: Option<String>,
    pub name: Option<String>,
    pub tags: Vec<String>,
    pub membership_type: Option<String>,
    pub subscription_status: Option<String>,
    pub sign_up_type: Option<String>,
    pub status: Option<String>,
    pub status_reason: Option<String>,
    pub is_enterprise: bool,
    pub source: String,
    pub has_access_token: bool,
    pub has_refresh_token: bool,
    pub is_current: bool,
    pub core_usage: Option<CoreUsageSnapshot>,
    pub sand: Option<SandSnapshot>,
    pub auxiliary_errors: Vec<String>,
    pub last_error: Option<String>,
    pub last_error_at: Option<i64>,
    pub created_at: i64,
    pub last_used: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchAccountResult<T> {
    pub account_id: String,
    pub result: Option<T>,
    pub error: Option<String>,
}

impl CursorAccountRecord {
    pub fn summary(&self) -> CursorAccountSummary {
        CursorAccountSummary {
            schema_version: self.schema_version,
            id: self.id.clone(),
            email: self.email.clone(),
            auth_id: self.auth_id.clone(),
            tags: self.tags.clone(),
            membership_type: self.membership_type.clone(),
            subscription_status: self.subscription_status.clone(),
            source: self.source.clone(),
            created_at: self.created_at,
            last_used: self.last_used,
        }
    }

    pub fn view(&self, current_id: Option<&str>) -> CursorAccountView {
        CursorAccountView {
            id: self.id.clone(),
            email: self.email.clone(),
            auth_id: self.auth_id.clone(),
            name: self.name.clone(),
            tags: self.tags.clone(),
            membership_type: self.membership_type.clone(),
            subscription_status: self.subscription_status.clone(),
            sign_up_type: self.sign_up_type.clone(),
            status: self.status.clone(),
            status_reason: self.status_reason.clone(),
            is_enterprise: is_enterprise_account(self),
            source: self.source.clone(),
            has_access_token: !self.access_token.is_empty(),
            has_refresh_token: self
                .refresh_token
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
            is_current: current_id == Some(self.id.as_str()),
            core_usage: self.core_usage.clone(),
            sand: self.sand.clone(),
            auxiliary_errors: self.auxiliary_errors.clone(),
            last_error: self.last_error.clone(),
            last_error_at: self.last_error_at,
            created_at: self.created_at,
            last_used: self.last_used,
        }
    }

    #[cfg(test)]
    pub fn fake_for_test(id: &str, email: &str, access_token: &str) -> Self {
        Self {
            schema_version: ACCOUNT_SCHEMA_VERSION,
            id: id.to_owned(),
            email: Some(email.to_owned()),
            auth_id: None,
            name: None,
            tags: Vec::new(),
            access_token: access_token.to_owned(),
            refresh_token: None,
            membership_type: None,
            subscription_status: None,
            sign_up_type: None,
            cursor_auth_raw: None,
            cursor_usage_raw: None,
            status: None,
            status_reason: None,
            source: "test".to_owned(),
            core_usage: None,
            sand: None,
            auxiliary_errors: Vec::new(),
            last_error: None,
            last_error_at: None,
            created_at: 1,
            last_used: 1,
        }
    }
}

fn is_enterprise_account(account: &CursorAccountRecord) -> bool {
    let Some(raw) = account.cursor_auth_raw.as_ref().and_then(Value::as_object) else {
        return false;
    };
    for key in ["isEnterprise", "is_enterprise"] {
        if let Some(value) = raw.get(key).and_then(parse_bool_like) {
            return value;
        }
    }
    for key in ["teamMembershipType", "team_membership_type"] {
        if let Some(value) = raw.get(key).and_then(Value::as_str) {
            let normalized = value.to_ascii_lowercase();
            if normalized.contains("enterprise") {
                return true;
            }
            if normalized.contains("self_serve") || normalized.contains("selfserve") {
                return false;
            }
        }
    }
    for key in ["isTeamMember", "is_team_member"] {
        if let Some(value) = raw.get(key).and_then(parse_bool_like) {
            return !value;
        }
    }
    false
}

fn parse_bool_like(value: &Value) -> Option<bool> {
    value.as_bool().or_else(|| {
        value
            .as_str()
            .and_then(|value| match value.trim().to_ascii_lowercase().as_str() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            })
    })
}

#[cfg(test)]
mod view_tests {
    use super::*;

    #[test]
    fn enterprise_membership_keeps_cockpit_team_distinction() {
        let mut account =
            CursorAccountRecord::fake_for_test("account", "user@example.invalid", "token");
        account.membership_type = Some("enterprise".to_owned());
        account.cursor_auth_raw = Some(serde_json::json!({ "teamMembershipType": "self_serve" }));
        assert!(!account.view(None).is_enterprise);

        account.cursor_auth_raw = Some(serde_json::json!({ "teamMembershipType": "enterprise" }));
        assert!(account.view(None).is_enterprise);

        account.cursor_auth_raw = Some(
            serde_json::json!({ "isEnterprise": "false", "teamMembershipType": "enterprise" }),
        );
        assert!(!account.view(None).is_enterprise);
    }
}

#[derive(Debug, Zeroize, ZeroizeOnDrop)]
pub struct RawCursorAccount {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub email: Option<String>,
    pub membership: Option<String>,
    pub signup_type: Option<String>,
}

impl RawCursorAccount {
    pub fn into_record(mut self) -> Option<CursorAccountRecord> {
        use std::time::{SystemTime, UNIX_EPOCH};

        let access_token = self.access_token.take().filter(|value| !value.is_empty())?;
        let refresh_token = self.refresh_token.take().filter(|value| !value.is_empty());
        let email = self.email.take().filter(|value| !value.is_empty());
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        let cursor_auth_raw = Some(serde_json::json!({
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "cachedEmail": email,
            "stripeMembershipType": self.membership,
            "cachedSignUpType": self.signup_type,
        }));
        Some(CursorAccountRecord {
            schema_version: ACCOUNT_SCHEMA_VERSION,
            id: "local-cursor".to_owned(),
            email,
            auth_id: None,
            name: None,
            tags: Vec::new(),
            access_token,
            refresh_token,
            membership_type: self.membership.take().filter(|value| !value.is_empty()),
            subscription_status: None,
            sign_up_type: self.signup_type.take().filter(|value| !value.is_empty()),
            cursor_auth_raw,
            cursor_usage_raw: None,
            status: None,
            status_reason: None,
            source: "cursor".to_owned(),
            core_usage: None,
            sand: None,
            auxiliary_errors: Vec::new(),
            last_error: None,
            last_error_at: None,
            created_at: now,
            last_used: now,
        })
    }
}
