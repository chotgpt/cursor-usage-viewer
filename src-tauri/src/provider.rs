use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{
    header::{HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE, COOKIE, ORIGIN, USER_AGENT},
    redirect::Policy,
    Client, Method, Response,
};
use serde_json::Value;
use url::Url;
use zeroize::Zeroizing;

use crate::{
    error::{AppError, AppResult},
    model::{CoreUsageSnapshot, CursorAccountRecord, SandSnapshot, UsageAmount},
};

const OAUTH: &str = "https://api2.cursor.sh/oauth/token";
const META: &str = "https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta";
const FULL_PROFILE: &str = "https://api2.cursor.sh/auth/full_stripe_profile";
const PROFILE: &str = "https://api2.cursor.sh/auth/stripe_profile";
const USAGE: &str = "https://cursor.com/api/usage-summary";
const SAND_USAGE: &str = "https://cursor.com/api/dashboard/get-sand-usage-status";
const SAND_ACCESS: &str = "https://cursor.com/api/dashboard/get-sand-access-status";
const CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const MAX_RESPONSE_BYTES: usize = 512 * 1024;

#[derive(Clone)]
struct Endpoints {
    oauth: Url,
    meta: Url,
    full_profile: Url,
    profile: Url,
    usage: Url,
    sand_usage: Url,
    sand_access: Url,
}

pub struct CursorUsageProvider {
    client: Client,
    endpoints: Endpoints,
    enforce_allowlist: bool,
}

impl CursorUsageProvider {
    pub fn new() -> AppResult<Self> {
        let client = Client::builder()
            .https_only(true)
            .redirect(Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(25))
            .user_agent("CursorUsageViewer/0.1.0")
            .build()
            .map_err(|error| AppError::ProviderInit(error.to_string()))?;
        Ok(Self {
            client,
            endpoints: Endpoints::production()?,
            enforce_allowlist: true,
        })
    }

