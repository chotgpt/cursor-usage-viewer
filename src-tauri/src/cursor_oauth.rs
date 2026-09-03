use std::{
    sync::Mutex,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use reqwest::{redirect::Policy, Client, StatusCode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

use crate::{
    cockpit_import::{jwt_claim, valid_jwt},
    error::{AppError, AppResult},
    model::{CursorAccountRecord, ACCOUNT_SCHEMA_VERSION},
};

const LOGIN_URL: &str = "https://cursor.com/loginDeepControl";
const POLL_URL: &str = "https://api2.cursor.sh/auth/poll";
const POLL_INTERVAL: Duration = Duration::from_secs(2);
const MAX_POLLS: usize = 150;
const MAX_RESPONSE_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CursorLoginStart {
    pub login_id: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval_seconds: u64,
}

struct PendingLogin {
    login_id: String,
    uuid: String,
    verifier: Zeroizing<String>,
    expires_at: i64,
    cancelled: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PollResponse {
    access_token: Option<String>,
    refresh_token: Option<String>,
    auth_id: Option<String>,
}

pub struct CursorOAuthManager {
    client: Client,
    pending: Mutex<Option<PendingLogin>>,
    poll_endpoint: Url,
}

impl CursorOAuthManager {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            client: Client::builder()
                .https_only(true)
                .redirect(Policy::none())
                .connect_timeout(Duration::from_secs(10))
                .timeout(Duration::from_secs(15))
                .build()
                .map_err(|error| AppError::ProviderInit(error.to_string()))?,
            pending: Mutex::new(None),
            poll_endpoint: Url::parse(POLL_URL).map_err(|_| AppError::EndpointRejected)?,
        })
    }

    pub fn start(&self) -> AppResult<CursorLoginStart> {
        let mut verifier_bytes = [0u8; 32];
        OsRng.fill_bytes(&mut verifier_bytes);
        let verifier = Zeroizing::new(URL_SAFE_NO_PAD.encode(verifier_bytes));
        verifier_bytes.zeroize();
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let uuid = Uuid::new_v4().to_string();
        let login_id = uuid.clone();
        let mut url = Url::parse(LOGIN_URL).map_err(|_| AppError::EndpointRejected)?;
        url.query_pairs_mut()
            .append_pair("challenge", &challenge)
            .append_pair("uuid", &uuid)
            .append_pair("mode", "login");
        validate_login_url(&url)?;
        *self
            .pending
            .lock()
            .map_err(|_| AppError::StateUnavailable)? = Some(PendingLogin {
            login_id: login_id.clone(),
            uuid,
            verifier,
            expires_at: now_seconds() + 300,
            cancelled: false,
        });
        Ok(CursorLoginStart {
            login_id,
            verification_uri: url.to_string(),
            expires_in: 300,
            interval_seconds: 2,
        })
    }

    pub fn cancel(&self, login_id: Option<&str>) -> AppResult<()> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        if let Some(session) = pending.as_mut() {
            if login_id.is_none() || login_id == Some(session.login_id.as_str()) {
                session.cancelled = true;
            }
        }
        Ok(())
    }

    pub async fn complete(&self, login_id: &str) -> AppResult<CursorAccountRecord> {
        for _ in 0..MAX_POLLS {
            let (uuid, verifier) = self.active_material(login_id)?;
            let mut poll_url = self.poll_endpoint.clone();
            poll_url
                .query_pairs_mut()
                .append_pair("uuid", &uuid)
                .append_pair("verifier", verifier.as_str());
            validate_poll_url(&poll_url)?;
            let response = match self
                .client
                .get(poll_url)
                .header("Accept", "application/json")
                .send()
                .await
            {
                Ok(response) => response,
                Err(_) => {
                    tokio::time::sleep(POLL_INTERVAL).await;
                    continue;
                }
            };
            if response.status() == StatusCode::NOT_FOUND {
                tokio::time::sleep(POLL_INTERVAL).await;
                continue;
            }
            if response.status() != StatusCode::OK {
                tokio::time::sleep(POLL_INTERVAL).await;
                continue;
            }
            if response
                .content_length()
                .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
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
            // Cancellation can happen while the HTTP request is in flight. Recheck
            // before accepting credentials so closing the dialog cannot import an
            // account after the user cancelled the login.
            self.active_material(login_id)?;
            let mut data: PollResponse =
                serde_json::from_slice(&body).map_err(|_| AppError::OAuthInvalidResponse)?;
            if let (Some(access_token), Some(refresh_token)) =
                (data.access_token.take(), data.refresh_token.take())
            {
                let auth_id = data.auth_id.take();
                *self
                    .pending
                    .lock()
                    .map_err(|_| AppError::StateUnavailable)? = None;
                return Ok(record_from_credentials(
                    access_token,
                    Some(refresh_token),
                    auth_id,
                    "cursor-oauth",
                ));
            }
            tokio::time::sleep(POLL_INTERVAL).await;
        }
        *self
            .pending
            .lock()
            .map_err(|_| AppError::StateUnavailable)? = None;
        Err(AppError::OAuthExpired)
    }

    fn active_material(&self, login_id: &str) -> AppResult<(String, Zeroizing<String>)> {
        let mut pending = self
            .pending
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let Some(session) = pending.as_ref() else {
            return Err(AppError::OAuthSessionMissing);
        };
        if session.login_id != login_id {
            return Err(AppError::OAuthSessionMissing);
        }
        if session.cancelled {
            *pending = None;
            return Err(AppError::OAuthCancelled);
        }
        if now_seconds() > session.expires_at {
            *pending = None;
            return Err(AppError::OAuthExpired);
        }
        let session = pending.as_ref().expect("active login was checked above");
        Ok((
            session.uuid.clone(),
            Zeroizing::new(session.verifier.to_string()),
        ))
    }
}

