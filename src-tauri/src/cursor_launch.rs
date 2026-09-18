//! 默认 Cursor 实例的路径解析、进程匹配、关闭与启动（D-033 计划 §4）。
//!
//! 仓库原本没有任何外部应用进程层，因此这里新增一个窄接口：平台命令构造和进程
//! 匹配都是纯函数，可以在任意宿主上覆盖三平台；真实的枚举、终止、等待和 spawn
//! 只通过 [`CursorProcessOps`] 与 [`Clock`] 注入，单元测试永远不会枚举、终止或
//! 启动真实进程，也不会真实等待。
//!
//! 只处理默认 `--user-data-dir`；不移植 Cockpit 的通用 Provider/多开进程框架。

use std::{
    collections::HashSet,
    ffi::OsString,
    path::{Path, PathBuf},
    time::Duration,
};

pub const CLOSE_TIMEOUT_MILLIS: u64 = 20_000;
pub const START_VERIFY_TIMEOUT_MILLIS: u64 = 6_000;
pub const WINDOWS_CANDIDATE_SCAN_TIMEOUT_MILLIS: u64 = 2_000;
pub const MAX_ELEVATION_TARGETS: usize = 32;

const POLL_INTERVAL_MILLIS: u64 = 120;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[allow(dead_code)]
pub enum Platform {
    Windows,
    MacOs,
    Linux,
}

impl Platform {
    pub const fn current() -> Self {
        #[cfg(target_os = "windows")]
        {
            Self::Windows
        }
        #[cfg(target_os = "macos")]
        {
            Self::MacOs
        }
        #[cfg(target_os = "linux")]
        {
            Self::Linux
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LaunchError {
    /// 启动路径缺失或未通过验证：软失败，由路径弹层恢复后只重试启动。
    PathMissing,
    /// 关闭默认实例失败：硬失败，但不回滚已完成的注入和绑定。
    CloseFailed(String),
    /// 已验证路径但 spawn 失败：软失败，保留写入与绑定。
    SpawnFailed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CloseFailure {
    pub remaining: Vec<u32>,
    pub last_reason: Option<String>,
}

impl std::fmt::Display for LaunchError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::PathMissing => write!(formatter, "未配置可用的 Cursor 启动路径"),
            Self::CloseFailed(reason) => write!(formatter, "{reason}"),
            Self::SpawnFailed(reason) => write!(formatter, "启动 Cursor 失败：{reason}"),
        }
    }
}

/// 一次进程快照里的原始条目。真实实现由 sysinfo 填充，测试由 fake 构造。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RawProcess {
    pub pid: u32,
    pub name: String,
    pub executable: Option<String>,
    pub args: Vec<String>,
}

/// 已经过 helper 排除和启动路径硬匹配的 Cursor 主进程。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessEntry {
    pub pid: u32,
    pub user_data_dir: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchPlan {
    pub program: PathBuf,
    pub args: Vec<String>,
    pub removed_env: Vec<&'static str>,
    pub hide_window: bool,
}

pub trait Clock {
    fn elapsed_millis(&self) -> u64;
    fn sleep_millis(&self, millis: u64);
}

pub trait CursorProcessOps {
    fn snapshot(&self) -> Vec<RawProcess>;
    fn is_running(&self, pid: u32) -> bool;
    fn terminate(&self, pid: u32) -> Result<(), String>;
    fn spawn(&self, plan: &LaunchPlan) -> Result<u32, String>;
    #[allow(dead_code)]
    fn path_exists(&self, path: &Path) -> bool;
}

// ── 路径 ────────────────────────────────────────────────────────────────────

/// 默认数据目录。数据库路径仍由 `cursor_db::default_cursor_database_path`
/// 作为唯一真源，这里只负责 `--user-data-dir` 需要的目录本身。
pub fn default_user_data_dir_for(
    platform: Platform,
    appdata: Option<&Path>,
    home: Option<&Path>,
) -> Option<PathBuf> {
    match platform {
        Platform::Windows => appdata.map(|base| base.join("Cursor")),
        Platform::MacOs => home.map(|base| base.join("Library/Application Support/Cursor")),
        Platform::Linux => home.map(|base| base.join(".config/Cursor")),
    }
}

pub fn default_user_data_dir() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let home = std::env::var_os("HOME").map(PathBuf::from);
    default_user_data_dir_for(Platform::current(), appdata.as_deref(), home.as_deref())
}

pub fn normalize_path_for_compare(platform: Platform, raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return String::new();
    }
    let resolved = std::fs::canonicalize(trimmed)
        .map(|path| strip_extended_prefix(&path.to_string_lossy()))
        .unwrap_or_else(|_| trimmed.to_owned());
    match platform {
        Platform::Windows => resolved.replace('/', "\\").to_lowercase(),
        _ => resolved,
    }
}

fn strip_extended_prefix(value: &str) -> String {
    if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{rest}");
    }
    value
        .strip_prefix(r"\\?\")
        .map(str::to_owned)
        .unwrap_or_else(|| value.to_owned())
}

pub fn path_looks_like_cursor(path: &Path) -> bool {
    path.to_string_lossy().to_lowercase().contains("cursor")
}

/// macOS 同时接受 `.app` 根与其 `Contents/MacOS` 可执行文件并规范化到可执行文件。
pub fn resolve_executable(
    platform: Platform,
    candidate: &Path,
    exists: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if platform == Platform::MacOs {
        let text = candidate.to_string_lossy().to_string();
        if let Some(index) = text.to_lowercase().find(".app") {
            let root = PathBuf::from(&text[..index + 4]);
            for binary in ["Cursor", "Electron"] {
                let executable = root.join("Contents").join("MacOS").join(binary);
                if exists(&executable) {
                    return Some(executable);
                }
            }
            return None;
        }
    }
    exists(candidate).then(|| candidate.to_path_buf())
}