    pub async fn refresh_account(
        &self,
        mut account: CursorAccountRecord,
    ) -> AppResult<CursorAccountRecord> {
        self.validate_endpoints()?;
        if token_needs_refresh(&account.access_token) {
            if let Some(refresh) = account
                .refresh_token
                .clone()
                .filter(|value| !value.is_empty())
            {
                if let Ok(value) = self.post_oauth(&refresh).await {
                    if !value
                        .get("shouldLogout")
                        .and_then(Value::as_bool)
                        .unwrap_or(false)
                    {
                        if let Some(token) = value
                            .get("access_token")
                            .or_else(|| value.get("accessToken"))
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty())
                        {
                            account.access_token = token.to_owned();
                        }
                        if let Some(token) = value
                            .get("refresh_token")
                            .or_else(|| value.get("refreshToken"))
                            .and_then(Value::as_str)
                            .filter(|value| !value.is_empty())
                        {
                            account.refresh_token = Some(token.to_owned());
                        }
                    }
                }
            }
        }
        if let Ok(meta) = self
            .post_bearer_json(
                &self.endpoints.meta,
                &account.access_token,
                Value::Object(Default::default()),
            )
            .await
        {
            replace_string(&mut account.email, meta.get("email"));
            replace_string(&mut account.sign_up_type, meta.get("signUpType"));
            if account.auth_id.is_none() {
                replace_string(&mut account.auth_id, meta.get("workosId"));
            }
        }
        if let Ok(Some(profile)) = self.fetch_profile(&account.access_token).await {
            let membership = profile
                .get("individualMembershipType")
                .and_then(Value::as_str)
                .filter(|value| !value.eq_ignore_ascii_case("free"))
                .or_else(|| profile.get("membershipType").and_then(Value::as_str))
                .or_else(|| {
                    profile
                        .get("individualMembershipType")
                        .and_then(Value::as_str)
                });
            if let Some(value) = membership {
                account.membership_type = Some(value.to_owned());
            }
            replace_string(
                &mut account.subscription_status,
                profile.get("subscriptionStatus"),
            );
        }
        let now = now_seconds();
        match self.get_usage(&account.access_token).await {
            Ok(raw) => {
                if let Some(value) = raw
                    .get("membershipType")
                    .and_then(Value::as_str)
                    .filter(|value| !value.is_empty())
                {
                    account.membership_type = Some(value.to_owned());
                }
                account.core_usage = Some(map_core_usage(&raw, now));
                account.cursor_usage_raw = Some(raw);
                account.last_error = None;
                account.last_error_at = None;
            }
            Err(error) => {
                let message = error.to_string();
                if let Some(snapshot) = account.core_usage.as_mut() {
                    snapshot.error = Some(message.clone());
                }
                account.last_error = Some(message);
                account.last_error_at = Some(now);
            }
        }
        let cookie = build_session_cookie(&account.access_token)?;
        let mut sand = account.sand.take().unwrap_or_default();
        match self
            .post_cookie_json(&self.endpoints.sand_usage, &cookie)
            .await
        {
            Ok(raw) => {
                map_sand_usage(&mut sand, &raw);
                sand.usage_updated_at = Some(now);
                sand.usage_error = None;
            }
            Err(error) => sand.usage_error = Some(error.to_string()),
        }
        match self
            .post_cookie_json(&self.endpoints.sand_access, &cookie)
            .await
        {
            Ok(raw) => {
                map_sand_access(&mut sand, &raw);
                sand.access_updated_at = Some(now);
                sand.access_error = None;
            }
            Err(error) => sand.access_error = Some(error.to_string()),
        }
        account.sand = Some(sand);
        account.last_used = now;
        Ok(account)
    }

    fn validate_endpoints(&self) -> AppResult<()> {
        if !self.enforce_allowlist {
            return Ok(());
        }
        for (method, url) in [
            (Method::POST, &self.endpoints.oauth),
            (Method::POST, &self.endpoints.meta),
            (Method::GET, &self.endpoints.full_profile),
            (Method::GET, &self.endpoints.profile),
            (Method::GET, &self.endpoints.usage),
            (Method::POST, &self.endpoints.sand_usage),
            (Method::POST, &self.endpoints.sand_access),
        ] {
            validate_production_endpoint(&method, url)?;
        }
        Ok(())
    }
    async fn post_oauth(&self, refresh: &str) -> AppResult<Value> {
        let response = self.client.post(self.endpoints.oauth.clone()).header(CONTENT_TYPE,"application/json").json(&serde_json::json!({"grant_type":"refresh_token","client_id":CLIENT_ID,"refresh_token":refresh})).send().await.map_err(request_error)?;
        parse_json_response(response).await
    }
    async fn post_bearer_json(&self, url: &Url, token: &str, body: Value) -> AppResult<Value> {
        let auth = sensitive_header(&format!("Bearer {token}"))?;
        let response = self
            .client
            .post(url.clone())
            .header(AUTHORIZATION, auth)
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await
            .map_err(request_error)?;
        parse_json_response(response).await
    }
    async fn fetch_profile(&self, token: &str) -> AppResult<Option<Value>> {
        let response = self.get_bearer(&self.endpoints.full_profile, token).await?;
        if response.status().as_u16() == 200 {
            return parse_json_response(response).await.map(Some);
        }
        let fallback = self.get_bearer(&self.endpoints.profile, token).await?;
        if fallback.status().as_u16() != 200 {
            return Ok(None);
        }
        let value = parse_json_response(fallback).await?;
        Ok(match value {
            Value::Object(_) => Some(value),
            Value::String(ref text) if !text.trim().is_empty() => {
                Some(serde_json::json!({"membershipType":"pro"}))
            }
            _ => None,
        })
    }
    async fn get_bearer(&self, url: &Url, token: &str) -> AppResult<Response> {
        self.client
            .get(url.clone())
            .header(AUTHORIZATION, sensitive_header(&format!("Bearer {token}"))?)
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(request_error)
    }
    async fn get_usage(&self, token: &str) -> AppResult<Value> {
        let cookie = build_session_cookie(token)?;
        let response = self
            .client
            .get(self.endpoints.usage.clone())
            .header(ACCEPT, "application/json")
            .header(COOKIE, sensitive_header(&cookie)?)
            .header(USER_AGENT, "Mozilla/5.0 CursorUsageViewer/0.1")
            .send()
            .await
            .map_err(request_error)?;
        parse_json_response(response).await
    }
    async fn post_cookie_json(&self, url: &Url, cookie: &str) -> AppResult<Value> {
        let response = self
            .client
            .post(url.clone())
            .header(COOKIE, sensitive_header(cookie)?)
            .header(ORIGIN, "https://cursor.com")
            .send()
            .await
            .map_err(request_error)?;
        parse_json_response(response).await
    }
}

