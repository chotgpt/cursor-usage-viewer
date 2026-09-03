use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    error::{AppError, AppResult},
    storage::{read_json_with_backup, write_json_atomic},
};

pub const CURSOR_SETTINGS_SCHEMA_VERSION: u32 = 1;
pub const DEFAULT_AUTO_REFRESH_MINUTES: i32 = 10;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct CursorSettings {
    pub schema_version: u32,
    pub auto_refresh_minutes: i32,
}

impl Default for CursorSettings {
    fn default() -> Self {
        Self {
            schema_version: CURSOR_SETTINGS_SCHEMA_VERSION,
            auto_refresh_minutes: DEFAULT_AUTO_REFRESH_MINUTES,
        }
    }
}

impl CursorSettings {
    pub fn validate(&self) -> AppResult<()> {
        if self.schema_version != CURSOR_SETTINGS_SCHEMA_VERSION {
            return Err(AppError::Storage("Cursor 设置版本不受支持".to_owned()));
        }
        if self.auto_refresh_minutes == -1 || self.auto_refresh_minutes >= 2 {
            Ok(())
        } else {
            Err(AppError::Storage(
                "自动刷新间隔必须为关闭（-1）或至少 2 分钟".to_owned(),
            ))
        }
    }
}

pub struct CursorSettingsStore {
    path: PathBuf,
}

impl CursorSettingsStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("cursor_settings.json"),
        }
    }

    pub fn load(&self) -> AppResult<CursorSettings> {
        let backup = self.path.with_file_name("cursor_settings.json.bak");
        if !self.path.exists() && !backup.exists() {
            return Ok(CursorSettings::default());
        }
        let settings: CursorSettings = read_json_with_backup(&self.path)?;
        settings.validate()?;
        Ok(settings)
    }

    pub fn save(&self, settings: &CursorSettings) -> AppResult<()> {
        settings.validate()?;
        write_json_atomic(&self.path, settings, true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn defaults_to_ten_minutes_and_persists_disabled_state() {
        let dir = tempdir().unwrap();
        let store = CursorSettingsStore::new(dir.path());
        assert_eq!(store.load().unwrap().auto_refresh_minutes, 10);
        let settings = CursorSettings {
            auto_refresh_minutes: -1,
            ..CursorSettings::default()
        };
        store.save(&settings).unwrap();
        assert_eq!(store.load().unwrap(), settings);
    }

    #[test]
    fn rejects_zero_one_and_unknown_schema() {
        for minutes in [0, 1] {
            let settings = CursorSettings {
                auto_refresh_minutes: minutes,
                ..CursorSettings::default()
            };
            assert!(settings.validate().is_err());
        }
        let settings = CursorSettings {
            schema_version: 2,
            ..CursorSettings::default()
        };
        assert!(settings.validate().is_err());
    }

    #[test]
    fn corrupt_primary_recovers_the_last_backup() {
        let dir = tempdir().unwrap();
        let store = CursorSettingsStore::new(dir.path());
        let first = CursorSettings {
            auto_refresh_minutes: 5,
            ..CursorSettings::default()
        };
        store.save(&first).unwrap();
        store
            .save(&CursorSettings {
                auto_refresh_minutes: 15,
                ..CursorSettings::default()
            })
            .unwrap();
        std::fs::write(dir.path().join("cursor_settings.json"), b"broken").unwrap();
        assert_eq!(store.load().unwrap(), first);
    }
}