/// 保存前的验证：目标必须存在且确为 Cursor，拒绝任意命令、参数和非 Cursor 目标。
pub fn validate_launch_path(
    platform: Platform,
    candidate: &str,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<PathBuf, LaunchError> {
    let trimmed = candidate.trim().trim_matches('"');
    if trimmed.is_empty() || trimmed.contains('\n') {
        return Err(LaunchError::PathMissing);
    }
    let path = PathBuf::from(trimmed);
    if !is_absolute_for(platform, trimmed) {
        return Err(LaunchError::PathMissing);
    }
    let executable = resolve_executable(platform, &path, exists).ok_or(LaunchError::PathMissing)?;
    if !path_looks_like_cursor(&executable) {
        return Err(LaunchError::PathMissing);
    }
    Ok(executable)
}

fn is_absolute_for(platform: Platform, value: &str) -> bool {
    match platform {
        Platform::Windows => Path::new(value).is_absolute(),
        Platform::MacOs | Platform::Linux => value.starts_with('/'),
    }
}

/// 与 Cockpit 固定提交一致的自动检测候选（不含运行中进程，那由调用方补充）。
pub fn detection_candidates(platform: Platform, local_appdata: Option<&Path>) -> Vec<PathBuf> {
    match platform {
        Platform::Windows => local_appdata
            .map(|base| {
                let programs = base.join("Programs").join("Cursor");
                vec![programs.join("Cursor.exe"), programs.join("Electron.exe")]
            })
            .unwrap_or_default(),
        Platform::MacOs => vec![
            PathBuf::from("/Applications/Cursor.app/Contents/MacOS/Cursor"),
            PathBuf::from("/Applications/Cursor.app/Contents/MacOS/Electron"),
        ],
        Platform::Linux => vec![
            PathBuf::from("/usr/bin/cursor"),
            PathBuf::from("/opt/cursor/cursor"),
        ],
    }
}

/// 先验证已保存路径，再按平台候选自动检测。检测命令在 force 时忽略旧路径。
#[cfg_attr(not(test), allow(dead_code))]
pub fn resolve_launch_executable(
    platform: Platform,
    saved: Option<&str>,
    local_appdata: Option<&Path>,
    exists: &dyn Fn(&Path) -> bool,
) -> Result<PathBuf, LaunchError> {
    if let Some(saved) = saved {
        if let Ok(path) = validate_launch_path(platform, saved, exists) {
            return Ok(path);
        }
    }
    detect_launch_path(platform, None, true, local_appdata, &[], exists)
        .ok_or(LaunchError::PathMissing)
}

/// Cockpit 检测顺序：macOS 先看常见安装位置，其他平台先看运行中进程，再回退到固定候选。
pub fn detect_launch_path(
    platform: Platform,
    saved: Option<&str>,
    force: bool,
    local_appdata: Option<&Path>,
    running: &[PathBuf],
    exists: &dyn Fn(&Path) -> bool,
) -> Option<PathBuf> {
    if !force {
        if let Some(saved) = saved {
            if let Ok(path) = validate_launch_path(platform, saved, exists) {
                return Some(path);
            }
        }
    }
    let mut candidates = Vec::new();
    if platform == Platform::MacOs {
        candidates.extend(detection_candidates(platform, local_appdata));
        candidates.extend(running.iter().cloned());
    } else {
        candidates.extend(running.iter().cloned());
        candidates.extend(detection_candidates(platform, local_appdata));
    }
    for candidate in candidates {
        if let Ok(path) = validate_launch_path(platform, &candidate.to_string_lossy(), exists) {
            return Some(path);
        }
    }
    None
}

pub fn running_cursor_executables(snapshot: &[RawProcess], self_pid: u32) -> Vec<PathBuf> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for process in snapshot {
        if process.pid == 0 || process.pid == self_pid {
            continue;
        }
        if is_helper_process(&process.name, &process.args) {
            continue;
        }
        let Some(executable) = process.executable.as_deref() else {
            continue;
        };
        let path = PathBuf::from(executable.trim().trim_matches('"'));
        if !path_looks_like_cursor(&path) {
            continue;
        }
        let key = path.to_string_lossy().to_lowercase();
        if seen.insert(key) {
            out.push(path);
        }
    }
    out
}

fn reason_is_access_denied(reason: &str) -> bool {
    let lower = reason.to_ascii_lowercase();
    lower.contains("os error 5")
        || lower.contains("access is denied")
        || lower.contains("access denied")
        || lower.contains("permission denied")
        || reason.contains("拒绝访问")
}

pub fn format_close_failure(failure: &CloseFailure) -> String {
    let summary = "关闭默认 Cursor 实例失败";
    #[cfg(target_os = "windows")]
    {
        let access_denied = failure
            .last_reason
            .as_deref()
            .is_some_and(reason_is_access_denied);
        let payload = serde_json::json!({
            "code": if access_denied { "access_denied" } else { "operation_failed" },
            "operation": "stop_process",
            "summary": summary,
            "originalReason": if access_denied { "access denied" } else { "close timeout" },
            "target": "cursor",
            "pids": failure.remaining,
            "retryable": true,
            "canElevate": access_denied && !failure.remaining.is_empty(),
            "manualActionAvailable": false,
            "attemptedRecoveries": ["taskkill"]
        });
        format!("WINDOWS_OPERATION_ERROR:{payload}")
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = failure;
        summary.to_owned()
    }
}

// ── 进程匹配 ────────────────────────────────────────────────────────────────

pub fn is_helper_process(name: &str, args: &[String]) -> bool {
    let name = name.to_lowercase();
    let args_line = args.join(" ").to_lowercase();
    args_line.contains("--type=")
        || name.contains("helper")
        || name.contains("renderer")
        || name.contains("gpu")
        || name.contains("utility")
        || name.contains("crashpad")
        || name.contains("sandbox")
}

