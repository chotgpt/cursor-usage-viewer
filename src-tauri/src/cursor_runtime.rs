use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::{
    error::AppResult,
    storage::{read_json_with_backup, write_json_atomic},
};

pub const CURSOR_RUNTIME_SCHEMA_VERSION: u32 = 1;

/// Play 一键切号需要跨重启记住的最小运行时状态（D-033 §5）。
///
/// `current_account_id` 是“上次由本应用主动读取或切换的账号”，重启后继续显示；
/// 应用不会为了校准它而在启动时自动读取真实 `state.vscdb`。`last_pid` 只是加速
/// 匹配的提示，使用前必须重新验证进程，绝不能作为直接终止依据。
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct CursorRuntimeState {
    pub schema_version: u32,
    pub current_account_id: Option<String>,
    pub default_bind_account_id: Option<String>,
    pub last_pid: Option<u32>,
}

impl Default for CursorRuntimeState {
    fn default() -> Self {
        Self {
            schema_version: CURSOR_RUNTIME_SCHEMA_VERSION,
            current_account_id: None,
            default_bind_account_id: None,
            last_pid: None,
        }
    }
}

impl CursorRuntimeState {
    /// 丢弃指向已不存在账号的悬空引用，返回是否发生了修改。
    pub fn prune_unknown_accounts<F>(&mut self, exists: F) -> bool
    where
        F: Fn(&str) -> bool,
    {
        let mut changed = false;
        if self
            .current_account_id
            .as_deref()
            .is_some_and(|id| !exists(id))
        {
            self.current_account_id = None;
            changed = true;
        }
        if self
            .default_bind_account_id
            .as_deref()
            .is_some_and(|id| !exists(id))
        {
            self.default_bind_account_id = None;
            changed = true;
        }
        changed
    }
}

pub struct CursorRuntimeStore {
    path: PathBuf,
}

impl CursorRuntimeStore {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join("cursor_runtime.json"),
        }
    }

    pub fn load(&self) -> AppResult<CursorRuntimeState> {
        let backup = self.path.with_file_name("cursor_runtime.json.bak");
        if !self.path.exists() && !backup.exists() {
            return Ok(CursorRuntimeState::default());
        }
        read_json_with_backup(&self.path)
    }

    pub fn save(&self, state: &CursorRuntimeState) -> AppResult<()> {
        write_json_atomic(&self.path, state, true)
    }

    /// 读取、就地修改并写回，避免切号编排的不同阶段用旧快照互相覆盖。
    pub fn patch<F>(&self, apply: F) -> AppResult<CursorRuntimeState>
    where
        F: FnOnce(&mut CursorRuntimeState),
    {
        let mut state = self.load().unwrap_or_default();
        apply(&mut state);
        self.save(&state)?;
        Ok(state)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn missing_file_starts_from_an_empty_runtime_state() {
        let dir = tempdir().unwrap();
        assert_eq!(
            CursorRuntimeStore::new(dir.path()).load().unwrap(),
            CursorRuntimeState::default()
        );
    }

    #[test]
    fn current_and_binding_survive_a_reload() {
        let dir = tempdir().unwrap();
        let store = CursorRuntimeStore::new(dir.path());
        store
            .patch(|state| {
                state.current_account_id = Some("one".to_owned());
                state.default_bind_account_id = Some("one".to_owned());
            })
            .unwrap();
        store.patch(|state| state.last_pid = Some(4242)).unwrap();

        let reloaded = CursorRuntimeStore::new(dir.path()).load().unwrap();
        assert_eq!(reloaded.current_account_id.as_deref(), Some("one"));
        assert_eq!(reloaded.default_bind_account_id.as_deref(), Some("one"));
        assert_eq!(reloaded.last_pid, Some(4242));
    }

    #[test]
    fn corrupt_primary_recovers_the_last_backup() {
        let dir = tempdir().unwrap();
        let store = CursorRuntimeStore::new(dir.path());
        store
            .patch(|state| state.current_account_id = Some("first".to_owned()))
            .unwrap();
        store
            .patch(|state| state.current_account_id = Some("second".to_owned()))
            .unwrap();
        std::fs::write(dir.path().join("cursor_runtime.json"), b"broken").unwrap();

        assert_eq!(
            store.load().unwrap().current_account_id.as_deref(),
            Some("first")
        );
    }

    #[test]
    fn dangling_account_references_are_pruned_without_touching_the_pid() {
        let mut state = CursorRuntimeState {
            current_account_id: Some("gone".to_owned()),
            default_bind_account_id: Some("kept".to_owned()),
            last_pid: Some(11),
            ..CursorRuntimeState::default()
        };
        assert!(state.prune_unknown_accounts(|id| id == "kept"));
        assert_eq!(state.current_account_id, None);
        assert_eq!(state.default_bind_account_id.as_deref(), Some("kept"));
        assert_eq!(state.last_pid, Some(11));
        assert!(!state.prune_unknown_accounts(|id| id == "kept"));
    }
}
