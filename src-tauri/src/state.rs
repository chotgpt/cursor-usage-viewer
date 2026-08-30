use std::{path::PathBuf, sync::Mutex};

use zeroize::Zeroizing;

use crate::{
    desktop::{CloseBehavior, DesktopSettingsStore},
    error::{AppError, AppResult},
    model::{CursorAccountRecord, CursorAccountView},
    provider::CursorUsageProvider,
    storage::AccountStore,
    updater::{PendingNotes, UpdateSettings, UpdateSettingsStore},
};

pub struct AppState {
    store: Mutex<AccountStore>,
    current_id: Mutex<Option<String>>,
    pub provider: CursorUsageProvider,
    desktop: DesktopSettingsStore,
    updates: UpdateSettingsStore,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> AppResult<Self> {
        let desktop = DesktopSettingsStore::new(&data_dir);
        let updates = UpdateSettingsStore::new(&data_dir);
        Ok(Self {
            store: Mutex::new(AccountStore::new(data_dir)),
            current_id: Mutex::new(None),
            provider: CursorUsageProvider::new()?,
            desktop,
            updates,
        })
    }

    pub fn list(&self) -> AppResult<Vec<CursorAccountView>> {
        let current = self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .clone();
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .list_views(current.as_deref())
    }

    pub fn upsert(
        &self,
        account: CursorAccountRecord,
        mark_current: bool,
    ) -> AppResult<CursorAccountView> {
        let id = account.id.clone();
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .upsert(account)?;
        if mark_current {
            *self
                .current_id
                .lock()
                .map_err(|_| AppError::StateUnavailable)? = Some(id.clone());
        }
        let current = self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .clone();
        Ok(self
            .store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .get(&id)?
            .view(current.as_deref()))
    }

    pub fn import(&self, records: Vec<CursorAccountRecord>) -> AppResult<Vec<CursorAccountView>> {
        for record in records {
            self.upsert(record, false)?;
        }
        self.list()
    }

    pub fn select(&self, account_id: &str) -> AppResult<CursorAccountView> {
        let store = self.store.lock().map_err(|_| AppError::StateUnavailable)?;
        let account = store
            .get(account_id)
            .map_err(|_| AppError::AccountNotFound)?;
        *self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)? = Some(account_id.to_owned());
        Ok(account.view(Some(account_id)))
    }

    pub fn record(&self, account_id: &str) -> AppResult<CursorAccountRecord> {
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .get(account_id)
    }

    pub fn active_record(&self) -> AppResult<CursorAccountRecord> {
        let id = self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .clone()
            .ok_or(AppError::AccountNotFound)?;
        self.record(&id)
    }

    pub fn delete(&self, account_id: &str) -> AppResult<()> {
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .delete(account_id)?;
        let mut current = self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        if current.as_deref() == Some(account_id) {
            *current = None;
        }
        Ok(())
    }

    pub fn export_json(&self, account_ids: &[String]) -> AppResult<Zeroizing<String>> {
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .export_json(account_ids)
            .map(Zeroizing::new)
    }

    pub fn persist(&self, account: CursorAccountRecord) -> AppResult<CursorAccountView> {
        self.upsert(account, false)
    }

    pub fn close_behavior(&self) -> CloseBehavior {
        self.desktop.load().close_behavior
    }

    pub fn set_close_behavior(&self, behavior: CloseBehavior) -> AppResult<()> {
        let mut settings = self.desktop.load();
        settings.close_behavior = behavior;
        self.desktop.save(&settings)
    }

    pub fn update_settings(&self) -> UpdateSettings {
        self.updates.load()
    }
    pub fn save_update_settings(&self, settings: &UpdateSettings) -> AppResult<()> {
        self.updates.save(settings)
    }
    pub fn mark_update_checked(&self) -> AppResult<UpdateSettings> {
        self.updates.mark_checked()
    }
    pub fn prepare_update_install(
        &self,
        from_version: &str,
        to_version: &str,
        notes: &str,
    ) -> AppResult<()> {
        self.updates
            .prepare_install(from_version, to_version, notes)
    }
    pub fn consume_version_change(&self, current_version: &str) -> AppResult<Option<PendingNotes>> {
        self.updates.consume_version_change(current_version)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn restart_restores_accounts_but_not_runtime_current_marker() {
        let directory = tempdir().unwrap();
        let state = AppState::new(directory.path().to_path_buf()).unwrap();
        state
            .upsert(
                CursorAccountRecord::fake_for_test("one", "one@example.invalid", "a.b.c"),
                true,
            )
            .unwrap();
        assert!(state.list().unwrap()[0].is_current);
        let reopened = AppState::new(directory.path().to_path_buf()).unwrap();
        assert_eq!(reopened.list().unwrap().len(), 1);
        assert!(!reopened.list().unwrap()[0].is_current);
    }
}