pub fn extract_user_data_dir(args: &[String]) -> Option<String> {
    let mut index = 0;
    while index < args.len() {
        let token = args[index].as_str();
        if let Some(rest) = token.strip_prefix("--user-data-dir=") {
            let value = rest.trim().trim_matches('"');
            return (!value.is_empty()).then(|| value.to_owned());
        }
        if token == "--user-data-dir" {
            let mut parts = Vec::new();
            index += 1;
            while index < args.len() && !args[index].starts_with("--") {
                parts.push(args[index].as_str());
                index += 1;
            }
            let value = parts.join(" ");
            let value = value.trim().trim_matches('"');
            return (!value.is_empty()).then(|| value.to_owned());
        }
        index += 1;
    }
    None
}

/// 只保留可执行路径与已配置启动路径硬匹配的 Cursor 主进程。
pub fn classify_processes(
    platform: Platform,
    raw: &[RawProcess],
    expected_executable: &str,
    self_pid: u32,
) -> Vec<ProcessEntry> {
    let expected = normalize_path_for_compare(platform, expected_executable);
    if expected.is_empty() {
        return Vec::new();
    }
    let mut entries: Vec<ProcessEntry> = raw
        .iter()
        .filter(|process| process.pid != 0 && process.pid != self_pid)
        .filter(|process| !is_helper_process(&process.name, &process.args))
        .filter(|process| {
            process
                .executable
                .as_deref()
                .map(|value| normalize_path_for_compare(platform, value))
                .is_some_and(|value| value == expected)
        })
        .map(|process| ProcessEntry {
            pid: process.pid,
            user_data_dir: extract_user_data_dir(&process.args)
                .map(|value| normalize_path_for_compare(platform, &value))
                .filter(|value| !value.is_empty()),
        })
        .collect();
    entries.sort_by_key(|entry| entry.pid);
    entries.dedup_by_key(|entry| entry.pid);
    entries
}

/// 默认实例范围：显式带默认 `--user-data-dir` 的进程，以及未显式带该参数的主
/// 进程（Cursor 此时用的就是默认目录）。其他自定义 profile 保持运行。
pub fn select_default_instance_pids(
    platform: Platform,
    entries: &[ProcessEntry],
    default_user_data_dir: &Path,
) -> Vec<u32> {
    let target = normalize_path_for_compare(platform, &default_user_data_dir.to_string_lossy());
    if target.is_empty() {
        return Vec::new();
    }
    let mut pids: Vec<u32> = entries
        .iter()
        .filter(|entry| match entry.user_data_dir.as_deref() {
            Some(dir) => dir == target,
            None => true,
        })
        .map(|entry| entry.pid)
        .collect();
    pids.sort_unstable();
    pids.dedup();
    pids
}

/// `last_pid` 只有在重新验证通过后才优先处理，绝不能作为直接终止依据。
pub fn revalidate_last_pid(
    last_pid: Option<u32>,
    matched: &[u32],
    running: &dyn Fn(u32) -> bool,
) -> Option<u32> {
    let pid = last_pid?;
    (matched.contains(&pid) && running(pid)).then_some(pid)
}

/// UAC 重试白名单：最多 32 个 PID，且必须仍属于当前配置的 Cursor 可执行路径与
/// 默认 profile。不移植 Cockpit 的其他应用白名单。
pub fn validate_elevation_targets(
    platform: Platform,
    requested: &[u32],
    entries: &[ProcessEntry],
    default_user_data_dir: &Path,
) -> Result<Vec<u32>, String> {
    let mut targets: Vec<u32> = requested
        .iter()
        .copied()
        .filter(|pid| *pid != 0 && *pid != std::process::id())
        .collect();
    targets.sort_unstable();
    targets.dedup();
    if targets.is_empty() || targets.len() > MAX_ELEVATION_TARGETS {
        return Err("WINDOWS_ELEVATION_TARGET_INVALID".to_owned());
    }
    let allowed = select_default_instance_pids(platform, entries, default_user_data_dir);
    if targets.iter().any(|pid| !allowed.contains(pid)) {
        return Err("WINDOWS_ELEVATION_TARGET_NOT_ALLOWED".to_owned());
    }
    Ok(targets)
}

// ── 启动命令构造 ────────────────────────────────────────────────────────────

/// 启动参数固定为 `--user-data-dir <默认目录> --new-window`，不接受前端任意参数。
pub fn build_launch_plan(
    platform: Platform,
    executable: &Path,
    user_data_dir: &Path,
) -> Result<LaunchPlan, LaunchError> {
    let directory = user_data_dir.to_string_lossy().to_string();
    if directory.trim().is_empty() {
        return Err(LaunchError::PathMissing);
    }
    let fixed_args = |mut args: Vec<String>| {
        args.push("--user-data-dir".to_owned());
        args.push(directory.clone());
        args.push("--new-window".to_owned());
        args
    };
    Ok(match platform {
        Platform::Windows => LaunchPlan {
            program: executable.to_path_buf(),
            args: fixed_args(Vec::new()),
            removed_env: Vec::new(),
            hide_window: true,
        },
        Platform::Linux => LaunchPlan {
            program: executable.to_path_buf(),
            args: fixed_args(Vec::new()),
            removed_env: Vec::new(),
            hide_window: false,
        },
        Platform::MacOs => {
            let text = executable.to_string_lossy().to_string();
            let index = text
                .to_lowercase()
                .find(".app")
                .ok_or(LaunchError::PathMissing)?;
            LaunchPlan {
                program: PathBuf::from("open"),
                args: fixed_args(vec![
                    "-n".to_owned(),
                    "-a".to_owned(),
                    text[..index + 4].to_owned(),
                    "--args".to_owned(),
                ]),
                removed_env: vec!["__CFBundleIdentifier", "XPC_SERVICE_NAME"],
                hide_window: false,
            }
        }
    })
}

// ── 关闭与启动编排 ──────────────────────────────────────────────────────────

