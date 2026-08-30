use std::time::Duration;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use reqwest::{
    header::{HeaderValue, AUTHORIZATION, CONTENT_TYPE, COOKIE, ORIGIN},
    redirect::Policy,
    Client, Response,
};
use serde::{de::DeserializeOwned, Deserialize};
use url::Url;
use zeroize::Zeroizing;

use crate::{
    error::{AppError, AppResult},
    model::QuotaSnapshot,
};

const CURSOR_ORIGIN: &str = "https://cursor.com";
const USAGE_ENDPOINT: &str = "https://cursor.com/api/dashboard/get-sand-usage-status";
const USAGE_PATH: &str = "/api/dashboard/get-sand-usage-status";
const ACCESS_ENDPOINT: &str = "https://cursor.com/api/dashboard/get-sand-access-status";
const ACCESS_PATH: &str = "/api/dashboard/get-sand-access-status";
const PERIOD_USAGE_ENDPOINT: &str =
    "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const PERIOD_USAGE_PATH: &str = "/aiserver.v1.DashboardService/GetCurrentPeriodUsage";
const MAX_RESPONSE_BYTES: usize = 512 * 1024;

pub struct CursorUsageProvider {
    client: Client,
    usage_endpoint: Url,
    access_endpoint: Url,
    period_usage_endpoint: Url,
    enforce_production_whitelist: bool,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandUsageResponse {
    #[serde(default)]
    usage_percent: Option<f64>,
    #[serde(default)]
    has_available_usage: Option<bool>,
    #[serde(default)]
    has_non_zero_included_limit: Option<bool>,
    #[serde(default)]
    grok_plan_label: Option<String>,
    #[serde(default)]
    current_period_start: Option<String>,
    #[serde(default)]
    next_reset_timestamp_utc: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SandAccessResponse {
    #[serde(default)]
    state: Option<String>,
    #[serde(default)]
    block_reason: Option<String>,
    #[serde(default)]
    is_paid_trial_plan: Option<bool>,
    #[serde(default)]
    pro_and_super_grok_plans_grant_access: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CurrentPeriodUsageResponse {
    #[serde(default)]
    billing_cycle_start: String,
    #[serde(default)]
    billing_cycle_end: String,
    #[serde(default)]
    plan_usage: Option<PlanUsageResponse>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlanUsageResponse {
    #[serde(default)]
    auto_percent_used: Option<f64>,
    #[serde(default)]
    api_percent_used: Option<f64>,
    #[serde(default)]
    total_percent_used: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct SessionClaims {
    sub: String,
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
            usage_endpoint: Url::parse(USAGE_ENDPOINT).map_err(|_| AppError::EndpointRejected)?,
            access_endpoint: Url::parse(ACCESS_ENDPOINT).map_err(|_| AppError::EndpointRejected)?,
            period_usage_endpoint: Url::parse(PERIOD_USAGE_ENDPOINT)
                .map_err(|_| AppError::EndpointRejected)?,
            enforce_production_whitelist: true,
        })
    }

    pub async fn fetch_quota_snapshot(&self, access_token: &str) -> AppResult<QuotaSnapshot> {
        if self.enforce_production_whitelist {
            validate_production_endpoint(&self.usage_endpoint)?;
            validate_production_endpoint(&self.access_endpoint)?;
            validate_production_endpoint(&self.period_usage_endpoint)?;
        }

        let cookie = build_workos_cookie(access_token)?;
        let period_usage: CurrentPeriodUsageResponse = self
            .post_connect_json(&self.period_usage_endpoint, access_token)
            .await?;
        let plan_usage = period_usage.plan_usage.unwrap_or_default();
        let usage: SandUsageResponse = self
            .post_json(&self.usage_endpoint, &cookie)
            .await
            .unwrap_or_default();
        let access: SandAccessResponse = self
            .post_json(&self.access_endpoint, &cookie)
            .await
            .unwrap_or_default();

        let sand_access_granted = access
            .state
            .as_deref()
            .map(|state| state == "SAND_ACCESS_STATE_GRANTED");

        Ok(QuotaSnapshot {
            auto_percent_used: plan_usage.auto_percent_used,
            api_percent_used: plan_usage.api_percent_used,
            total_percent_used: plan_usage.total_percent_used,
            billing_cycle_start: period_usage.billing_cycle_start,
            billing_cycle_end: period_usage.billing_cycle_end,
            usage_percent: usage.usage_percent,
            has_available_usage: usage.has_available_usage,
            has_non_zero_included_limit: usage.has_non_zero_included_limit,
            grok_plan_label: usage.grok_plan_label,
            current_period_start: usage.current_period_start,
            next_reset_timestamp_utc: usage.next_reset_timestamp_utc,
            sand_access_granted,
            sand_access_state: access.state,
            sand_block_reason: access.block_reason,
            is_paid_trial_plan: access.is_paid_trial_plan,
            pro_and_super_grok_plans_grant_access: access.pro_and_super_grok_plans_grant_access,
        })
    }

    async fn post_json<T: DeserializeOwned>(&self, endpoint: &Url, cookie: &str) -> AppResult<T> {
        let cookie_source = Zeroizing::new(format!("WorkosCursorSessionToken={cookie}"));
        let mut cookie_header = HeaderValue::from_str(cookie_source.as_str())
            .map_err(|_| AppError::InvalidCredentialHeader)?;
        cookie_header.set_sensitive(true);

        let response = self
            .client
            .post(endpoint.clone())
            .header(COOKIE, cookie_header)
            .header(ORIGIN, HeaderValue::from_static(CURSOR_ORIGIN))
            .send()
            .await
            .map_err(|error| AppError::Request(error.without_url().to_string()))?;
        parse_json_response(response).await
    }

    async fn post_connect_json<T: DeserializeOwned>(
        &self,
        endpoint: &Url,
        access_token: &str,
    ) -> AppResult<T> {
        let bearer_source = Zeroizing::new(format!("Bearer {access_token}"));
        let mut authorization = HeaderValue::from_str(bearer_source.as_str())
            .map_err(|_| AppError::InvalidCredentialHeader)?;
        authorization.set_sensitive(true);

        let response = self
            .client
            .post(endpoint.clone())
            .header(AUTHORIZATION, authorization)
            .header(CONTENT_TYPE, HeaderValue::from_static("application/json"))
            .header("Connect-Protocol-Version", HeaderValue::from_static("1"))
            .body("{}")
            .send()
            .await
            .map_err(|error| AppError::Request(error.without_url().to_string()))?;
        parse_json_response(response).await
    }
}

async fn parse_json_response<T: DeserializeOwned>(response: Response) -> AppResult<T> {
    let status = response.status().as_u16();
    if status != 200 {
        return Err(AppError::UnexpectedStatus(status));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_RESPONSE_BYTES as u64)
    {
        return Err(AppError::ResponseTooLarge);
    }
    let body = response
        .bytes()
        .await
        .map_err(|error| AppError::Request(error.without_url().to_string()))?;
    if body.len() > MAX_RESPONSE_BYTES {
        return Err(AppError::ResponseTooLarge);
    }
    serde_json::from_slice(&body).map_err(|_| AppError::InvalidJson(status))
}

fn build_workos_cookie(access_token: &str) -> AppResult<Zeroizing<String>> {
    let mut segments = access_token.split('.');
    let _header = segments.next().ok_or(AppError::InvalidSessionToken)?;
    let payload = segments.next().ok_or(AppError::InvalidSessionToken)?;
    let _signature = segments.next().ok_or(AppError::InvalidSessionToken)?;
    if segments.next().is_some() {
        return Err(AppError::InvalidSessionToken);
    }

    let decoded = Zeroizing::new(
        URL_SAFE_NO_PAD
            .decode(payload)
            .map_err(|_| AppError::InvalidSessionToken)?,
    );
    let claims: SessionClaims =
        serde_json::from_slice(&decoded).map_err(|_| AppError::InvalidSessionToken)?;
    let user_id = claims
        .sub
        .split_once('|')
        .map_or(claims.sub.as_str(), |(_, value)| value);
    let valid_user_id = !user_id.is_empty()
        && user_id.len() <= 128
        && user_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'));
    if !valid_user_id {
        return Err(AppError::InvalidSessionToken);
    }

    let source = Zeroizing::new(format!("{user_id}::{access_token}"));
    let encoded: String = url::form_urlencoded::byte_serialize(source.as_bytes()).collect();
    Ok(Zeroizing::new(encoded))
}

pub fn validate_production_endpoint(url: &Url) -> AppResult<()> {
    let allowed_target = matches!(
        (url.host_str(), url.path()),
        (Some("cursor.com"), USAGE_PATH | ACCESS_PATH)
            | (Some("api2.cursor.sh"), PERIOD_USAGE_PATH)
    );
    let allowed = url.scheme() == "https"
        && url.port_or_known_default() == Some(443)
        && url.username().is_empty()
        && url.password().is_none()
        && allowed_target
        && url.query().is_none()
        && url.fragment().is_none();
    if allowed {
        Ok(())
    } else {
        Err(AppError::EndpointRejected)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::{
        matchers::{header, method, path},
        Mock, MockServer, ResponseTemplate,
    };

    use super::*;

    #[test]
    fn accepts_only_the_three_exact_https_usage_endpoints() {
        assert!(validate_production_endpoint(&Url::parse(USAGE_ENDPOINT).unwrap()).is_ok());
        assert!(validate_production_endpoint(&Url::parse(ACCESS_ENDPOINT).unwrap()).is_ok());
        assert!(validate_production_endpoint(&Url::parse(PERIOD_USAGE_ENDPOINT).unwrap()).is_ok());
        for rejected in [
            "http://cursor.com/api/dashboard/get-sand-usage-status",
            "https://evil.example/api/dashboard/get-sand-usage-status",
            "https://cursor.com/api/dashboard/get-current-period-usage",
            "https://cursor.com/aiserver.v1.DashboardService/GetCurrentPeriodUsage",
            "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage?team=1",
            "https://api2.cursor.sh/aiserver.v1.DashboardService/GetPlanInfo",
            "https://cursor.com/api/dashboard/get-sand-usage-status?next=evil",
            "https://cursor.com.evil.example/api/dashboard/get-sand-usage-status",
        ] {
            assert!(validate_production_endpoint(&Url::parse(rejected).unwrap()).is_err());
        }
    }

    #[test]
    fn builds_the_dashboard_cookie_from_the_jwt_subject() {
        let fake_jwt = "e30.eyJzdWIiOiJhdXRoMHx1c2VyX3Rlc3QifQ.signature";
        assert_eq!(
            build_workos_cookie(fake_jwt).unwrap().as_str(),
            format!("user_test%3A%3A{fake_jwt}")
        );
    }

    #[test]
    fn rejects_a_session_without_a_safe_subject() {
        let fake_jwt = "e30.eyJzdWIiOiJhdXRoMHxiYWQ6dXNlciJ9.signature";
        assert!(matches!(
            build_workos_cookie(fake_jwt),
            Err(AppError::InvalidSessionToken)
        ));
    }

    #[test]
    fn missing_auto_and_api_percentages_remain_unknown() {
        let response: CurrentPeriodUsageResponse = serde_json::from_value(json!({})).unwrap();
        assert!(response.plan_usage.is_none());
        assert!(response.billing_cycle_start.is_empty());
        assert!(response.billing_cycle_end.is_empty());

        let null_response: CurrentPeriodUsageResponse =
            serde_json::from_value(json!({ "planUsage": null })).unwrap();
        assert!(null_response.plan_usage.is_none());
    }

    #[tokio::test]
    async fn mock_requests_use_workos_cookie_origin_and_parse_quota() {
        let server = MockServer::start().await;
        let fake_jwt = "e30.eyJzdWIiOiJhdXRoMHx1c2VyX3Rlc3QifQ.signature";
        let expected_cookie = format!("WorkosCursorSessionToken=user_test%3A%3A{fake_jwt}");

        Mock::given(method("POST"))
            .and(path(PERIOD_USAGE_PATH))
            .and(header(
                "authorization",
                format!("Bearer {fake_jwt}").as_str(),
            ))
            .and(header("content-type", "application/json"))
            .and(header("connect-protocol-version", "1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "billingCycleStart": "1787875200000",
                "billingCycleEnd": "1790553600000",
                "planUsage": {
                    "autoPercentUsed": 12.25,
                    "apiPercentUsed": 46.5,
                    "totalPercentUsed": 31.75
                }
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(USAGE_PATH))
            .and(header("cookie", expected_cookie.as_str()))
            .and(header("origin", CURSOR_ORIGIN))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "usagePercent": 64.5,
                "hasAvailableUsage": true,
                "hasNonZeroIncludedLimit": true,
                "grokPlanLabel": "Grok Bot Plan",
                "currentPeriodStart": "2026-08-28T02:36:21.032Z",
                "nextResetTimestampUtc": "2026-09-04T02:36:21.032Z"
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(ACCESS_PATH))
            .and(header("cookie", expected_cookie.as_str()))
            .and(header("origin", CURSOR_ORIGIN))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "state": "SAND_ACCESS_STATE_GRANTED",
                "blockReason": "SAND_ACCESS_BLOCK_REASON_NONE",
                "isPaidTrialPlan": false,
                "proAndSuperGrokPlansGrantAccess": true
            })))
            .mount(&server)
            .await;

        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            usage_endpoint: Url::parse(&format!("{}{USAGE_PATH}", server.uri())).unwrap(),
            access_endpoint: Url::parse(&format!("{}{ACCESS_PATH}", server.uri())).unwrap(),
            period_usage_endpoint: Url::parse(&format!("{}{PERIOD_USAGE_PATH}", server.uri()))
                .unwrap(),
            enforce_production_whitelist: false,
        };
        let snapshot = provider.fetch_quota_snapshot(fake_jwt).await.unwrap();
        assert_eq!(snapshot.auto_percent_used, Some(12.25));
        assert_eq!(snapshot.api_percent_used, Some(46.5));
        assert_eq!(snapshot.total_percent_used, Some(31.75));
        assert_eq!(snapshot.billing_cycle_start, "1787875200000");
        assert_eq!(snapshot.billing_cycle_end, "1790553600000");
        assert_eq!(snapshot.usage_percent, Some(64.5));
        assert_eq!(snapshot.grok_plan_label.as_deref(), Some("Grok Bot Plan"));
        assert_eq!(snapshot.sand_access_granted, Some(true));
        assert_eq!(
            snapshot.next_reset_timestamp_utc.as_deref(),
            Some("2026-09-04T02:36:21.032Z")
        );
        let serialized = serde_json::to_string(&snapshot).unwrap();
        assert!(!serialized.contains(fake_jwt));
        assert!(!serialized.contains("user_test"));
    }

    #[tokio::test]
    async fn free_account_without_sand_allowance_keeps_period_usage_available() {
        let server = MockServer::start().await;
        let fake_jwt = "e30.eyJzdWIiOiJhdXRoMHx1c2VyX2ZyZWUifQ.signature";

        Mock::given(method("POST"))
            .and(path(PERIOD_USAGE_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "billingCycleStart": "1787875200000",
                "billingCycleEnd": "1790553600000",
                "planUsage": {
                    "autoPercentUsed": 4.5,
                    "totalPercentUsed": 4.5
                }
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(USAGE_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "hasAvailableUsage": false,
                "hasNonZeroIncludedLimit": false
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(ACCESS_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "state": "SAND_ACCESS_STATE_BLOCKED",
                "blockReason": "SAND_ACCESS_BLOCK_REASON_NO_PLAN"
            })))
            .mount(&server)
            .await;

        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            usage_endpoint: Url::parse(&format!("{}{USAGE_PATH}", server.uri())).unwrap(),
            access_endpoint: Url::parse(&format!("{}{ACCESS_PATH}", server.uri())).unwrap(),
            period_usage_endpoint: Url::parse(&format!("{}{PERIOD_USAGE_PATH}", server.uri()))
                .unwrap(),
            enforce_production_whitelist: false,
        };

        let snapshot = provider.fetch_quota_snapshot(fake_jwt).await.unwrap();
        assert_eq!(snapshot.auto_percent_used, Some(4.5));
        assert_eq!(snapshot.total_percent_used, Some(4.5));
        assert_eq!(snapshot.usage_percent, None);
        assert_eq!(snapshot.has_available_usage, Some(false));
        assert_eq!(snapshot.has_non_zero_included_limit, Some(false));
        assert_eq!(snapshot.grok_plan_label, None);
        assert_eq!(snapshot.sand_access_granted, Some(false));
        assert_eq!(
            snapshot.sand_access_state.as_deref(),
            Some("SAND_ACCESS_STATE_BLOCKED")
        );
        assert_eq!(snapshot.is_paid_trial_plan, None);
    }

    #[tokio::test]
    async fn optional_sand_failures_do_not_discard_period_usage() {
        let server = MockServer::start().await;
        let fake_jwt = "e30.eyJzdWIiOiJhdXRoMHx1c2VyX29wdGlvbmFsIn0.signature";

        Mock::given(method("POST"))
            .and(path(PERIOD_USAGE_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "planUsage": { "apiPercentUsed": 8.25 }
            })))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(USAGE_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_string("not-json"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(ACCESS_PATH))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;

        let provider = CursorUsageProvider {
            client: Client::builder().redirect(Policy::none()).build().unwrap(),
            usage_endpoint: Url::parse(&format!("{}{USAGE_PATH}", server.uri())).unwrap(),
            access_endpoint: Url::parse(&format!("{}{ACCESS_PATH}", server.uri())).unwrap(),
            period_usage_endpoint: Url::parse(&format!("{}{PERIOD_USAGE_PATH}", server.uri()))
                .unwrap(),
            enforce_production_whitelist: false,
        };

        let snapshot = provider.fetch_quota_snapshot(fake_jwt).await.unwrap();
        assert_eq!(snapshot.api_percent_used, Some(8.25));
        assert_eq!(snapshot.usage_percent, None);
        assert_eq!(snapshot.sand_access_granted, None);
    }
}
