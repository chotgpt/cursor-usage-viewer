use serde::Serialize;
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountSummary {
    pub id: String,
    pub email: String,
    pub membership: Option<String>,
    pub signup_type: Option<String>,
    pub tags: Vec<String>,
    pub source: String,
    pub is_active: bool,
    pub has_access_token: bool,
    pub has_refresh_token: bool,
}

#[derive(Debug, Zeroize, ZeroizeOnDrop)]
pub struct ManagedAccount {
    pub id: String,
    pub email: String,
    pub membership: Option<String>,
    pub signup_type: Option<String>,
    pub tags: Vec<String>,
    pub source: String,
    pub access_token: String,
    pub has_refresh_token: bool,
}

#[derive(Debug, Zeroize, ZeroizeOnDrop)]
pub struct RawCursorAccount {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub email: Option<String>,
    pub membership: Option<String>,
    pub signup_type: Option<String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct QuotaSnapshot {
    pub auto_percent_used: Option<f64>,
    pub api_percent_used: Option<f64>,
    pub total_percent_used: Option<f64>,
    pub billing_cycle_start: String,
    pub billing_cycle_end: String,
    pub usage_percent: Option<f64>,
    pub has_available_usage: Option<bool>,
    pub has_non_zero_included_limit: Option<bool>,
    pub grok_plan_label: Option<String>,
    pub current_period_start: Option<String>,
    pub next_reset_timestamp_utc: Option<String>,
    pub sand_access_granted: Option<bool>,
    pub sand_access_state: Option<String>,
    pub sand_block_reason: Option<String>,
    pub is_paid_trial_plan: Option<bool>,
    pub pro_and_super_grok_plans_grant_access: Option<bool>,
}

impl RawCursorAccount {
    pub fn into_managed(mut self) -> Option<ManagedAccount> {
        let access_token = self.access_token.take().filter(|value| !value.is_empty())?;
        Some(ManagedAccount {
            id: "local-cursor".to_owned(),
            email: self
                .email
                .take()
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "（邮箱未缓存）".to_owned()),
            membership: self.membership.take().filter(|value| !value.is_empty()),
            signup_type: self.signup_type.take().filter(|value| !value.is_empty()),
            tags: Vec::new(),
            source: "cursor".to_owned(),
            access_token,
            has_refresh_token: self
                .refresh_token
                .as_deref()
                .is_some_and(|value| !value.is_empty()),
        })
    }
}

impl ManagedAccount {
    pub fn to_summary(&self, is_active: bool) -> AccountSummary {
        AccountSummary {
            id: self.id.clone(),
            email: self.email.clone(),
            membership: self.membership.clone(),
            signup_type: self.signup_type.clone(),
            tags: self.tags.clone(),
            source: self.source.clone(),
            is_active,
            has_access_token: !self.access_token.is_empty(),
            has_refresh_token: self.has_refresh_token,
        }
    }
}