/// 关闭默认实例并等待退出。Windows 由 `terminate` 执行 `taskkill /PID … /T /F`，
/// macOS/Linux 发送 SIGTERM；两者都最多等待 20 秒，且不增加 SIGKILL 回退。
pub fn close_default_instance(
    ops: &dyn CursorProcessOps,
    clock: &dyn Clock,
    pids: &[u32],
    timeout_millis: u64,
) -> Result<(), CloseFailure> {
    let mut targets: Vec<u32> = pids
        .iter()
        .copied()
        .filter(|pid| *pid != 0 && ops.is_running(*pid))
        .collect();
    targets.sort_unstable();
    targets.dedup();
    if targets.is_empty() {
        return Ok(());
    }
    let mut last_reason = None;
    for pid in &targets {
        if let Err(reason) = ops.terminate(*pid) {
            last_reason = Some(reason);
        }
    }
    let deadline = clock.elapsed_millis().saturating_add(timeout_millis);
    loop {
        let remaining: Vec<u32> = targets
            .iter()
            .copied()
            .filter(|pid| ops.is_running(*pid))
            .collect();
        if remaining.is_empty() {
            return Ok(());
        }
        if clock.elapsed_millis() >= deadline {
            return Err(CloseFailure {
                remaining,
                last_reason,
            });
        }
        clock.sleep_millis(POLL_INTERVAL_MILLIS);
    }
}

/// 启动后只返回经重新验证的 PID：优先取默认 profile 的匹配进程，其次是仍在运行
/// 的 spawn PID；都不满足时不保存任何 PID。
pub fn start_default_instance(
    ops: &dyn CursorProcessOps,
    clock: &dyn Clock,
    plan: &LaunchPlan,
    platform: Platform,
    expected_executable: &str,
    default_user_data_dir: &Path,
) -> Result<Option<u32>, LaunchError> {
    let spawned = ops.spawn(plan).map_err(LaunchError::SpawnFailed)?;
    let self_pid = std::process::id();
    let deadline = clock
        .elapsed_millis()
        .saturating_add(START_VERIFY_TIMEOUT_MILLIS);
    loop {
        let entries = classify_processes(platform, &ops.snapshot(), expected_executable, self_pid);
        let matched = select_default_instance_pids(platform, &entries, default_user_data_dir);
        if let Some(pid) = matched.first().copied() {
            return Ok(Some(pid));
        }
        if clock.elapsed_millis() >= deadline {
            break;
        }
        clock.sleep_millis(POLL_INTERVAL_MILLIS);
    }
    Ok(ops.is_running(spawned).then_some(spawned))
}

// ── 真实实现 ────────────────────────────────────────────────────────────────

pub struct SystemClock {
    started: std::time::Instant,
}

impl Default for SystemClock {
    fn default() -> Self {
        Self {
            started: std::time::Instant::now(),
        }
    }
}

impl Clock for SystemClock {
    fn elapsed_millis(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    fn sleep_millis(&self, millis: u64) {
        std::thread::sleep(Duration::from_millis(millis));
    }
}

#[derive(Default)]
pub struct SystemProcessOps;

impl CursorProcessOps for SystemProcessOps {
    fn snapshot(&self) -> Vec<RawProcess> {
        #[cfg(target_os = "macos")]
        {
            // Cockpit skips sysinfo on macOS to avoid TCC dialogs and falls back to `ps`.
            return snapshot_macos_ps();
        }
        #[cfg(not(target_os = "macos"))]
        {
            snapshot_sysinfo()
        }
    }

    fn is_running(&self, pid: u32) -> bool {
        use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

        let mut system = System::new();
        let target = [Pid::from_u32(pid)];
        system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&target),
            true,
            ProcessRefreshKind::nothing(),
        );
        system.process(Pid::from_u32(pid)).is_some()
    }

    fn terminate(&self, pid: u32) -> Result<(), String> {
        terminate_pid(pid)
    }

    fn spawn(&self, plan: &LaunchPlan) -> Result<u32, String> {
        spawn_plan(plan)
    }

    fn path_exists(&self, path: &Path) -> bool {
        path.exists()
    }
}

#[cfg(not(target_os = "macos"))]
fn snapshot_sysinfo() -> Vec<RawProcess> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::OnlyIfNotSet)
            .with_cmd(UpdateKind::OnlyIfNotSet),
    );
    system
        .processes()
        .iter()
        .map(|(pid, process)| RawProcess {
            pid: pid.as_u32(),
            name: process.name().to_string_lossy().to_string(),
            executable: process.exe().map(|path| path.to_string_lossy().to_string()),
            args: process
                .cmd()
                .iter()
                .map(|value| value.to_string_lossy().to_string())
                .collect(),
        })
        .collect()
}

#[cfg(target_os = "macos")]
fn snapshot_macos_ps() -> Vec<RawProcess> {
    match std::process::Command::new("ps")
        .args(["-axo", "pid,command"])
        .output()
    {
        Ok(output) if output.status.success() => {
            parse_ps_axo_pid_command(&String::from_utf8_lossy(&output.stdout))
        }
        _ => Vec::new(),
    }
}

/// Cockpit macOS `ps -axo pid,command` 行解析。测试喂假 stdout，不执行真实 `ps`。
#[cfg_attr(not(any(test, target_os = "macos")), allow(dead_code))]
pub fn parse_ps_axo_pid_command(stdout: &str) -> Vec<RawProcess> {
    let mut out = Vec::new();
    for line in stdout.lines().skip(1) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let mut parts = line.splitn(2, char::is_whitespace);
        let Some(pid) = parts.next().and_then(|value| value.trim().parse().ok()) else {
            continue;
        };
        let Some(cmdline) = parts
            .next()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        else {
            continue;
        };
        let args: Vec<String> = cmdline.split_whitespace().map(str::to_owned).collect();
        let executable = args.first().cloned();
        let name = executable
            .as_deref()
            .and_then(|path| Path::new(path).file_name())
            .map(|value| value.to_string_lossy().into_owned())
            .unwrap_or_default();
        out.push(RawProcess {
            pid,
            name,
            executable,
            args,
        });
    }
    out
}

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Windows 严格采用 Cockpit 的 `taskkill /PID … /T /F`（未保存内容可能丢失），
/// macOS/Linux 发送 SIGTERM 且不增加 SIGKILL 回退。
pub fn build_terminate_command(platform: Platform, pid: u32) -> (String, Vec<String>) {
    match platform {
        Platform::Windows => (
            "taskkill".to_owned(),
            vec![
                "/PID".to_owned(),
                pid.to_string(),
                "/T".to_owned(),
                "/F".to_owned(),
            ],
        ),
        _ => ("kill".to_owned(), vec!["-15".to_owned(), pid.to_string()]),
    }
}