pub fn record_from_access_token(access_token: String) -> AppResult<CursorAccountRecord> {
    let access_token = access_token.trim().to_owned();
    if access_token.len() > 64 * 1024 || !valid_jwt(&access_token) {
        return Err(AppError::AccessTokenMissing);
    }
    let auth_id = jwt_claim(&access_token, "sub");
    Ok(record_from_credentials(
        access_token,
        None,
        auth_id,
        "token-import",
    ))
}

fn record_from_credentials(
    access_token: String,
    refresh_token: Option<String>,
    auth_id: Option<String>,
    source: &str,
) -> CursorAccountRecord {
    let now = now_seconds();
    let auth_id = auth_id.or_else(|| jwt_claim(&access_token, "sub"));
    let digest = Sha256::digest(access_token.as_bytes());
    let id = format!("cursor_{}", &hex_digest(&digest)[..24]);
    let email = auth_id
        .as_deref()
        .filter(|value| value.contains('@'))
        .map(ToOwned::to_owned);
    let cursor_auth_raw = Some(serde_json::json!({
        "accessToken": access_token,
        "refreshToken": refresh_token,
        "authId": auth_id,
    }));
    CursorAccountRecord {
        schema_version: ACCOUNT_SCHEMA_VERSION,
        id,
        email,
        auth_id,
        name: None,
        tags: Vec::new(),
        access_token,
        refresh_token,
        membership_type: None,
        subscription_status: None,
        sign_up_type: None,
        cursor_auth_raw,
        cursor_usage_raw: None,
        status: None,
        status_reason: None,
        source: source.to_owned(),
        core_usage: None,
        sand: None,
        auxiliary_errors: Vec::new(),
        last_error: None,
        last_error_at: None,
        created_at: now,
        last_used: now,
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn validate_login_url(url: &Url) -> AppResult<()> {
    let pairs = url.query_pairs().collect::<Vec<_>>();
    let valid = url.scheme() == "https"
        && url.host_str() == Some("cursor.com")
        && url.port_or_known_default() == Some(443)
        && url.path() == "/loginDeepControl"
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && pairs.len() == 3
        && pairs[0].0 == "challenge"
        && !pairs[0].1.is_empty()
        && pairs[1].0 == "uuid"
        && Uuid::parse_str(&pairs[1].1).is_ok()
        && pairs[2] == ("mode".into(), "login".into());
    if valid {
        Ok(())
    } else {
        Err(AppError::EndpointRejected)
    }
}

pub fn validate_poll_url(url: &Url) -> AppResult<()> {
    let pairs = url.query_pairs().collect::<Vec<_>>();
    let valid = url.scheme() == "https"
        && url.host_str() == Some("api2.cursor.sh")
        && url.port_or_known_default() == Some(443)
        && url.path() == "/auth/poll"
        && url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && pairs.len() == 2
        && pairs[0].0 == "uuid"
        && Uuid::parse_str(&pairs[0].1).is_ok()
        && pairs[1].0 == "verifier"
        && !pairs[1].1.is_empty();
    if valid {
        Ok(())
    } else {
        Err(AppError::EndpointRejected)
    }
}

fn now_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_and_poll_allowlists_reject_uncontrolled_urls() {
        let manager = CursorOAuthManager::new().unwrap();
        let login = manager.start().unwrap();
        assert!(validate_login_url(&Url::parse(&login.verification_uri).unwrap()).is_ok());
        assert!(validate_login_url(&Url::parse("https://cursor.com/loginDeepControl?challenge=x&uuid=00000000-0000-0000-0000-000000000000&mode=other").unwrap()).is_err());
        assert!(validate_poll_url(&Url::parse("https://evil.invalid/auth/poll?uuid=00000000-0000-0000-0000-000000000000&verifier=x").unwrap()).is_err());
    }

    #[test]
    fn raw_token_view_is_redacted_and_uses_a_stable_safe_id() {
        let token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.invalid";
        let view = record_from_access_token(token.to_owned())
            .unwrap()
            .view(None);
        assert!(view.id.starts_with("cursor_"));
        assert_eq!(view.auth_id.as_deref(), Some("test"));
        assert!(view.has_access_token);
        assert!(!serde_json::to_string(&view).unwrap().contains(token));
        assert!(record_from_access_token("not-a-jwt".to_owned()).is_err());
    }

    #[test]
    fn oauth_credentials_are_redacted_from_the_returned_view() {
        let access_token = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.invalid";
        let refresh_token = "refresh-secret";
        let view = record_from_credentials(
            access_token.to_owned(),
            Some(refresh_token.to_owned()),
            Some("test".to_owned()),
            "cursor-oauth",
        )
        .view(None);
        let serialized = serde_json::to_string(&view).unwrap();
        assert!(view.has_access_token);
        assert!(view.has_refresh_token);
        assert!(!serialized.contains(access_token));
        assert!(!serialized.contains(refresh_token));
    }

    #[test]
    fn cancellation_invalidates_an_active_login_without_exposing_session_material() {
        let manager = CursorOAuthManager::new().unwrap();
        let login = manager.start().unwrap();
        manager.cancel(Some(&login.login_id)).unwrap();
        assert!(matches!(
            manager.active_material(&login.login_id),
            Err(AppError::OAuthCancelled)
        ));
        assert!(matches!(
            manager.active_material(&login.login_id),
            Err(AppError::OAuthSessionMissing)
        ));
    }

    #[test]
    fn expired_login_is_cleared_before_polling() {
        let manager = CursorOAuthManager::new().unwrap();
        let login = manager.start().unwrap();
        manager.pending.lock().unwrap().as_mut().unwrap().expires_at = now_seconds() - 1;

        assert!(matches!(
            manager.active_material(&login.login_id),
            Err(AppError::OAuthExpired)
        ));
        assert!(matches!(
            manager.active_material(&login.login_id),
            Err(AppError::OAuthSessionMissing)
        ));
    }
}
