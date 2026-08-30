use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct UpdateSettings {
    pub schema_version: u32,
    pub auto_check: bool,
    pub check_interval_hours: u32,
    pub auto_install: bool,
    pub remind_on_update: bool,
    pub last_check_time: i64,
    pub last_run_version: String,
    pub skipped_version: String,
    pub pending_notes: Option<PendingNotes>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PendingNotes {
    pub from_version: String,
    pub to_version: String,
    pub notes: String,
}

impl Default for UpdateSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            auto_check: true,
            check_interval_hours: 1,
            auto_install: false,
            remind_on_update: true,
            last_check_time: 0,
            last_run_version: String::new(),
            skipped_version: String::new(),
            pending_notes: None,
        }
    }
}

pub struct UpdateSettingsStore {
    path: PathBuf,
}
impl UpdateSettingsStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("update_settings.json"),
        }
    }
    pub fn load(&self) -> UpdateSettings {
        fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .filter(|value: &UpdateSettings| value.schema_version == 1)
            .unwrap_or_default()
    }
    pub fn save(&self, value: &UpdateSettings) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(storage_error)?;
        }
        fs::write(
            &self.path,
            serde_json::to_vec_pretty(value).map_err(storage_error)?,
        )
        .map_err(storage_error)
    }
    pub fn mark_checked(&self) -> AppResult<UpdateSettings> {
        let mut value = self.load();
        value.last_check_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64;
        self.save(&value)?;
        Ok(value)
    }

    pub fn prepare_install(
        &self,
        from_version: &str,
        to_version: &str,
        notes: &str,
    ) -> AppResult<()> {
        if !is_semver(from_version)
            || !is_semver(to_version)
            || !is_upgrade(to_version, from_version)
        {
            return Err(AppError::Storage("更新版本无效".to_owned()));
        }
        let mut value = self.load();
        value.pending_notes = Some(PendingNotes {
            from_version: from_version.to_owned(),
            to_version: to_version.to_owned(),
            notes: notes.to_owned(),
        });
        self.save(&value)
    }

    pub fn consume_version_change(&self, current_version: &str) -> AppResult<Option<PendingNotes>> {
        if !is_semver(current_version) {
            return Err(AppError::Storage("当前版本无效".to_owned()));
        }
        let mut value = self.load();
        if value.last_run_version.is_empty() {
            value.last_run_version = current_version.to_owned();
            self.save(&value)?;
            return Ok(None);
        }

        let upgraded = is_upgrade(current_version, &value.last_run_version);
        value.last_run_version = current_version.to_owned();
        let change = if upgraded {
            value
                .pending_notes
                .take()
                .filter(|pending| pending.to_version == current_version)
        } else {
            None
        };
        if !upgraded {
            value.pending_notes = None;
        }
        self.save(&value)?;
        Ok(change)
    }
}

fn is_semver(value: &str) -> bool {
    let core = value.split_once('-').map_or(value, |(core, _)| core);
    let mut parts = core.split('.');
    parts.clone().count() == 3 && parts.all(|part| !part.is_empty() && part.parse::<u64>().is_ok())
}

fn is_upgrade(candidate: &str, current: &str) -> bool {
    fn core(value: &str) -> Option<[u64; 3]> {
        let mut values = value
            .split_once('-')
            .map_or(value, |(head, _)| head)
            .split('.')
            .map(str::parse::<u64>);
        Some([
            values.next()?.ok()?,
            values.next()?.ok()?,
            values.next()?.ok()?,
        ])
    }
    matches!((core(candidate), core(current)), (Some(next), Some(previous)) if next > previous)
}
fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    #[test]
    fn defaults_are_safe_and_skip_is_exact() {
        let dir = tempdir().unwrap();
        let store = UpdateSettingsStore::new(dir.path());
        let mut value = store.load();
        assert!(value.auto_check);
        assert!(!value.auto_install);
        assert!(value.remind_on_update);
        assert_eq!(value.check_interval_hours, 1);
        value.skipped_version = "1.2.3".to_owned();
        store.save(&value).unwrap();
        assert_eq!(store.load().skipped_version, "1.2.3");
    }

    #[test]
    fn pending_notes_are_consumed_only_after_the_matching_upgrade() {
        let dir = tempdir().unwrap();
        let store = UpdateSettingsStore::new(dir.path());

        assert_eq!(store.consume_version_change("1.0.0").unwrap(), None);
        store
            .prepare_install("1.0.0", "1.1.0", "Fixed updater fallback")
            .unwrap();

        let change = store.consume_version_change("1.1.0").unwrap().unwrap();
        assert_eq!(change.from_version, "1.0.0");
        assert_eq!(change.to_version, "1.1.0");
        assert_eq!(change.notes, "Fixed updater fallback");
        assert_eq!(store.load().pending_notes, None);
        assert_eq!(store.consume_version_change("1.1.0").unwrap(), None);
    }
}
