use std::{
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    storage::{read_json_with_backup, write_json_atomic},
};

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

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseHistoryItem {
    pub version: String,
    pub date: String,
    pub items: Vec<String>,
}

pub fn release_history(limit: Option<usize>) -> Vec<ReleaseHistoryItem> {
    parse_release_history(
        include_str!("../../CHANGELOG.md"),
        limit.unwrap_or(30).clamp(1, 100),
    )
}

fn parse_release_history(markdown: &str, limit: usize) -> Vec<ReleaseHistoryItem> {
    let mut releases = Vec::new();
    let mut current: Option<ReleaseHistoryItem> = None;
    for raw_line in markdown.lines() {
        let line = raw_line.trim();
        if let Some(header) = line.strip_prefix("## ") {
            if let Some(item) = current.take() {
                releases.push(item);
                if releases.len() >= limit {
                    return releases;
                }
            }
            let (version, date) = header
                .split_once(" - ")
                .map_or((header, ""), |(version, date)| (version, date));
            current = Some(ReleaseHistoryItem {
                version: version.trim().trim_start_matches('v').to_owned(),
                date: date.trim().to_owned(),
                items: Vec::new(),
            });
        } else if let Some(text) = line.strip_prefix("- ") {
            if let Some(item) = current.as_mut() {
                item.items.push(text.trim().to_owned());
            }
        }
    }
    if releases.len() < limit {
        if let Some(item) = current {
            releases.push(item);
        }
    }
    releases
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
        self.load_for_ui().unwrap_or_default()
    }
    pub fn load_for_ui(&self) -> AppResult<UpdateSettings> {
        let backup = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| self.path.with_file_name(format!("{name}.bak")));
        if !self.path.exists() && backup.as_ref().map_or(true, |path| !path.exists()) {
            return Ok(UpdateSettings::default());
        }
        let value: UpdateSettings = read_json_with_backup(&self.path)?;
        if value.schema_version != 1 {
            return Err(crate::error::AppError::Storage(
                "更新设置版本不受支持".to_owned(),
            ));
        }
        Ok(value)
    }
    pub fn save(&self, value: &UpdateSettings) -> AppResult<()> {
        write_json_atomic(&self.path, value, true)
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

    #[test]
    fn corrupt_update_settings_recover_from_the_last_backup() {
        let dir = tempdir().unwrap();
        let store = UpdateSettingsStore::new(dir.path());
        let mut settings = store.load();
        settings.skipped_version = "1.2.3".to_owned();
        store.save(&settings).unwrap();
        settings.skipped_version = "2.0.0".to_owned();
        store.save(&settings).unwrap();
        std::fs::write(dir.path().join("update_settings.json"), b"broken").unwrap();

        assert_eq!(store.load().skipped_version, "1.2.3");
    }

    #[test]
    fn corrupt_update_settings_without_backup_is_reported_to_the_ui() {
        let dir = tempdir().unwrap();
        let store = UpdateSettingsStore::new(dir.path());
        std::fs::write(dir.path().join("update_settings.json"), b"broken").unwrap();
        assert!(store.load_for_ui().is_err());
    }

    #[test]
    fn bundled_changelog_drives_release_history() {
        let items = release_history(Some(1));
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].version, "0.1.1");
        assert!(!items[0].items.is_empty());
    }
}