impl Endpoints {
    fn production() -> AppResult<Self> {
        Ok(Self {
            oauth: parse(OAUTH)?,
            meta: parse(META)?,
            full_profile: parse(FULL_PROFILE)?,
            profile: parse(PROFILE)?,
            usage: parse(USAGE)?,
            sand_usage: parse(SAND_USAGE)?,
            sand_access: parse(SAND_ACCESS)?,
        })
    }
    #[cfg(test)]
    fn mock(base: &str) -> Self {
        let url = |path: &str| Url::parse(&format!("{base}{path}")).unwrap();
        Self {
            oauth: url("/oauth/token"),
            meta: url("/meta"),
            full_profile: url("/full-profile"),
            profile: url("/profile"),
            usage: url("/usage-summary"),
            sand_usage: url("/sand-usage"),
            sand_access: url("/sand-access"),
        }
    }
}
fn parse(value: &str) -> AppResult<Url> {
    Url::parse(value).map_err(|_| AppError::EndpointRejected)
}
fn sensitive_header(value: &str) -> AppResult<HeaderValue> {
    let mut header = HeaderValue::from_str(value).map_err(|_| AppError::InvalidCredentialHeader)?;
    header.set_sensitive(true);
    Ok(header)
}
fn request_error(error: reqwest::Error) -> AppError {
    AppError::Request(error.without_url().to_string())
}

async fn parse_json_response(response: Response) -> AppResult<Value> {
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .split(';')
        .next()
        .unwrap_or("unknown")
        .to_ascii_lowercase();
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err(AppError::ResponseTooLarge);
    }
    let body = response.bytes().await.map_err(request_error)?;
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(AppError::ResponseTooLarge);
    }
    if status != 200 {
        return Err(AppError::UnexpectedStatus(status));
    }
    serde_json::from_slice(&body).map_err(|_| AppError::InvalidJsonEvidence {
        status,
        content_type,
        body_len: body.len(),
        body_kind: classify_body(&body),
    })
}
fn classify_body(body: &[u8]) -> &'static str {
    let trimmed = body
        .iter()
        .copied()
        .skip_while(u8::is_ascii_whitespace)
        .collect::<Vec<_>>();
    if trimmed.is_empty() {
        "empty"
    } else if trimmed[0] == b'<' {
        "html"
    } else if matches!(trimmed[0], b'{' | b'[') {
        "json_like"
    } else {
        "other"
    }
}

