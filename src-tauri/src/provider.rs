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
const SAND_USAGE: &str = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus";
const SAND_ACCESS: &str = "https://cursor.com/api/dashboard/get-sand-access-status";
const CLIENT_ID: &str = "KbZUR41cY7W6zRSdpSUJ7I7mLYBKOCmB";
const BROWSER_USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";
const COCKPIT_USAGE_USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";
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
        let mut auxiliary_errors = Vec::new();
        if token_needs_refresh(&account.access_token) {
            if let Some(refresh) = account
                .refresh_token
                .clone()
                .filter(|value| !value.is_empty())
            {
                match self.post_oauth(&refresh).await {
                    Ok(value) => match refreshed_credentials(&value, &refresh) {
                        Ok((access_token, refresh_token)) => {
                            account.access_token = access_token;
                            account.refresh_token = Some(refresh_token);
                            sync_auth_raw_credentials(&mut account);
                        }
                        Err(error) => {
                            let error = error.to_string();
                            auxiliary_errors.push(error);
                        }
                    },
                    Err(error) => {
                        let error = error.to_string();
                        auxiliary_errors.push(error);
                    }
                }
            }
        }
        match self
            .post_bearer_json(
                &self.endpoints.meta,
                &account.access_token,
                Value::Object(Default::default()),
                "账号资料（user-meta）",
            )
            .await
        {
            Ok(meta) => {
                replace_string(&mut account.email, meta.get("email"));
                replace_string(&mut account.sign_up_type, meta.get("signUpType"));
                if account.auth_id.is_none() {
                    replace_string(&mut account.auth_id, meta.get("workosId"));
                }
                sync_auth_raw_meta(&mut account, &meta);
            }
            Err(error) => auxiliary_errors.push(error.to_string()),
        }
        match self.fetch_profile(&account.access_token).await {
            Ok(Some(profile)) => {
                let membership = resolve_profile_membership(&profile);
                if let Some(value) = membership {
                    account.membership_type = Some(value.to_owned());
                }
                replace_string(
                    &mut account.subscription_status,
                    profile.get("subscriptionStatus"),
                );
                sync_auth_raw_profile(&mut account, &profile);
            }
            Ok(None) => {}
            Err(error) => auxiliary_errors.push(error.to_string()),
        }
        account.auxiliary_errors = auxiliary_errors;
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
                account.core_usage = Some(map_core_usage(&raw, now, "live"));
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
        let mut sand = account.sand.take().unwrap_or_default();
        match self
            .post_sand_usage(
                &self.endpoints.sand_usage,
                &account.access_token,
                "Sand 用量（sand-usage）",
            )
            .await
        {
            Ok(raw) => {
                map_sand_usage(&mut sand, &raw);
                sand.usage_updated_at = Some(now);
                sand.usage_error = None;
            }
            Err(error) => sand.usage_error = Some(error.to_string()),
        }
        let access_stage = "Sand 资格（sand-access）";
        match build_session_cookie(&account.access_token) {
            Ok(cookie) => {
                match self
                    .post_cookie_json(&self.endpoints.sand_access, &cookie, access_stage)
                    .await
                {
                    Ok(raw) => {
                        map_sand_access(&mut sand, &raw);
                        sand.access_updated_at = Some(now);
                        sand.access_error = None;
                    }
                    Err(error) => sand.access_error = Some(error.to_string()),
                }
            }
            Err(error) => sand.access_error = Some(error.at_endpoint(access_stage).to_string()),
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
        let stage = "令牌续期（oauth）";
        let response = self.client.post(self.endpoints.oauth.clone()).header(CONTENT_TYPE,"application/json").json(&serde_json::json!({"grant_type":"refresh_token","client_id":CLIENT_ID,"refresh_token":refresh})).send().await.map_err(|error| request_error(error).at_endpoint(stage))?;
        parse_json_response(response)
            .await
            .map_err(|error| error.at_endpoint(stage))
    }
    async fn post_bearer_json(
        &self,
        url: &Url,
        token: &str,
        body: Value,
        stage: &'static str,
    ) -> AppResult<Value> {
        let auth = sensitive_header(&format!("Bearer {token}"))
            .map_err(|error| error.at_endpoint(stage))?;
        let response = self
            .client
            .post(url.clone())
            .header(AUTHORIZATION, auth)
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|error| request_error(error).at_endpoint(stage))?;
        parse_json_response(response)
            .await
            .map_err(|error| error.at_endpoint(stage))
    }
    async fn fetch_profile(&self, token: &str) -> AppResult<Option<Value>> {
        let response = self
            .get_bearer(
                &self.endpoints.full_profile,
                token,
                "订阅资料（full-stripe-profile）",
            )
            .await?;
        let full_status = response.status().as_u16();
        if matches!(full_status, 401 | 403) {
            return Err(AppError::UnexpectedStatus(full_status)
                .at_endpoint("订阅资料（full-stripe-profile）"));
        }
        if full_status == 200 {
            return parse_json_response(response)
                .await
                .map(Some)
                .map_err(|error| error.at_endpoint("订阅资料（full-stripe-profile）"));
        }
        let fallback = self
            .get_bearer(&self.endpoints.profile, token, "订阅资料（stripe-profile）")
            .await?;
        let fallback_status = fallback.status().as_u16();
        if matches!(fallback_status, 401 | 403) {
            return Err(AppError::UnexpectedStatus(fallback_status)
                .at_endpoint("订阅资料（stripe-profile）"));
        }
        if fallback_status != 200 {
            return Ok(None);
        }
        let value = parse_json_response(fallback)
            .await
            .map_err(|error| error.at_endpoint("订阅资料（stripe-profile）"))?;
        Ok(match value {
            Value::Object(_) => Some(value),
            Value::String(ref text) if !text.trim().is_empty() => {
                Some(serde_json::json!({"membershipType":"pro"}))
            }
            _ => None,
        })
    }
    async fn get_bearer(&self, url: &Url, token: &str, stage: &'static str) -> AppResult<Response> {
        let auth = sensitive_header(&format!("Bearer {token}"))
            .map_err(|error| error.at_endpoint(stage))?;
        self.client
            .get(url.clone())
            .header(AUTHORIZATION, auth)
            .header(ACCEPT, "application/json")
            .send()
            .await
            .map_err(|error| request_error(error).at_endpoint(stage))
    }
    async fn get_usage(&self, token: &str) -> AppResult<Value> {
        let stage = "核心额度（usage-summary）";
        let cookie = build_session_cookie(token).map_err(|error| error.at_endpoint(stage))?;
        let cookie_header = sensitive_header(&cookie).map_err(|error| error.at_endpoint(stage))?;
        let response = self
            .client
            .get(self.endpoints.usage.clone())
            .header(ACCEPT, "application/json")
            .header(COOKIE, cookie_header)
            .header(USER_AGENT, COCKPIT_USAGE_USER_AGENT)
            .send()
            .await
            .map_err(|error| request_error(error).at_endpoint(stage))?;
        parse_json_response(response)
            .await
            .map_err(|error| error.at_endpoint(stage))
    }
    async fn post_sand_usage(
        &self,
        url: &Url,
        token: &str,
        stage: &'static str,
    ) -> AppResult<Value> {
        let auth = sensitive_header(&format!("Bearer {token}"))
            .map_err(|error| error.at_endpoint(stage))?;
        let response = self
            .client
            .post(url.clone())
            .header(AUTHORIZATION, auth)
            .header(CONTENT_TYPE, "application/json")
            .header("Connect-Protocol-Version", "1")
            .header(USER_AGENT, BROWSER_USER_AGENT)
            .body("{}")
            .send()
            .await
            .map_err(|error| request_error(error).at_endpoint(stage))?;
        parse_json_response(response)
            .await
            .map_err(|error| error.at_endpoint(stage))
    }
    async fn post_cookie_json(
        &self,
        url: &Url,
        cookie: &str,
        stage: &'static str,
    ) -> AppResult<Value> {
        let cookie_header = sensitive_header(cookie).map_err(|error| error.at_endpoint(stage))?;
        let response = self
            .client
            .post(url.clone())
            .header(COOKIE, cookie_header)
            .header(ORIGIN, "https://cursor.com")
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/json")
            .header(USER_AGENT, BROWSER_USER_AGENT)
            .body("{}")
            .send()
            .await
            .map_err(|error| request_error(error).at_endpoint(stage))?;
        parse_json_response(response)
            .await
            .map_err(|error| error.at_endpoint(stage))
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
            "/oauth/token"
                | "/aiserver.v1.AuthService/GetUserMeta"
                | "/aiserver.v1.DashboardService/GetSandUsageStatus"
        ) | (
            "GET",
            Some("api2.cursor.sh"),
            "/auth/full_stripe_profile" | "/auth/stripe_profile"
        ) | ("GET", Some("cursor.com"), "/api/usage-summary")
            | (
                "POST",
                Some("cursor.com"),
                "/api/dashboard/get-sand-access-status"
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
fn refreshed_credentials(value: &Value, previous_refresh: &str) -> AppResult<(String, String)> {
    if value
        .get("shouldLogout")
        .and_then(Value::as_bool)
        .unwrap_or(false)
    {
        return Err(AppError::InvalidSessionToken.at_endpoint("令牌续期（oauth）"));
    }
    let access_token = non_empty_string(value, &["access_token", "accessToken"])
        .ok_or(AppError::InvalidSessionToken.at_endpoint("令牌续期（oauth）"))?;
    let refresh_token = non_empty_string(value, &["refresh_token", "refreshToken"])
        .unwrap_or_else(|| previous_refresh.to_owned());
    Ok((access_token, refresh_token))
}
fn auth_raw_object(
    account: &mut CursorAccountRecord,
) -> Option<&mut serde_json::Map<String, Value>> {
    if !account
        .cursor_auth_raw
        .as_ref()
        .is_some_and(Value::is_object)
    {
        account.cursor_auth_raw = Some(Value::Object(Default::default()));
    }
    account
        .cursor_auth_raw
        .as_mut()
        .and_then(Value::as_object_mut)
}
fn sync_auth_raw_credentials(account: &mut CursorAccountRecord) {
    let access_token = account.access_token.clone();
    let refresh_token = account.refresh_token.clone();
    let Some(raw) = auth_raw_object(account) else {
        return;
    };
    raw.insert("accessToken".to_owned(), Value::String(access_token));
    match refresh_token {
        Some(value) => {
            raw.insert("refreshToken".to_owned(), Value::String(value));
        }
        None => {
            raw.remove("refreshToken");
        }
    }
}
fn sync_auth_raw_meta(account: &mut CursorAccountRecord, meta: &Value) {
    let fields = [
        ("cachedEmail", "email"),
        ("cachedSignUpType", "signUpType"),
        ("workosId", "workosId"),
    ];
    let Some(raw) = auth_raw_object(account) else {
        return;
    };
    for (raw_key, response_key) in fields {
        if let Some(value) = meta
            .get(response_key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            raw.insert(raw_key.to_owned(), Value::String(value.to_owned()));
        }
    }
}
fn sync_auth_raw_profile(account: &mut CursorAccountRecord, profile: &Value) {
    let membership = resolve_profile_membership(profile);
    let fields = [
        ("stripeMembershipType", membership),
        (
            "stripeSubscriptionStatus",
            profile.get("subscriptionStatus").and_then(Value::as_str),
        ),
        (
            "teamMembershipType",
            profile.get("teamMembershipType").and_then(Value::as_str),
        ),
    ];
    let Some(raw) = auth_raw_object(account) else {
        return;
    };
    for (key, value) in fields {
        if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) {
            raw.insert(key.to_owned(), Value::String(value.to_owned()));
        }
    }
    for key in ["isTeamMember", "isEnterprise"] {
        if let Some(value) = profile.get(key).and_then(Value::as_bool) {
            raw.insert(key.to_owned(), Value::Bool(value));
        }
    }
}
fn resolve_profile_membership(profile: &Value) -> Option<&str> {
    let membership = profile
        .get("membershipType")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let individual = profile
        .get("individualMembershipType")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if let Some(value) = individual.filter(|value| !value.eq_ignore_ascii_case("free")) {
        if !membership.is_some_and(|membership| membership.eq_ignore_ascii_case("enterprise")) {
            return Some(value);
        }
    }
    membership.or(individual)
}
fn non_empty_string(value: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}
fn flexible_number(value: &Value, keys: &[&str]) -> Option<f64> {
    keys.iter().find_map(|key| {
        let value = value.get(*key)?;
        value
            .as_f64()
            .or_else(|| value.as_str()?.trim().parse::<f64>().ok())
    })
}
fn flexible_bool(value: &Value, keys: &[&str]) -> Option<bool> {
    keys.iter().find_map(|key| {
        let value = value.get(*key)?;
        value.as_bool().or_else(|| match value.as_str()?.trim() {
            text if text.eq_ignore_ascii_case("true") => Some(true),
            text if text.eq_ignore_ascii_case("false") => Some(false),
            _ => None,
        })
    })
}
fn amount(value: &Value, percent_keys: &[&str]) -> UsageAmount {
    let used = flexible_number(value, &["used", "totalSpend", "total_spend"]);
    let limit = flexible_number(value, &["limit"]);
    let percent_used = flexible_number(value, percent_keys).or_else(|| {
        used.zip(limit)
            .filter(|(_, limit)| *limit > 0.0)
            .map(|(used, limit)| used / limit * 100.0)
    });
    UsageAmount {
        enabled: flexible_bool(value, &["enabled"]),
        used,
        limit,
        remaining: flexible_number(value, &["remaining"])
            .or_else(|| used.zip(limit).map(|(used, limit)| (limit - used).max(0.0))),
        percent_used,
    }
}
fn percent_amount(value: &Value, percent_keys: &[&str]) -> UsageAmount {
    UsageAmount {
        percent_used: flexible_number(value, percent_keys),
        ..UsageAmount::default()
    }
}
fn on_demand_amount(
    individual: Option<&Value>,
    team: Option<&Value>,
    spend_limit: Option<&Value>,
    team_scope: bool,
) -> UsageAmount {
    let individual_source = individual.or(spend_limit);
    let individual_used = individual_source.and_then(|value| {
        flexible_number(
            value,
            &[
                "used",
                "totalSpend",
                "total_spend",
                "individualUsed",
                "individual_used",
            ],
        )
    });
    let individual_limit = individual_source.and_then(|value| {
        flexible_number(
            value,
            &[
                "limit",
                "individualLimit",
                "individual_limit",
                "pooledLimit",
                "pooled_limit",
            ],
        )
    });
    let team_used = team
        .and_then(|value| flexible_number(value, &["used"]))
        .or_else(|| {
            spend_limit.and_then(|value| {
                flexible_number(
                    value,
                    &["pooledUsed", "pooled_used", "overallUsed", "overall_used"],
                )
            })
        });
    let team_limit = team
        .and_then(|value| flexible_number(value, &["limit"]))
        .or_else(|| {
            spend_limit.and_then(|value| {
                flexible_number(
                    value,
                    &[
                        "pooledLimit",
                        "pooled_limit",
                        "overallLimit",
                        "overall_limit",
                    ],
                )
            })
        });
    let used = if team_scope {
        team_used.or(individual_used)
    } else {
        individual_used
    };
    let limit = if team_scope {
        team_limit.or(individual_limit)
    } else {
        individual_limit
    };
    UsageAmount {
        enabled: individual.and_then(|value| flexible_bool(value, &["enabled"])),
        used,
        limit,
        remaining: used.zip(limit).map(|(used, limit)| (limit - used).max(0.0)),
        percent_used: used
            .zip(limit)
            .filter(|(_, limit)| *limit > 0.0)
            .map(|(used, limit)| used / limit * 100.0),
    }
}
pub(crate) fn map_core_usage(raw: &Value, updated_at: i64, source: &str) -> CoreUsageSnapshot {
    let plan = raw
        .pointer("/individualUsage/plan")
        .or_else(|| raw.pointer("/individual_usage/plan"))
        .or_else(|| raw.get("planUsage"))
        .or_else(|| raw.get("plan_usage"))
        .unwrap_or(&Value::Null);
    let individual_on_demand = raw
        .pointer("/individualUsage/onDemand")
        .or_else(|| raw.pointer("/individual_usage/onDemand"));
    let team_on_demand = raw
        .pointer("/teamUsage/onDemand")
        .or_else(|| raw.pointer("/team_usage/onDemand"));
    let spend_limit = raw
        .get("spendLimitUsage")
        .or_else(|| raw.get("spend_limit_usage"));
    let limit_type = raw
        .get("limitType")
        .or_else(|| raw.get("limit_type"))
        .or_else(|| spend_limit.and_then(|value| value.get("limitType")))
        .or_else(|| spend_limit.and_then(|value| value.get("limit_type")))
        .and_then(Value::as_str);
    let team_scope = limit_type.is_some_and(|value| value.eq_ignore_ascii_case("team"));
    CoreUsageSnapshot {
        total: amount(plan, &["totalPercentUsed", "total_percent_used"]),
        auto_composer: percent_amount(plan, &["autoPercentUsed", "auto_percent_used"]),
        api: percent_amount(plan, &["apiPercentUsed", "api_percent_used"]),
        on_demand: on_demand_amount(
            individual_on_demand,
            team_on_demand,
            spend_limit,
            team_scope,
        ),
        on_demand_limit_type: limit_type.map(|value| value.trim().to_ascii_lowercase()),
        is_unlimited: flexible_bool(raw, &["isUnlimited", "is_unlimited"]).unwrap_or(false),
        billing_cycle_start: raw
            .get("billingCycleStart")
            .or_else(|| raw.get("billing_cycle_start"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        billing_cycle_end: raw
            .get("billingCycleEnd")
            .or_else(|| raw.get("billing_cycle_end"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        source: source.to_owned(),
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
    s.access_granted = match s.access_state.as_deref() {
        Some("SAND_ACCESS_STATE_GRANTED") => Some(true),
        Some("SAND_ACCESS_STATE_BLOCKED") => Some(false),
        _ => None,
    };
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
        matchers::{body_json, header, method, path},
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
    fn allowlist_contains_only_the_recorded_refresh_chain() {
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
        assert!(validate_production_endpoint(
            &Method::POST,
            &Url::parse("https://cursor.com/api/dashboard/get-sand-usage-status").unwrap()
        )
        .is_err());
    }
    #[tokio::test]
    async fn refresh_uses_the_confirmed_sand_bearer_contract() {
        let server = MockServer::start().await;
        mount(&server, "/meta", "POST", serde_json::json!({})).await;
        mount(
            &server,
            "/full-profile",
            "GET",
            serde_json::json!({"membershipType":"pro"}),
        )
        .await;
        mount(
            &server,
            "/usage-summary",
            "GET",
            serde_json::json!({"individualUsage":{"plan":{"totalPercentUsed":12.5}}}),
        )
        .await;
        Mock::given(method("POST"))
            .and(path("/sand-usage"))
            .and(header(
                "authorization",
                format!("Bearer {}", token()).as_str(),
            ))
            .and(header("content-type", "application/json"))
            .and(header("connect-protocol-version", "1"))
            .and(header("user-agent", BROWSER_USER_AGENT))
            .and(body_json(serde_json::json!({})))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "usagePercent": 64.5,
                "grokPlanLabel": "Grok Bot Plan"
            })))
            .mount(&server)
            .await;
        mount(
            &server,
            "/sand-access",
            "POST",
            serde_json::json!({"state":"SAND_ACCESS_STATE_GRANTED"}),
        )
        .await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };

        let updated = provider.refresh_account(record()).await.unwrap();
        let sand = updated.sand.unwrap();

        assert_eq!(sand.usage_percent, Some(64.5));
        assert_eq!(sand.grok_plan_label.as_deref(), Some("Grok Bot Plan"));
        assert_eq!(sand.usage_error, None);
    }
    #[tokio::test]
    async fn sand_access_403_keeps_the_cookie_contract_and_safe_stage() {
        let server = MockServer::start().await;
        mount(&server, "/meta", "POST", serde_json::json!({})).await;
        mount(&server, "/full-profile", "GET", serde_json::json!({})).await;
        mount(
            &server,
            "/usage-summary",
            "GET",
            serde_json::json!({"individualUsage":{"plan":{"totalPercentUsed":12.5}}}),
        )
        .await;
        mount(
            &server,
            "/sand-usage",
            "POST",
            serde_json::json!({"usagePercent":64.5}),
        )
        .await;
        let access_token = token();
        let expected_cookie = build_session_cookie(&access_token).unwrap();
        Mock::given(method("POST"))
            .and(path("/sand-access"))
            .and(header("cookie", expected_cookie.as_str()))
            .and(header("origin", "https://cursor.com"))
            .and(header("accept", "application/json"))
            .and(header("content-type", "application/json"))
            .and(header("user-agent", BROWSER_USER_AGENT))
            .and(body_json(serde_json::json!({})))
            .respond_with(
                ResponseTemplate::new(403)
                    .set_body_string(format!("must stay private: {access_token}")),
            )
            .mount(&server)
            .await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };

        let updated = provider.refresh_account(record()).await.unwrap();
        let sand = updated.sand.unwrap();
        let error = sand.access_error.unwrap();

        assert_eq!(updated.last_error, None);
        assert_eq!(sand.usage_percent, Some(64.5));
        assert!(error.contains("Sand 资格（sand-access）"));
        assert!(error.contains("HTTP 403"));
        assert!(!error.contains(&access_token));
        assert!(!error.contains(expected_cookie.as_str()));
        assert!(!error.contains(&server.uri()));
        assert!(!error.contains("must stay private"));
    }
    #[tokio::test]
    async fn invalid_sand_access_cookie_keeps_successful_bearer_usage() {
        let server = MockServer::start().await;
        mount(&server, "/meta", "POST", serde_json::json!({})).await;
        mount(&server, "/full-profile", "GET", serde_json::json!({})).await;
        mount(
            &server,
            "/sand-usage",
            "POST",
            serde_json::json!({"usagePercent":64.5,"grokPlanLabel":"Grok Bot Plan"}),
        )
        .await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };
        let malformed_token = "e30.e30.signature";
        let mut account = record();
        account.access_token = malformed_token.to_owned();
        account.refresh_token = None;

        let updated = provider.refresh_account(account).await.unwrap();
        let sand = updated.sand.unwrap();
        let access_error = sand.access_error.unwrap();

        assert_eq!(sand.usage_percent, Some(64.5));
        assert_eq!(sand.grok_plan_label.as_deref(), Some("Grok Bot Plan"));
        assert_eq!(sand.usage_error, None);
        assert!(access_error.contains("Sand 资格（sand-access）"));
        assert!(!access_error.contains(malformed_token));
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
    async fn usage_summary_matches_the_cockpit_cookie_contract() {
        let server = MockServer::start().await;
        mount(&server, "/meta", "POST", serde_json::json!({})).await;
        mount(
            &server,
            "/full-profile",
            "GET",
            serde_json::json!({"membershipType":"pro"}),
        )
        .await;
        Mock::given(method("GET"))
            .and(path("/usage-summary"))
            .and(header("accept", "application/json"))
            .and(header(
                "cookie",
                build_session_cookie(&token()).unwrap().as_str(),
            ))
            .and(header("user-agent", COCKPIT_USAGE_USER_AGENT))
            .respond_with(ResponseTemplate::new(200).set_body_json(
                serde_json::json!({"individualUsage":{"plan":{"totalPercentUsed":100.0}}}),
            ))
            .mount(&server)
            .await;
        mount(
            &server,
            "/sand-usage",
            "POST",
            serde_json::json!({"usagePercent":64.5,"grokPlanLabel":"Grok Bot Plan"}),
        )
        .await;
        mount(
            &server,
            "/sand-access",
            "POST",
            serde_json::json!({"state":"SAND_ACCESS_STATE_GRANTED"}),
        )
        .await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };

        let updated = provider.refresh_account(record()).await.unwrap();

        assert_eq!(
            updated
                .core_usage
                .as_ref()
                .and_then(|usage| usage.total.percent_used),
            Some(100.0)
        );
        assert_eq!(updated.last_error, None);
    }
    #[tokio::test]
    async fn optional_refresh_stage_errors_survive_a_successful_core_refresh() {
        let server = MockServer::start().await;
        let expired_payload = URL_SAFE_NO_PAD
            .encode(serde_json::json!({"sub":"auth0|user_fixture","exp":1i64}).to_string());
        let expired_token = format!("e30.{expired_payload}.signature");
        for (method_value, path_value) in [
            ("POST", "/oauth/token"),
            ("POST", "/meta"),
            ("GET", "/full-profile"),
        ] {
            Mock::given(method(method_value))
                .and(path(path_value))
                .respond_with(ResponseTemplate::new(403).set_body_string("private body"))
                .mount(&server)
                .await;
        }
        mount(
            &server,
            "/usage-summary",
            "GET",
            serde_json::json!({"individualUsage":{"plan":{"totalPercentUsed":12.5}}}),
        )
        .await;
        mount(&server, "/sand-usage", "POST", serde_json::json!({})).await;
        mount(&server, "/sand-access", "POST", serde_json::json!({})).await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };
        let mut account = record();
        account.access_token = expired_token.clone();
        account.refresh_token = Some("private-refresh-token".to_owned());

        let updated = provider.refresh_account(account).await.unwrap();

        assert_eq!(updated.last_error, None);
        assert_eq!(updated.core_usage.unwrap().total.percent_used, Some(12.5));
        assert_eq!(updated.auxiliary_errors.len(), 3);
        let diagnostics = updated.auxiliary_errors.join(" | ");
        assert!(diagnostics.contains("令牌续期（oauth）"));
        assert!(diagnostics.contains("账号资料（user-meta）"));
        assert!(diagnostics.contains("订阅资料（full-stripe-profile）"));
        assert!(!diagnostics.contains(&expired_token));
        assert!(!diagnostics.contains("private-refresh-token"));
        assert!(!diagnostics.contains("private body"));
    }
    #[test]
    fn oauth_credentials_are_applied_transactionally() {
        let previous_refresh = "previous-refresh";
        let missing_access = serde_json::json!({"refresh_token":"new-refresh"});
        let should_logout = serde_json::json!({
            "access_token":"new-access",
            "refresh_token":"new-refresh",
            "shouldLogout":true
        });

        assert!(refreshed_credentials(&missing_access, previous_refresh).is_err());
        assert!(refreshed_credentials(&should_logout, previous_refresh).is_err());
        assert_eq!(
            refreshed_credentials(
                &serde_json::json!({"access_token":"new-access"}),
                previous_refresh
            )
            .unwrap(),
            ("new-access".to_owned(), previous_refresh.to_owned())
        );
    }
    #[test]
    fn refreshed_account_fields_stay_in_sync_with_cockpit_auth_raw() {
        let mut account = record();
        account.access_token = "new-access".to_owned();
        account.refresh_token = Some("new-refresh".to_owned());
        account.cursor_auth_raw = Some(serde_json::json!({
            "accessToken":"old-access",
            "refreshToken":"old-refresh"
        }));

        sync_auth_raw_credentials(&mut account);
        sync_auth_raw_meta(
            &mut account,
            &serde_json::json!({
                "email":"updated@example.invalid",
                "signUpType":"github",
                "workosId":"user_updated"
            }),
        );
        sync_auth_raw_profile(
            &mut account,
            &serde_json::json!({
                "membershipType":"pro",
                "subscriptionStatus":"active",
                "teamMembershipType":"enterprise",
                "isTeamMember":true
            }),
        );

        let raw = account.cursor_auth_raw.unwrap();
        assert_eq!(raw["accessToken"], "new-access");
        assert_eq!(raw["refreshToken"], "new-refresh");
        assert_eq!(raw["cachedEmail"], "updated@example.invalid");
        assert_eq!(raw["cachedSignUpType"], "github");
        assert_eq!(raw["workosId"], "user_updated");
        assert_eq!(raw["stripeMembershipType"], "pro");
        assert_eq!(raw["stripeSubscriptionStatus"], "active");
        assert_eq!(raw["teamMembershipType"], "enterprise");
        assert_eq!(raw["isTeamMember"], true);
    }

    #[test]
    fn enterprise_profile_is_not_downgraded_by_an_individual_plan() {
        let profile = serde_json::json!({
            "membershipType": "enterprise",
            "individualMembershipType": "pro"
        });
        assert_eq!(resolve_profile_membership(&profile), Some("enterprise"));

        let mut account = record();
        sync_auth_raw_profile(&mut account, &profile);
        assert_eq!(
            account.cursor_auth_raw.unwrap()["stripeMembershipType"],
            "enterprise"
        );
    }
    #[test]
    fn core_usage_mapping_accepts_cockpit_response_variants() {
        let snapshot = map_core_usage(
            &serde_json::json!({
                "individual_usage": {
                    "plan": {
                        "used":"25",
                        "limit":"100",
                        "auto_percent_used":"20.5",
                        "api_percent_used":"4.5"
                    }
                },
                "spend_limit_usage": {
                    "pooled_used":"50",
                    "pooled_limit":"200",
                    "limit_type":"team"
                },
                "billing_cycle_start":"2026-08-01T00:00:00Z",
                "billing_cycle_end":"2026-09-01T00:00:00Z"
            }),
            123,
            "live",
        );

        assert_eq!(snapshot.total.used, Some(25.0));
        assert_eq!(snapshot.auto_composer.used, None);
        assert_eq!(snapshot.auto_composer.limit, None);
        assert_eq!(snapshot.api.used, None);
        assert_eq!(snapshot.api.limit, None);
        assert_eq!(snapshot.total.percent_used, Some(25.0));
        assert_eq!(snapshot.auto_composer.percent_used, Some(20.5));
        assert_eq!(snapshot.api.percent_used, Some(4.5));
        assert_eq!(snapshot.on_demand.used, Some(50.0));
        assert_eq!(snapshot.on_demand.limit, Some(200.0));
        assert_eq!(snapshot.on_demand_limit_type.as_deref(), Some("team"));
        assert!(!snapshot.is_unlimited);
        assert_eq!(
            snapshot.billing_cycle_start.as_deref(),
            Some("2026-08-01T00:00:00Z")
        );
        assert_eq!(
            snapshot.billing_cycle_end.as_deref(),
            Some("2026-09-01T00:00:00Z")
        );
    }

    #[test]
    fn team_on_demand_metrics_fall_back_per_field_like_cockpit() {
        let snapshot = map_core_usage(
            &serde_json::json!({
                "limitType": "team",
                "individualUsage": { "onDemand": { "enabled": true, "used": 7, "limit": 80 } },
                "teamUsage": { "onDemand": { "used": 50 } },
                "spendLimitUsage": { "pooledLimit": 200 }
            }),
            123,
            "live",
        );

        assert_eq!(snapshot.on_demand.enabled, Some(true));
        assert_eq!(snapshot.on_demand.used, Some(50.0));
        assert_eq!(snapshot.on_demand.limit, Some(200.0));
        assert_eq!(snapshot.on_demand.percent_used, Some(25.0));
    }
    #[tokio::test]
    async fn oauth_failure_does_not_change_the_core_usage_error_stage() {
        let server = MockServer::start().await;
        let expired_payload = URL_SAFE_NO_PAD
            .encode(serde_json::json!({"sub":"auth0|user_fixture","exp":1i64}).to_string());
        let expired_token = format!("e30.{expired_payload}.signature");
        Mock::given(method("POST"))
            .and(path("/oauth/token"))
            .respond_with(ResponseTemplate::new(500).set_body_string("private oauth body"))
            .mount(&server)
            .await;
        mount(&server, "/meta", "POST", serde_json::json!({})).await;
        mount(&server, "/full-profile", "GET", serde_json::json!({})).await;
        Mock::given(method("GET"))
            .and(path("/usage-summary"))
            .respond_with(ResponseTemplate::new(403).set_body_string("private usage body"))
            .mount(&server)
            .await;
        mount(&server, "/sand-usage", "POST", serde_json::json!({})).await;
        mount(&server, "/sand-access", "POST", serde_json::json!({})).await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };
        let mut account = record();
        account.access_token = expired_token;
        account.refresh_token = Some("private-refresh-token".to_owned());

        let updated = provider.refresh_account(account).await.unwrap();
        let core_error = updated.last_error.unwrap();
        let diagnostics = updated.auxiliary_errors.join(" | ");

        assert!(core_error.contains("核心额度（usage-summary）"));
        assert!(core_error.contains("HTTP 403"));
        assert!(!core_error.contains("oauth"));
        assert!(!core_error.contains("HTTP 500"));
        assert!(diagnostics.contains("令牌续期（oauth）"));
        assert!(diagnostics.contains("HTTP 500"));
        assert!(!diagnostics.contains("private oauth body"));
    }
    #[tokio::test]
    async fn usage_summary_failure_keeps_a_safe_endpoint_stage() {
        let server = MockServer::start().await;
        mount(&server, "/meta", "POST", serde_json::json!({})).await;
        mount(&server, "/full-profile", "GET", serde_json::json!({})).await;
        Mock::given(method("GET"))
            .and(path("/usage-summary"))
            .respond_with(ResponseTemplate::new(403))
            .mount(&server)
            .await;
        mount(
            &server,
            "/sand-usage",
            "POST",
            serde_json::json!({"usagePercent":64.5,"grokPlanLabel":"Grok Bot Plan"}),
        )
        .await;
        mount(
            &server,
            "/sand-access",
            "POST",
            serde_json::json!({"state":"SAND_ACCESS_STATE_GRANTED"}),
        )
        .await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };

        let updated = provider.refresh_account(record()).await.unwrap();
        let error = updated.last_error.unwrap();

        assert!(error.contains("核心额度（usage-summary）"));
        assert!(error.contains("HTTP 403"));
        assert!(!error.contains(&server.uri()));
        let sand = updated.sand.unwrap();
        assert_eq!(sand.usage_percent, Some(64.5));
        assert_eq!(sand.grok_plan_label.as_deref(), Some("Grok Bot Plan"));
        assert_eq!(sand.access_granted, Some(true));
        assert_eq!(sand.usage_error, None);
        assert_eq!(sand.access_error, None);
    }
    #[tokio::test]
    async fn local_credential_errors_keep_their_endpoint_stage() {
        let server = MockServer::start().await;
        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            endpoints: Endpoints::mock(&server.uri()),
            enforce_allowlist: false,
        };

        let cases = [
            provider
                .get_usage("not-a-session-jwt")
                .await
                .unwrap_err()
                .to_string(),
            provider
                .post_bearer_json(
                    &provider.endpoints.meta,
                    "invalid\r\nheader",
                    Value::Object(Default::default()),
                    "账号资料（user-meta）",
                )
                .await
                .unwrap_err()
                .to_string(),
            provider
                .get_bearer(
                    &provider.endpoints.full_profile,
                    "invalid\r\nheader",
                    "订阅资料（full-stripe-profile）",
                )
                .await
                .unwrap_err()
                .to_string(),
            provider
                .post_sand_usage(
                    &provider.endpoints.sand_usage,
                    "invalid\r\nheader",
                    "Sand 用量（sand-usage）",
                )
                .await
                .unwrap_err()
                .to_string(),
            provider
                .post_cookie_json(
                    &provider.endpoints.sand_access,
                    "invalid\r\nheader",
                    "Sand 资格（sand-access）",
                )
                .await
                .unwrap_err()
                .to_string(),
        ];

        for (error, stage) in cases.iter().zip([
            "核心额度（usage-summary）",
            "账号资料（user-meta）",
            "订阅资料（full-stripe-profile）",
            "Sand 用量（sand-usage）",
            "Sand 资格（sand-access）",
        ]) {
            assert!(error.contains(stage), "missing stage in: {error}");
            assert!(!error.contains("invalid"));
        }
    }
    #[test]
    fn unknown_sand_access_state_remains_unknown() {
        let mut sand = SandSnapshot::default();
        map_sand_access(
            &mut sand,
            &serde_json::json!({"state":"SAND_ACCESS_STATE_FUTURE_VALUE"}),
        );
        assert_eq!(sand.access_granted, None);
        assert_eq!(
            sand.access_state.as_deref(),
            Some("SAND_ACCESS_STATE_FUTURE_VALUE")
        );
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
