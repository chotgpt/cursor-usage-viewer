use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

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
}

impl Default for DesktopSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            close_behavior: CloseBehavior::Ask,
            start_minimized: false,
            remember_window: false,
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
        fs::read(&self.path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .filter(|value: &DesktopSettings| value.schema_version == 1)
            .unwrap_or_default()
    }
    pub fn save(&self, value: &DesktopSettings) -> AppResult<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(storage_error)?;
        }
        let bytes = serde_json::to_vec_pretty(value).map_err(storage_error)?;
        fs::write(&self.path, bytes).map_err(storage_error)
    }
}
fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(error.to_string())
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
}
