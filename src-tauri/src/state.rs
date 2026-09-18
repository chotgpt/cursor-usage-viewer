use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
};

use zeroize::Zeroizing;

use crate::{
    cursor_oauth::CursorOAuthManager,
    cursor_runtime::{CursorRuntimeState, CursorRuntimeStore},
    cursor_settings::{CursorSettings, CursorSettingsStore},
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
    pub oauth: CursorOAuthManager,
    desktop: Mutex<DesktopSettingsStore>,
    updates: Mutex<UpdateSettingsStore>,
    last_saved_export: Mutex<Option<PathBuf>>,
    cursor_settings: Mutex<CursorSettingsStore>,
    cursor_runtime: Mutex<CursorRuntimeStore>,
    pub refresh_gate: tokio::sync::Mutex<()>,
    /// 与 `refresh_gate` 分离，确保切号编排的等待不会阻塞额度刷新，
    /// 同时两次切号也不会并发写入同一个 Cursor 数据库（D-033 计划 §4.1）。
    pub switch_gate: tokio::sync::Mutex<()>,
    scheduler_generation: AtomicU64,
    scheduler_stopped: AtomicBool,
}

impl AppState {
    pub fn new(data_dir: PathBuf) -> AppResult<Self> {
        let desktop = DesktopSettingsStore::new(&data_dir);
        let updates = UpdateSettingsStore::new(&data_dir);
        let cursor_settings = CursorSettingsStore::new(&data_dir);
        let cursor_runtime = CursorRuntimeStore::new(&data_dir);
        let store = AccountStore::new(data_dir);

        // D-033 §5：恢复上次主动读取/切换的账号标记，但不读取真实 Cursor 数据库
        // 来校准它；指向已删除账号的悬空引用在这里就地清理。
        let mut runtime = cursor_runtime.load().unwrap_or_default();
        let known_ids = store
            .list_views(None)
            .map(|views| {
                views
                    .into_iter()
                    .map(|view| view.id)
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        if runtime.prune_unknown_accounts(|id| known_ids.iter().any(|known| known == id)) {
            let _ = cursor_runtime.save(&runtime);
        }

        Ok(Self {
            store: Mutex::new(store),
            current_id: Mutex::new(runtime.current_account_id.clone()),
            provider: CursorUsageProvider::new()?,
            oauth: CursorOAuthManager::new()?,
            desktop: Mutex::new(desktop),
            updates: Mutex::new(updates),
            last_saved_export: Mutex::new(None),
            cursor_settings: Mutex::new(cursor_settings),
            cursor_runtime: Mutex::new(cursor_runtime),
            refresh_gate: tokio::sync::Mutex::new(()),
            switch_gate: tokio::sync::Mutex::new(()),
            scheduler_generation: AtomicU64::new(0),
            scheduler_stopped: AtomicBool::new(false),
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
        // The store may merge the incoming record into an existing primary with a
        // different id (same auth identity or email), so the persisted id is the
        // one it returns, not the one the caller generated.
        let id = self
            .store
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .upsert(account)?
            .id;
        if mark_current {
            *self
                .current_id
                .lock()
                .map_err(|_| AppError::StateUnavailable)? = Some(id.clone());
            self.patch_runtime(|runtime| runtime.current_account_id = Some(id.clone()))?;
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
        drop(current);
        self.patch_runtime(|runtime| {
            runtime.prune_unknown_accounts(|id| id != account_id);
        })?;
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
        drop(current);
        self.patch_runtime(|runtime| {
            runtime.prune_unknown_accounts(|id| !account_ids.iter().any(|deleted| deleted == id));
        })?;
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

    pub fn cursor_settings(&self) -> AppResult<CursorSettings> {
        self.cursor_settings
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .load()
    }

    /// 只写入自动刷新间隔。切号启动路径由 `set_cursor_app_path` 单独维护，
    /// 因此设置页提交的旧快照不会把路径清空（D-033 计划 §2.1）。
    pub fn save_cursor_settings(&self, settings: &CursorSettings) -> AppResult<CursorSettings> {
        settings.validate()?;
        let minutes = settings.auto_refresh_minutes;
        let saved = self
            .cursor_settings
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .patch(|current| current.auto_refresh_minutes = minutes)?;
        self.scheduler_generation.fetch_add(1, Ordering::SeqCst);
        Ok(saved)
    }

    pub fn cursor_app_path(&self) -> AppResult<Option<String>> {
        Ok(self.cursor_settings()?.cursor_app_path)
    }

    pub fn set_cursor_app_path(&self, path: Option<String>) -> AppResult<Option<String>> {
        let normalized = path
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let saved = self
            .cursor_settings
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .patch(|current| current.cursor_app_path = normalized)?;
        Ok(saved.cursor_app_path)
    }

    pub fn cursor_runtime(&self) -> AppResult<CursorRuntimeState> {
        self.cursor_runtime
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .load()
    }

    fn patch_runtime<F>(&self, apply: F) -> AppResult<CursorRuntimeState>
    where
        F: FnOnce(&mut CursorRuntimeState),
    {
        self.cursor_runtime
            .lock()
            .map_err(|_| AppError::StateUnavailable)?
            .patch(apply)
    }

    /// 首次注入成功后调用：同时落盘“当前账号”和默认实例绑定，即使后续缺路径、
    /// 关闭失败或启动失败也保留这份部分成功状态（D-033 §6）。
    pub fn mark_switched(&self, account_id: &str) -> AppResult<()> {
        *self
            .current_id
            .lock()
            .map_err(|_| AppError::StateUnavailable)? = Some(account_id.to_owned());
        self.patch_runtime(|runtime| {
            runtime.current_account_id = Some(account_id.to_owned());
            runtime.default_bind_account_id = Some(account_id.to_owned());
        })?;
        Ok(())
    }

    pub fn set_last_cursor_pid(&self, pid: Option<u32>) -> AppResult<()> {
        self.patch_runtime(|runtime| runtime.last_pid = pid)?;
        Ok(())
    }

    pub fn scheduler_generation(&self) -> u64 {
        self.scheduler_generation.load(Ordering::SeqCst)
    }

    pub fn stop_scheduler(&self) {
        self.scheduler_stopped.store(true, Ordering::SeqCst);
    }

    pub fn scheduler_stopped(&self) -> bool {
        self.scheduler_stopped.load(Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// D-033 §5 取代了原先“重启后丢弃当前标记”的契约：上次主动读取或切换的
    /// 账号必须持久化，且恢复时不得读取真实 Cursor 数据库来校准。
    #[test]
    fn restart_restores_the_persisted_current_account_marker() {
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
        let views = reopened.list().unwrap();
        assert_eq!(views.len(), 1);
        assert!(views[0].is_current);
        assert_eq!(
            reopened.cursor_runtime().unwrap().current_account_id,
            Some("one".to_owned())
        );
    }

    #[test]
    fn switching_persists_current_and_default_binding_across_restarts() {
        let directory = tempdir().unwrap();
        let state = AppState::new(directory.path().to_path_buf()).unwrap();
        state
            .upsert(
                CursorAccountRecord::fake_for_test("one", "one@example.invalid", "a.b.c"),
                false,
            )
            .unwrap();
        state.mark_switched("one").unwrap();
        state.set_last_cursor_pid(Some(321)).unwrap();

        let reopened = AppState::new(directory.path().to_path_buf()).unwrap();
        let runtime = reopened.cursor_runtime().unwrap();
        assert_eq!(runtime.current_account_id.as_deref(), Some("one"));
        assert_eq!(runtime.default_bind_account_id.as_deref(), Some("one"));
        assert_eq!(runtime.last_pid, Some(321));
        assert!(reopened.list().unwrap()[0].is_current);
    }

    #[test]
    fn deleting_the_switched_account_clears_current_and_binding() {
        let directory = tempdir().unwrap();
        let state = AppState::new(directory.path().to_path_buf()).unwrap();
        state
            .upsert(
                CursorAccountRecord::fake_for_test("one", "one@example.invalid", "a.b.c"),
                false,
            )
            .unwrap();
        state.mark_switched("one").unwrap();
        state.delete("one").unwrap();

        let runtime = state.cursor_runtime().unwrap();
        assert_eq!(runtime.current_account_id, None);
        assert_eq!(runtime.default_bind_account_id, None);
        assert_eq!(
            AppState::new(directory.path().to_path_buf())
                .unwrap()
                .cursor_runtime()
                .unwrap()
                .current_account_id,
            None
        );
    }

    #[test]
    fn a_dangling_persisted_current_account_is_dropped_on_startup() {
        let directory = tempdir().unwrap();
        let state = AppState::new(directory.path().to_path_buf()).unwrap();
        state.mark_switched("never-stored").unwrap();

        let reopened = AppState::new(directory.path().to_path_buf()).unwrap();
        assert_eq!(reopened.cursor_runtime().unwrap().current_account_id, None);
    }

    #[test]
    fn saving_auto_refresh_settings_keeps_the_configured_launch_path() {
        let directory = tempdir().unwrap();
        let state = AppState::new(directory.path().to_path_buf()).unwrap();
        state
            .set_cursor_app_path(Some("  /fake/Cursor  ".to_owned()))
            .unwrap();
        state
            .save_cursor_settings(&CursorSettings {
                auto_refresh_minutes: 15,
                ..CursorSettings::default()
            })
            .unwrap();

        let settings = state.cursor_settings().unwrap();
        assert_eq!(settings.auto_refresh_minutes, 15);
        assert_eq!(settings.cursor_app_path.as_deref(), Some("/fake/Cursor"));
        assert_eq!(
            state.set_cursor_app_path(Some("   ".to_owned())).unwrap(),
            None
        );
    }

    #[test]
    fn upserting_a_duplicate_identity_under_a_new_id_returns_the_merged_primary() {
        let directory = tempdir().unwrap();
        let state = AppState::new(directory.path().to_path_buf()).unwrap();
        let mut existing =
            CursorAccountRecord::fake_for_test("cursor_web", "same@example.invalid", "a.b.c");
        existing.auth_id = Some("auth0|user_same".to_owned());
        state.upsert(existing, false).unwrap();

        // Local import always uses the fixed id and a different token; web login
        // derives its id from the token hash. Both collide with the stored copy
        // of the same account only through the auth identity.
        let mut local =
            CursorAccountRecord::fake_for_test("local-cursor", "same@example.invalid", "d.e.f");
        local.auth_id = Some("auth0|user_same".to_owned());
        let view = state.upsert(local, true).unwrap();

        assert_eq!(view.id, "cursor_web");
        assert!(view.is_current);
        let views = state.list().unwrap();
        assert_eq!(views.len(), 1);
        assert!(views[0].is_current);
        assert_eq!(state.active_record().unwrap().id, "cursor_web");
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

    #[test]
    fn cursor_refresh_settings_reschedule_and_stop_are_runtime_safe() {
        let directory = tempdir().unwrap();
        let state = AppState::new(directory.path().to_path_buf()).unwrap();
        let initial_generation = state.scheduler_generation();
        state
            .save_cursor_settings(&CursorSettings {
                auto_refresh_minutes: -1,
                ..CursorSettings::default()
            })
            .unwrap();
        assert_eq!(state.scheduler_generation(), initial_generation + 1);
        assert!(!state.scheduler_stopped());
        state.stop_scheduler();
        assert!(state.scheduler_stopped());
    }
}
