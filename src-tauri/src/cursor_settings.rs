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
    /// Play 一键切号使用的默认 Cursor 启动路径（D-033）。这是一个可选字段，
    /// 旧的 `cursor_settings.json` 反序列化为 `None`，因此不升级 schema 版本。
    pub cursor_app_path: Option<String>,
}

impl Default for CursorSettings {
    fn default() -> Self {
        Self {
            schema_version: CURSOR_SETTINGS_SCHEMA_VERSION,
            auto_refresh_minutes: DEFAULT_AUTO_REFRESH_MINUTES,
            cursor_app_path: None,
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

    /// 读取、就地修改并写回单个字段，避免自动刷新设置与切号路径弹层用各自持有
    /// 的旧完整对象互相覆盖（D-033 计划 §2.1）。
    pub fn patch<F>(&self, apply: F) -> AppResult<CursorSettings>
    where
        F: FnOnce(&mut CursorSettings),
    {
        let mut settings = self.load()?;
        apply(&mut settings);
        self.save(&settings)?;
        Ok(settings)
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
    fn existing_settings_without_a_launch_path_stay_readable() {
        let dir = tempdir().unwrap();
        std::fs::write(
            dir.path().join("cursor_settings.json"),
            br#"{"schemaVersion":1,"autoRefreshMinutes":5}"#,
        )
        .unwrap();
        let loaded = CursorSettingsStore::new(dir.path()).load().unwrap();
        assert_eq!(loaded.auto_refresh_minutes, 5);
        assert_eq!(loaded.cursor_app_path, None);
    }

    #[test]
    fn patching_one_field_keeps_the_other_surface_intact() {
        let dir = tempdir().unwrap();
        let store = CursorSettingsStore::new(dir.path());
        store
            .patch(|settings| settings.cursor_app_path = Some("/fake/Cursor".to_owned()))
            .unwrap();
        store
            .patch(|settings| settings.auto_refresh_minutes = 15)
            .unwrap();

        let loaded = store.load().unwrap();
        assert_eq!(loaded.auto_refresh_minutes, 15);
        assert_eq!(loaded.cursor_app_path.as_deref(), Some("/fake/Cursor"));

        store
            .patch(|settings| settings.cursor_app_path = Some("/fake/Cursor2".to_owned()))
            .unwrap();
        let loaded = store.load().unwrap();
        assert_eq!(loaded.auto_refresh_minutes, 15);
        assert_eq!(loaded.cursor_app_path.as_deref(), Some("/fake/Cursor2"));
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