pub fn validate_production_endpoint(method: &Method, url: &Url) -> AppResult<()> {
    let allowed = matches!(
        (method.as_str(), url.host_str(), url.path()),
        (
            "POST",
            Some("api2.cursor.sh"),
            "/oauth/token" | "/aiserver.v1.AuthService/GetUserMeta"
        ) | (
            "GET",
            Some("api2.cursor.sh"),
            "/auth/full_stripe_profile" | "/auth/stripe_profile"
        ) | ("GET", Some("cursor.com"), "/api/usage-summary")
            | (
                "POST",
                Some("cursor.com"),
                "/api/dashboard/get-sand-usage-status" | "/api/dashboard/get-sand-access-status"
            )
    );
    if allowed
        && url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
    {
        Ok(())
    } else {
        Err(AppError::EndpointRejected)
    }
}
fn jwt_payload(token: &str) -> Option<Value> {
    let bytes = URL_SAFE_NO_PAD.decode(token.split('.').nth(1)?).ok()?;
    serde_json::from_slice(&bytes).ok()
}
fn token_needs_refresh(token: &str) -> bool {
    match jwt_payload(token).and_then(|v| v.get("exp")?.as_i64()) {
        Some(exp) => exp <= now_seconds() + 300,
        None => true,
    }
}
fn build_session_cookie(token: &str) -> AppResult<Zeroizing<String>> {
    let payload = jwt_payload(token).ok_or(AppError::InvalidSessionToken)?;
    let sub = payload
        .get("sub")
        .and_then(Value::as_str)
        .ok_or(AppError::InvalidSessionToken)?;
    let user = sub.rsplit('|').next().unwrap_or(sub);
    if !user.starts_with("user_")
        || !user
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
    {
        return Err(AppError::InvalidSessionToken);
    };
    Ok(Zeroizing::new(format!(
        "WorkosCursorSessionToken={user}%3A%3A{token}"
    )))
}
fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
fn replace_string(target: &mut Option<String>, value: Option<&Value>) {
    if let Some(value) = value
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        *target = Some(value.to_owned())
    }
}
fn amount(value: &Value, percent: Option<&str>) -> UsageAmount {
    UsageAmount {
        enabled: value.get("enabled").and_then(Value::as_bool),
        used: value.get("used").and_then(Value::as_f64),
        limit: value.get("limit").and_then(Value::as_f64),
        remaining: value.get("remaining").and_then(Value::as_f64),
        percent_used: percent
            .and_then(|key| value.get(key))
            .and_then(Value::as_f64),
    }
}
fn map_core_usage(raw: &Value, updated_at: i64) -> CoreUsageSnapshot {
    let plan = raw
        .pointer("/individualUsage/plan")
        .or_else(|| raw.get("planUsage"))
        .unwrap_or(&Value::Null);
    let on_demand = raw
        .pointer("/individualUsage/onDemand")
        .unwrap_or(&Value::Null);
    CoreUsageSnapshot {
        total: amount(plan, Some("totalPercentUsed")),
        auto_composer: amount(plan, Some("autoPercentUsed")),
        api: amount(plan, Some("apiPercentUsed")),
        on_demand: amount(on_demand, None),
        billing_cycle_start: raw
            .get("billingCycleStart")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        billing_cycle_end: raw
            .get("billingCycleEnd")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        source: "live".to_owned(),
        updated_at,
        error: None,
    }
}
fn map_sand_usage(s: &mut SandSnapshot, v: &Value) {
    s.usage_percent = v.get("usagePercent").and_then(Value::as_f64);
    s.has_available_usage = v.get("hasAvailableUsage").and_then(Value::as_bool);
    s.has_non_zero_included_limit = v.get("hasNonZeroIncludedLimit").and_then(Value::as_bool);
    s.grok_plan_label = v
        .get("grokPlanLabel")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    s.current_period_start = v
        .get("currentPeriodStart")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    s.next_reset_timestamp_utc = v
        .get("nextResetTimestampUtc")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
}
fn map_sand_access(s: &mut SandSnapshot, v: &Value) {
    s.access_state = v
        .get("state")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    s.access_granted = s
        .access_state
        .as_deref()
        .map(|state| state == "SAND_ACCESS_STATE_GRANTED");
    s.block_reason = v
        .get("blockReason")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned);
    s.is_paid_trial_plan = v.get("isPaidTrialPlan").and_then(Value::as_bool);
    s.pro_and_super_grok_plans_grant_access = v
        .get("proAndSuperGrokPlansGrantAccess")
        .and_then(Value::as_bool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use wiremock::{
        matchers::{method, path},
        Mock, MockServer, ResponseTemplate,
    };
    fn token() -> String {
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::json!({"sub":"auth0|user_fixture","exp":4_102_444_800i64}).to_string(),
        );
        format!("e30.{payload}.signature")
    }
    fn record() -> CursorAccountRecord {
        CursorAccountRecord::fake_for_test("cursor_fixture", "free@example.invalid", &token())
    }
    async fn mount(server: &MockServer, path_value: &str, method_value: &str, body: Value) {
        Mock::given(method(method_value))
            .and(path(path_value))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }
    #[test]
    fn allowlist_contains_only_the_fixed_d012_chain() {
        for (m, u) in [
            (Method::POST, OAUTH),
            (Method::POST, META),
            (Method::GET, FULL_PROFILE),
            (Method::GET, PROFILE),
            (Method::GET, USAGE),
            (Method::POST, SAND_USAGE),
            (Method::POST, SAND_ACCESS),
        ] {
            assert!(validate_production_endpoint(&m, &Url::parse(u).unwrap()).is_ok())
        }
        assert!(validate_production_endpoint(
            &Method::POST,
            &Url::parse(
                "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage"
            )
            .unwrap()
        )
        .is_err());
    }
    #[tokio::test]
    async fn free_account_uses_usage_summary_and_keeps_optional_sand_independent() {
        let server = MockServer::start().await;
        mount(&server, "/meta", "POST", serde_json::json!({})).await;
        mount(
            &server,
            "/full-profile",
            "GET",
            serde_json::json!({"membershipType":"free"}),
        )
        .await;
        mount(&server,"/usage-summary","GET",serde_json::json!({"individualUsage":{"plan":{"autoPercentUsed":4.5,"totalPercentUsed":4.5}}})).await;
        Mock::given(method("POST"))
            .and(path("/sand-usage"))
            .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
            .mount(&server)
            .await;
        mount(
            &server,
            "/sand-access",
            "POST",
            serde_json::json!({"state":"SAND_ACCESS_STATE_BLOCKED"}),
        )
        .await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };
        let updated = provider.refresh_account(record()).await.unwrap();
        assert_eq!(
            updated.core_usage.unwrap().auto_composer.percent_used,
            Some(4.5)
        );
        let sand = updated.sand.unwrap();
        assert!(sand.usage_error.unwrap().contains("body_kind=other"));
        assert_eq!(sand.access_granted, Some(false));
    }
    #[tokio::test]
    async fn http_200_non_json_error_contains_evidence_but_not_body() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/bad"))
            .respond_with(
                ResponseTemplate::new(200).set_body_raw("<html>private marker</html>", "text/html"),
            )
            .mount(&server)
            .await;
        let response = Client::new()
            .get(format!("{}/bad", server.uri()))
            .send()
            .await
            .unwrap();
        let error = parse_json_response(response).await.unwrap_err().to_string();
        assert!(error.contains("HTTP 200"));
        assert!(error.contains("text/html"));
        assert!(error.contains("body_kind=html"));
        assert!(!error.contains("private marker"));
    }
}
