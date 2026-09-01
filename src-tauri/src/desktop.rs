use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppResult,
    storage::{read_json_with_backup, write_json_atomic},
};

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CloseBehavior {
    #[default]
    Ask,
    MinimizeToTray,
    Exit,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(default, rename_all = "camelCase")]
pub struct DesktopSettings {
    pub schema_version: u32,
    pub close_behavior: CloseBehavior,
    pub start_minimized: bool,
    pub remember_window: bool,
    pub window_x: Option<i32>,
    pub window_y: Option<i32>,
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            close_behavior: CloseBehavior::Ask,
            start_minimized: false,
            remember_window: false,
            window_x: None,
            window_y: None,
            window_width: None,
            window_height: None,
        }
    }
}

pub struct DesktopSettingsStore {
    path: PathBuf,
}
impl DesktopSettingsStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("desktop_settings.json"),
        }
    }
    pub fn load(&self) -> DesktopSettings {
        self.load_for_ui().unwrap_or_default()
    }
    pub fn load_for_ui(&self) -> AppResult<DesktopSettings> {
        let backup = self
            .path
            .file_name()
            .and_then(|name| name.to_str())
            .map(|name| self.path.with_file_name(format!("{name}.bak")));
        if !self.path.exists() && backup.as_ref().map_or(true, |path| !path.exists()) {
            return Ok(DesktopSettings::default());
        }
        let value: DesktopSettings = read_json_with_backup(&self.path)?;
        if value.schema_version != 1 {
            return Err(crate::error::AppError::Storage(
                "桌面设置版本不受支持".to_owned(),
            ));
        }
        Ok(value)
    }
    pub fn save(&self, value: &DesktopSettings) -> AppResult<()> {
        write_json_atomic(&self.path, value, true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    #[test]
    fn close_behavior_defaults_to_ask_and_persists_explicit_choice() {
        let dir = tempdir().unwrap();
        let store = DesktopSettingsStore::new(dir.path());
        assert_eq!(store.load().close_behavior, CloseBehavior::Ask);
        let mut settings = store.load();
        settings.close_behavior = CloseBehavior::MinimizeToTray;
        store.save(&settings).unwrap();
        assert_eq!(store.load().close_behavior, CloseBehavior::MinimizeToTray);
    }

    #[test]
    fn corrupt_desktop_settings_recover_from_the_last_backup() {
        let dir = tempdir().unwrap();
        let store = DesktopSettingsStore::new(dir.path());
        let mut settings = store.load();
        settings.close_behavior = CloseBehavior::MinimizeToTray;
        store.save(&settings).unwrap();
        settings.close_behavior = CloseBehavior::Exit;
        store.save(&settings).unwrap();
        std::fs::write(dir.path().join("desktop_settings.json"), b"broken").unwrap();

        assert_eq!(store.load().close_behavior, CloseBehavior::MinimizeToTray);
    }

    #[test]
    fn corrupt_desktop_settings_without_backup_is_reported_to_the_ui() {
        let dir = tempdir().unwrap();
        let store = DesktopSettingsStore::new(dir.path());
        std::fs::write(dir.path().join("desktop_settings.json"), b"broken").unwrap();
        assert!(store.load_for_ui().is_err());
    }
}