fn terminate_pid(pid: u32) -> Result<(), String> {
    let (program, args) = build_terminate_command(Platform::current(), pid);
    let mut command = std::process::Command::new(program);
    command
        .args(args)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command.output().map_err(|error| error.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_owned())
    }
}

fn spawn_plan(plan: &LaunchPlan) -> Result<u32, String> {
    let mut command = std::process::Command::new(&plan.program);
    for key in &plan.removed_env {
        command.env_remove(key);
    }
    command.args(plan.args.iter().map(OsString::from));
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    if plan.hide_window {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
        .spawn()
        .map(|child| child.id())
        .map_err(|error| error.to_string())
}

/// 对已通过白名单的 PID 调用 `taskkill.exe` 并弹出 UAC。非 Windows 直接拒绝。
pub fn run_elevated_taskkill(pids: &[u32]) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        run_elevated_taskkill_windows(pids)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = pids;
        Err("WINDOWS_ELEVATION_UNSUPPORTED".to_owned())
    }
}

#[cfg(target_os = "windows")]
fn wide(value: &std::ffi::OsStr) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().chain(std::iter::once(0)).collect()
}

#[cfg(target_os = "windows")]
fn run_elevated_taskkill_windows(pids: &[u32]) -> Result<(), String> {
    use std::mem::size_of;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0, WAIT_TIMEOUT};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};

    let system_root = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .ok_or_else(|| "WINDOWS_SYSTEM_ROOT_NOT_FOUND".to_owned())?;
    let taskkill = system_root.join("System32").join("taskkill.exe");
    if !taskkill.is_file() {
        return Err(format!(
            "WINDOWS_TASKKILL_NOT_FOUND: {}",
            taskkill.display()
        ));
    }

    let mut args = String::new();
    for pid in pids {
        args.push_str(&format!(" /PID {pid}"));
    }
    args.push_str(" /T /F");

    let verb = wide(std::ffi::OsStr::new("runas"));
    let file = wide(taskkill.as_os_str());
    let parameters = wide(std::ffi::OsStr::new(args.trim()));
    let mut info = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(parameters.as_ptr()),
        nShow: 0,
        ..Default::default()
    };

    unsafe {
        ShellExecuteExW(&mut info).map_err(|error| {
            if error.code() == windows::core::HRESULT::from_win32(1223) {
                "WINDOWS_ELEVATION_CANCELLED".to_owned()
            } else {
                format!("WINDOWS_ELEVATION_START_FAILED: {error}")
            }
        })?;
        if info.hProcess.is_invalid() {
            return Err("WINDOWS_ELEVATION_PROCESS_HANDLE_MISSING".to_owned());
        }

        let wait_result = WaitForSingleObject(info.hProcess, 120_000);
        if wait_result == WAIT_TIMEOUT {
            let _ = CloseHandle(info.hProcess);
            return Err("WINDOWS_ELEVATION_TIMEOUT".to_owned());
        }
        if wait_result != WAIT_OBJECT_0 {
            let _ = CloseHandle(info.hProcess);
            return Err(format!("WINDOWS_ELEVATION_WAIT_FAILED: {}", wait_result.0));
        }

        let mut exit_code = 0u32;
        let exit_result = GetExitCodeProcess(info.hProcess, &mut exit_code);
        let _ = CloseHandle(info.hProcess);
        exit_result.map_err(|error| format!("WINDOWS_ELEVATION_EXIT_READ_FAILED: {error}"))?;
        if exit_code != 0 {
            return Err(format!(
                "WINDOWS_ELEVATION_TASKKILL_FAILED: exit_code={exit_code}"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        cell::RefCell,
        collections::{HashMap, HashSet},
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::*;

    #[derive(Default)]
    struct FakeClock {
        millis: AtomicU64,
    }

    impl Clock for FakeClock {
        fn elapsed_millis(&self) -> u64 {
            self.millis.load(Ordering::SeqCst)
        }

        fn sleep_millis(&self, millis: u64) {
            self.millis.fetch_add(millis, Ordering::SeqCst);
        }
    }

    #[derive(Default)]
    struct FakeOps {
        running: RefCell<HashSet<u32>>,
        snapshots: RefCell<Vec<Vec<RawProcess>>>,
        terminated: RefCell<Vec<u32>>,
        survives_terminate: HashSet<u32>,
        terminate_errors: HashMap<u32, String>,
        spawn_result: Option<Result<u32, String>>,
        #[allow(dead_code)]
        existing_paths: HashSet<String>,
    }

    impl FakeOps {
        fn with_running(pids: &[u32]) -> Self {
            Self {
                running: RefCell::new(pids.iter().copied().collect()),
                ..Self::default()
            }
        }
    }

    impl CursorProcessOps for FakeOps {
        fn snapshot(&self) -> Vec<RawProcess> {
            let mut queued = self.snapshots.borrow_mut();
            if queued.is_empty() {
                Vec::new()
            } else if queued.len() == 1 {
                queued[0].clone()
            } else {
                queued.remove(0)
            }
        }

        fn is_running(&self, pid: u32) -> bool {
            self.running.borrow().contains(&pid)
        }

        fn terminate(&self, pid: u32) -> Result<(), String> {
            self.terminated.borrow_mut().push(pid);
            if let Some(reason) = self.terminate_errors.get(&pid) {
                return Err(reason.clone());
            }
            if !self.survives_terminate.contains(&pid) {
                self.running.borrow_mut().remove(&pid);
            }
            Ok(())
        }

        fn spawn(&self, _plan: &LaunchPlan) -> Result<u32, String> {
            self.spawn_result
                .clone()
                .unwrap_or(Err("no spawn configured".to_owned()))
        }

        fn path_exists(&self, path: &Path) -> bool {
            self.existing_paths
                .contains(&path.to_string_lossy().to_string())
        }
    }

    fn process(pid: u32, executable: &str, args: &[&str]) -> RawProcess {
        RawProcess {
            pid,
            name: Path::new(executable)
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_default(),
            executable: Some(executable.to_owned()),
            args: args.iter().map(|value| (*value).to_owned()).collect(),
        }
    }

    #[test]
    fn default_user_data_dir_follows_each_platform_convention() {
        assert_eq!(
            default_user_data_dir_for(
                Platform::Windows,
                Some(Path::new(r"C:\Users\tester\AppData\Roaming")),
                None
            ),
            Some(PathBuf::from(r"C:\Users\tester\AppData\Roaming\Cursor"))
        );
        assert_eq!(
            default_user_data_dir_for(Platform::MacOs, None, Some(Path::new("/Users/tester"))),
            Some(PathBuf::from(
                "/Users/tester/Library/Application Support/Cursor"
            ))
        );
        assert_eq!(
            default_user_data_dir_for(Platform::Linux, None, Some(Path::new("/home/tester"))),
            Some(PathBuf::from("/home/tester/.config/Cursor"))
        );
        assert_eq!(
            default_user_data_dir_for(Platform::Windows, None, None),
            None
        );
    }

    #[test]
    fn launch_plan_is_fixed_per_platform() {
        let directory = PathBuf::from("/data/Cursor");
        let windows = build_launch_plan(
            Platform::Windows,
            Path::new(r"C:\Programs\Cursor\Cursor.exe"),
            &directory,
        )
        .unwrap();
        assert_eq!(
            windows.program,
            PathBuf::from(r"C:\Programs\Cursor\Cursor.exe")
        );
        assert_eq!(
            windows.args,
            vec!["--user-data-dir", "/data/Cursor", "--new-window"]
        );
        assert!(windows.hide_window);
        assert!(windows.removed_env.is_empty());

        let linux =
            build_launch_plan(Platform::Linux, Path::new("/usr/bin/cursor"), &directory).unwrap();
        assert_eq!(linux.program, PathBuf::from("/usr/bin/cursor"));
        assert_eq!(linux.args, windows.args);
        assert!(!linux.hide_window);

        let macos = build_launch_plan(
            Platform::MacOs,
            Path::new("/Applications/Cursor.app/Contents/MacOS/Cursor"),
            &directory,
        )
        .unwrap();
        assert_eq!(macos.program, PathBuf::from("open"));
        assert_eq!(
            macos.args,
            vec![
                "-n",
                "-a",
                "/Applications/Cursor.app",
                "--args",
                "--user-data-dir",
                "/data/Cursor",
                "--new-window"
            ]
        );
        assert_eq!(
            macos.removed_env,
            vec!["__CFBundleIdentifier", "XPC_SERVICE_NAME"]
        );
    }

    #[test]
    fn terminate_uses_taskkill_tree_force_on_windows_and_sigterm_elsewhere() {
        assert_eq!(
            build_terminate_command(Platform::Windows, 42),
            (
                "taskkill".to_owned(),
                vec![
                    "/PID".to_owned(),
                    "42".to_owned(),
                    "/T".to_owned(),
                    "/F".to_owned()
                ]
            )
        );
        for platform in [Platform::MacOs, Platform::Linux] {
            assert_eq!(
                build_terminate_command(platform, 42),
                ("kill".to_owned(), vec!["-15".to_owned(), "42".to_owned()])
            );
        }
    }

    #[test]
    fn only_default_profile_main_processes_are_targeted() {
        let raw = vec![
            process(
                11,
                "/usr/bin/cursor",
                &["--user-data-dir", "/home/t/.config/Cursor"],
            ),
            process(12, "/usr/bin/cursor", &[]),
            process(
                13,
                "/usr/bin/cursor",
                &["--user-data-dir", "/home/t/.config/CursorAlt"],
            ),
            process(
                14,
                "/usr/bin/cursor",
                &[
                    "--type=renderer",
                    "--user-data-dir",
                    "/home/t/.config/Cursor",
                ],
            ),
            process(
                15,
                "/usr/bin/code",
                &["--user-data-dir", "/home/t/.config/Cursor"],
            ),
        ];
        let entries = classify_processes(Platform::Linux, &raw, "/usr/bin/cursor", 99);
        assert_eq!(
            entries.iter().map(|entry| entry.pid).collect::<Vec<_>>(),
            vec![11, 12, 13]
        );
        assert_eq!(
            select_default_instance_pids(
                Platform::Linux,
                &entries,
                Path::new("/home/t/.config/Cursor")
            ),
            vec![11, 12]
        );
    }

    #[test]
    fn the_application_process_itself_is_never_a_target() {
        let raw = vec![process(7, "/usr/bin/cursor", &[])];
        assert!(classify_processes(Platform::Linux, &raw, "/usr/bin/cursor", 7).is_empty());
    }

    #[test]
    fn a_reused_last_pid_is_rejected_unless_it_still_matches() {
        let matched = [11, 12];
        assert_eq!(revalidate_last_pid(Some(12), &matched, &|_| true), Some(12));
        assert_eq!(revalidate_last_pid(Some(90), &matched, &|_| true), None);
        assert_eq!(revalidate_last_pid(Some(12), &matched, &|_| false), None);
        assert_eq!(revalidate_last_pid(None, &matched, &|_| true), None);
    }

    #[test]
    fn closing_waits_for_exit_and_reports_survivors_after_twenty_seconds() {
        let ops = FakeOps::with_running(&[11, 12]);
        let clock = FakeClock::default();
        assert_eq!(
            close_default_instance(&ops, &clock, &[11, 12], CLOSE_TIMEOUT_MILLIS),
            Ok(())
        );
        assert_eq!(*ops.terminated.borrow(), vec![11, 12]);
        assert!(clock.elapsed_millis() < CLOSE_TIMEOUT_MILLIS);

        let stubborn = FakeOps {
            running: RefCell::new([13].into_iter().collect()),
            survives_terminate: [13].into_iter().collect(),
            ..FakeOps::default()
        };
        let clock = FakeClock::default();
        assert_eq!(
            close_default_instance(&stubborn, &clock, &[13], CLOSE_TIMEOUT_MILLIS),
            Err(CloseFailure {
                remaining: vec![13],
                last_reason: None
            })
        );
        assert!(clock.elapsed_millis() >= CLOSE_TIMEOUT_MILLIS);
    }

    #[test]
    fn closing_nothing_is_a_no_op() {
        let ops = FakeOps::default();
        let clock = FakeClock::default();
        assert_eq!(close_default_instance(&ops, &clock, &[0, 44], 20), Ok(()));
        assert!(ops.terminated.borrow().is_empty());
    }

    #[test]
    fn closing_keeps_access_denied_reasons_for_windows_recovery() {
        let denied = FakeOps {
            running: RefCell::new([13].into_iter().collect()),
            survives_terminate: [13].into_iter().collect(),
            terminate_errors: [(13, "Access is denied. (os error 5)".to_owned())]
                .into_iter()
                .collect(),
            ..FakeOps::default()
        };
        let clock = FakeClock::default();
        let failure = close_default_instance(&denied, &clock, &[13], 20).unwrap_err();
        assert_eq!(failure.remaining, vec![13]);
        assert_eq!(
            failure.last_reason.as_deref(),
            Some("Access is denied. (os error 5)")
        );
        let formatted = format_close_failure(&failure);
        #[cfg(target_os = "windows")]
        {
            assert!(formatted.starts_with("WINDOWS_OPERATION_ERROR:"));
            assert!(formatted.contains("access_denied"));
            assert!(formatted.contains("\"canElevate\":true"));
            assert!(!formatted.to_lowercase().contains("taskkill /pid"));
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(formatted, "关闭默认 Cursor 实例失败");
        }
    }

    #[test]
    fn windows_close_timeout_is_retryable_without_uac() {
        let formatted = format_close_failure(&CloseFailure {
            remaining: vec![13],
            last_reason: None,
        });
        #[cfg(target_os = "windows")]
        {
            assert!(formatted.contains("operation_failed"));
            assert!(formatted.contains("\"canElevate\":false"));
        }
        #[cfg(not(target_os = "windows"))]
        {
            assert_eq!(formatted, "关闭默认 Cursor 实例失败");
        }
    }

    #[test]
    fn start_returns_the_revalidated_pid_and_spawn_failures_stay_soft() {
        let ops = FakeOps {
            running: RefCell::new([500].into_iter().collect()),
            snapshots: RefCell::new(vec![
                Vec::new(),
                vec![process(
                    501,
                    "/usr/bin/cursor",
                    &["--user-data-dir", "/home/t/.config/Cursor"],
                )],
            ]),
            spawn_result: Some(Ok(500)),
            ..FakeOps::default()
        };
        let clock = FakeClock::default();
        let plan = build_launch_plan(
            Platform::Linux,
            Path::new("/usr/bin/cursor"),
            Path::new("/home/t/.config/Cursor"),
        )
        .unwrap();
        assert_eq!(
            start_default_instance(
                &ops,
                &clock,
                &plan,
                Platform::Linux,
                "/usr/bin/cursor",
                Path::new("/home/t/.config/Cursor")
            ),
            Ok(Some(501))
        );

        let failing = FakeOps {
            spawn_result: Some(Err("permission denied".to_owned())),
            ..FakeOps::default()
        };
        assert_eq!(
            start_default_instance(
                &failing,
                &FakeClock::default(),
                &plan,
                Platform::Linux,
                "/usr/bin/cursor",
                Path::new("/home/t/.config/Cursor")
            ),
            Err(LaunchError::SpawnFailed("permission denied".to_owned()))
        );
    }

    #[test]
    fn start_saves_no_pid_when_nothing_can_be_revalidated() {
        let ops = FakeOps {
            spawn_result: Some(Ok(600)),
            ..FakeOps::default()
        };
        let plan = build_launch_plan(
            Platform::Linux,
            Path::new("/usr/bin/cursor"),
            Path::new("/home/t/.config/Cursor"),
        )
        .unwrap();
        assert_eq!(
            start_default_instance(
                &ops,
                &FakeClock::default(),
                &plan,
                Platform::Linux,
                "/usr/bin/cursor",
                Path::new("/home/t/.config/Cursor")
            ),
            Ok(None)
        );
    }

    #[test]
    fn launch_path_validation_rejects_non_cursor_and_relative_targets() {
        let existing: HashSet<String> = [
            "/usr/bin/cursor".to_owned(),
            "/usr/bin/other".to_owned(),
            "/Applications/Cursor.app/Contents/MacOS/Cursor".to_owned(),
        ]
        .into_iter()
        .collect();
        let exists = |path: &Path| existing.contains(&path.to_string_lossy().replace('\\', "/"));

        assert_eq!(
            validate_launch_path(Platform::Linux, " /usr/bin/cursor ", &exists),
            Ok(PathBuf::from("/usr/bin/cursor"))
        );
        assert_eq!(
            validate_launch_path(Platform::Linux, "/usr/bin/other", &exists),
            Err(LaunchError::PathMissing)
        );
        assert_eq!(
            resolve_launch_executable(Platform::Linux, Some("/usr/bin/other"), None, &exists),
            Ok(PathBuf::from("/usr/bin/cursor"))
        );
        assert_eq!(
            resolve_launch_executable(Platform::Linux, None, None, &exists),
            Ok(PathBuf::from("/usr/bin/cursor"))
        );
        assert_eq!(
            resolve_launch_executable(Platform::Linux, None, None, &|_| false),
            Err(LaunchError::PathMissing)
        );
        assert_eq!(
            validate_launch_path(Platform::Linux, "cursor", &exists),
            Err(LaunchError::PathMissing)
        );
        assert_eq!(
            validate_launch_path(Platform::Linux, "/usr/bin/missing-cursor", &exists),
            Err(LaunchError::PathMissing)
        );
        assert_eq!(
            validate_launch_path(Platform::Linux, "/usr/bin/other", &exists),
            Err(LaunchError::PathMissing)
        );
        assert!(detect_launch_path(
            Platform::Linux,
            Some("/usr/bin/other"),
            false,
            None,
            &[],
            &exists
        )
        .is_some());
        // macOS 同时接受 .app 根和其可执行文件，并规范化到可执行文件。
        assert_eq!(
            validate_launch_path(Platform::MacOs, "/Applications/Cursor.app", &exists)
                .map(|path| path.to_string_lossy().replace('\\', "/")),
            Ok("/Applications/Cursor.app/Contents/MacOS/Cursor".to_owned())
        );
        assert_eq!(
            validate_launch_path(
                Platform::MacOs,
                "/Applications/Cursor.app/Contents/MacOS/Cursor",
                &exists
            )
            .map(|path| path.to_string_lossy().replace('\\', "/")),
            Ok("/Applications/Cursor.app/Contents/MacOS/Cursor".to_owned())
        );
    }

    #[test]
    fn detection_candidates_match_the_pinned_upstream_list() {
        assert_eq!(
            detection_candidates(
                Platform::Windows,
                Some(Path::new(r"C:\Users\t\AppData\Local"))
            ),
            vec![
                PathBuf::from(r"C:\Users\t\AppData\Local\Programs\Cursor\Cursor.exe"),
                PathBuf::from(r"C:\Users\t\AppData\Local\Programs\Cursor\Electron.exe"),
            ]
        );
        assert_eq!(
            detection_candidates(Platform::MacOs, None),
            vec![
                PathBuf::from("/Applications/Cursor.app/Contents/MacOS/Cursor"),
                PathBuf::from("/Applications/Cursor.app/Contents/MacOS/Electron"),
            ]
        );
        assert_eq!(
            detection_candidates(Platform::Linux, None),
            vec![
                PathBuf::from("/usr/bin/cursor"),
                PathBuf::from("/opt/cursor/cursor"),
            ]
        );
    }

    #[test]
    fn running_cursor_executables_skip_helpers_and_self() {
        let snapshot = vec![
            RawProcess {
                pid: 7,
                name: "cursor".to_owned(),
                executable: Some("/usr/bin/cursor".to_owned()),
                args: vec![],
            },
            RawProcess {
                pid: 11,
                name: "cursor".to_owned(),
                executable: Some("/usr/bin/cursor".to_owned()),
                args: vec![
                    "--user-data-dir".to_owned(),
                    "/home/t/.config/Cursor".to_owned(),
                ],
            },
            RawProcess {
                pid: 12,
                name: "cursor".to_owned(),
                executable: Some("/usr/bin/cursor".to_owned()),
                args: vec!["--type=renderer".to_owned()],
            },
            RawProcess {
                pid: 13,
                name: "code".to_owned(),
                executable: Some("/usr/bin/code".to_owned()),
                args: vec![],
            },
        ];
        assert_eq!(
            running_cursor_executables(&snapshot, 7),
            vec![PathBuf::from("/usr/bin/cursor")]
        );
    }

    #[test]
    fn macos_ps_snapshot_parses_pid_and_command_without_running_ps() {
        let parsed = parse_ps_axo_pid_command(
            "  PID COMMAND\n  501 /Applications/Cursor.app/Contents/MacOS/Cursor --new-window\n  502 /Applications/Cursor.app/Contents/Frameworks/Cursor Helper (Renderer).app/Contents/MacOS/Cursor Helper (Renderer) --type=renderer\n",
        );
        assert_eq!(parsed[0].pid, 501);
        assert_eq!(
            parsed[0].executable.as_deref(),
            Some("/Applications/Cursor.app/Contents/MacOS/Cursor")
        );
        assert!(parsed[1]
            .args
            .iter()
            .any(|arg| arg.contains("--type=renderer")));
    }

    #[test]
    fn elevation_targets_are_capped_and_restricted_to_the_default_instance() {
        let entries = vec![
            ProcessEntry {
                pid: 11,
                user_data_dir: Some("/home/t/.config/cursor".to_owned()),
            },
            ProcessEntry {
                pid: 12,
                user_data_dir: Some("/home/t/.config/other".to_owned()),
            },
        ];
        let default_dir = Path::new("/home/t/.config/cursor");

        assert_eq!(
            validate_elevation_targets(Platform::Linux, &[11, 11], &entries, default_dir),
            Ok(vec![11])
        );
        assert_eq!(
            validate_elevation_targets(Platform::Linux, &[11, 12], &entries, default_dir),
            Err("WINDOWS_ELEVATION_TARGET_NOT_ALLOWED".to_owned())
        );
        assert_eq!(
            validate_elevation_targets(Platform::Linux, &[], &entries, default_dir),
            Err("WINDOWS_ELEVATION_TARGET_INVALID".to_owned())
        );
        let too_many: Vec<u32> = (1..=(MAX_ELEVATION_TARGETS as u32 + 1)).collect();
        assert_eq!(
            validate_elevation_targets(Platform::Linux, &too_many, &entries, default_dir),
            Err("WINDOWS_ELEVATION_TARGET_INVALID".to_owned())
        );
    }

    #[test]
    fn user_data_dir_is_extracted_from_both_argument_forms() {
        assert_eq!(
            extract_user_data_dir(&["--user-data-dir=/a/b".to_owned()]),
            Some("/a/b".to_owned())
        );
        assert_eq!(
            extract_user_data_dir(&[
                "--user-data-dir".to_owned(),
                "/a/b c".to_owned(),
                "--new-window".to_owned()
            ]),
            Some("/a/b c".to_owned())
        );
        assert_eq!(extract_user_data_dir(&["--new-window".to_owned()]), None);
    }
}
