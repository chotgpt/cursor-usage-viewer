use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

use zeroize::Zeroizing;

use crate::{
    desktop::{CloseBehavior, DesktopSettings, DesktopSettingsStore},
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
    desktop: Mutex<DesktopSettingsStore>,
    updates: Mutex<UpdateSettingsStore>,
    last_saved_export: Mutex<Option<PathBuf>>,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> AppResult<Self> {
        let desktop = DesktopSettingsStore::new(&data_dir);
        let updates = UpdateSettingsStore::new(&data_dir);
        Ok(Self {
            store: Mutex::new(AccountStore::new(data_dir)),
            current_id: Mutex::new(None),
            provider: CursorUsageProvider::new()?,
            desktop: Mutex::new(desktop),
            updates: Mutex::new(updates),
            last_saved_export: Mutex::new(None),
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

    pub fn delete_many(&self, account_ids: &[String]) -> AppResult<()> {
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .delete_many(account_ids)?;
        let mut current = self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        if current
            .as_ref()
            .is_some_and(|current_id| account_ids.iter().any(|id| id == current_id))
        {
            *current = None;
        }
        Ok(())
    }

    pub fn update_tags(&self, account_id: &str, tags: Vec<String>) -> AppResult<CursorAccountView> {
        let current = self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .clone();
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .update_tags(account_id, tags, current.as_deref())
    }

    pub fn export_json(&self, account_ids: &[String]) -> AppResult<Zeroizing<String>> {
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .export_json(account_ids)
            .map(Zeroizing::new)
    }

    pub fn remember_saved_export(&self, path: PathBuf) -> AppResult<()> {
        *self
            .last_saved_export
            .lock()
            .map_err(|_| AppError::StateUnavailable)? = Some(path);
        Ok(())
    }

    pub fn authorize_saved_export(&self, path: &Path) -> AppResult<PathBuf> {
        let saved = self
            .last_saved_export
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        if saved.as_deref() != Some(path) {
            return Err(AppError::Storage(
                "只能打开最近一次成功保存的导出文件位置".to_owned(),
            ));
        }
        Ok(path.to_path_buf())
    }

    pub fn persist(&self, account: CursorAccountRecord) -> AppResult<CursorAccountView> {
        let current = self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .clone();
        let account_id = account.id.clone();
        self.store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .persist_refreshed(account)?;
        Ok(self
            .store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .get(&account_id)?
            .view(current.as_deref()))
    }

    pub fn close_behavior(&self) -> CloseBehavior {
        self.desktop
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .load()
            .close_behavior
    }

    pub fn set_close_behavior(&self, behavior: CloseBehavior) -> AppResult<()> {
        let desktop = self
            .desktop
            .lock()
            .map_err(|_| AppError::StateUnavailable)?;
        let mut settings = desktop.load();
        settings.close_behavior = behavior;
        desktop.save(&settings)
    }
    pub fn desktop_settings(&self) -> DesktopSettings {
        self.desktop
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .load()
    }
    pub fn desktop_settings_for_ui(&self) -> AppResult<DesktopSettings> {
        self.desktop
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .load_for_ui()
    }
    pub fn save_desktop_settings(&self, settings: &DesktopSettings) -> AppResult<()> {
        self.desktop
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .save(settings)
    }

    pub fn update_settings_for_ui(&self) -> AppResult<UpdateSettings> {
        self.updates
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .load_for_ui()
    }
    pub fn save_update_settings(&self, settings: &UpdateSettings) -> AppResult<()> {
        self.updates
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .save(settings)
    }
    pub fn mark_update_checked(&self) -> AppResult<UpdateSettings> {
        self.updates
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .mark_checked()
    }
    pub fn prepare_update_install(
        &self,
        from_version: &str,
        to_version: &str,
        notes: &str,
    ) -> AppResult<()> {
        self.updates
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .prepare_install(from_version, to_version, notes)
    }
    pub fn consume_version_change(&self, current_version: &str) -> AppResult<Option<PendingNotes>> {
        self.updates
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .consume_version_change(current_version)
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

    #[test]
    fn reveal_is_limited_to_the_last_successful_export_path() {
        let directory = tempdir().unwrap();
        let state = AppState::new(directory.path().to_path_buf()).unwrap();
        let saved = directory.path().join("saved.json");
        let other = directory.path().join("other.json");

        state.remember_saved_export(saved.clone()).unwrap();

        assert_eq!(state.authorize_saved_export(&saved).unwrap(), saved);
        assert!(state.authorize_saved_export(&other).is_err());
    }
}
