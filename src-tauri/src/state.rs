use std::sync::Mutex;

use zeroize::Zeroizing;

use crate::{
    error::{AppError, AppResult},
    model::{AccountSummary, ManagedAccount},
    provider::CursorUsageProvider,
};

pub struct AppState {
    accounts: Mutex<ManagedAccounts>,
    pub provider: CursorUsageProvider,
}

#[derive(Default)]
struct ManagedAccounts {
    items: Vec<ManagedAccount>,
    active_id: Option<String>,
}

impl AppState {
    pub fn new() -> AppResult<Self> {
        Ok(Self {
            accounts: Mutex::new(ManagedAccounts::default()),
            provider: CursorUsageProvider::new()?,
        })
    }

    pub fn upsert_local_account(&self, account: ManagedAccount) -> AppResult<AccountSummary> {
        let mut accounts = self
            .accounts
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        accounts.items.retain(|item| item.id != account.id);
        accounts.active_id = Some(account.id.clone());
        accounts.items.insert(0, account);
        Ok(accounts.items[0].to_summary(true))
    }

    pub fn replace_cockpit_accounts(
        &self,
        imported: Vec<ManagedAccount>,
    ) -> AppResult<Vec<AccountSummary>> {
        let mut accounts = self
            .accounts
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let previous_active = accounts.active_id.clone();
        accounts
            .items
            .retain(|account| account.source != "cockpit-tools");
        accounts.items.extend(imported);

        let active_still_exists = previous_active
            .as_deref()
            .is_some_and(|id| accounts.items.iter().any(|account| account.id == id));
        accounts.active_id = if active_still_exists {
            previous_active
        } else {
            accounts.items.first().map(|account| account.id.clone())
        };
        Ok(summaries(&accounts))
    }

    pub fn select_account(&self, account_id: &str) -> AppResult<AccountSummary> {
        let mut accounts = self
            .accounts
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let index = accounts
            .items
            .iter()
            .position(|account| account.id == account_id)
            .ok_or(AppError::AccountNotFound)?;
        accounts.active_id = Some(account_id.to_owned());
        Ok(accounts.items[index].to_summary(true))
    }

    pub fn access_token_copy(&self) -> AppResult<Zeroizing<String>> {
        let accounts = self
            .accounts
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let token = accounts
            .active_id
            .as_deref()
            .and_then(|id| accounts.items.iter().find(|account| account.id == id))
            .map(|account| account.access_token.clone())
            .filter(|value| !value.is_empty())
            .ok_or(AppError::AccessTokenMissing)?;
        Ok(Zeroizing::new(token))
    }

    pub fn clear(&self) -> AppResult<()> {
        let mut accounts = self
            .accounts
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        accounts.active_id = None;
        accounts.items.clear();
        Ok(())
    }

    #[cfg(test)]
    pub fn has_credentials(&self) -> bool {
        !self.accounts.lock().unwrap().items.is_empty()
    }
}

fn summaries(accounts: &ManagedAccounts) -> Vec<AccountSummary> {
    accounts
        .items
        .iter()
        .map(|account| {
            account.to_summary(accounts.active_id.as_deref() == Some(account.id.as_str()))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clear_removes_credentials_from_state() {
        let state = AppState::new().unwrap();
        state
            .upsert_local_account(ManagedAccount {
                id: "local-cursor".to_owned(),
                email: "person@example.com".to_owned(),
                membership: Some("pro".to_owned()),
                signup_type: None,
                tags: Vec::new(),
                source: "cursor".to_owned(),
                access_token: "temporary-secret".to_owned(),
                has_refresh_token: false,
            })
            .unwrap();
        assert!(state.has_credentials());
        state.clear().unwrap();
        assert!(!state.has_credentials());
        assert!(matches!(
            state.access_token_copy(),
            Err(AppError::AccessTokenMissing)
        ));
    }

    #[test]
    fn replacing_cockpit_accounts_preserves_local_and_never_exposes_tokens() {
        let state = AppState::new().unwrap();
        state
            .upsert_local_account(ManagedAccount {
                id: "local-cursor".to_owned(),
                email: "local@example.com".to_owned(),
                membership: None,
                signup_type: None,
                tags: Vec::new(),
                source: "cursor".to_owned(),
                access_token: "local-secret".to_owned(),
                has_refresh_token: false,
            })
            .unwrap();
        let summaries = state
            .replace_cockpit_accounts(vec![ManagedAccount {
                id: "imported".to_owned(),
                email: "imported@example.com".to_owned(),
                membership: Some("pro".to_owned()),
                signup_type: Some("Auth_0".to_owned()),
                tags: vec!["标签".to_owned()],
                source: "cockpit-tools".to_owned(),
                access_token: "imported-secret".to_owned(),
                has_refresh_token: true,
            }])
            .unwrap();
        assert_eq!(summaries.len(), 2);
        let serialized = serde_json::to_string(&summaries).unwrap();
        assert!(!serialized.contains("local-secret"));
        assert!(!serialized.contains("imported-secret"));
    }
}
