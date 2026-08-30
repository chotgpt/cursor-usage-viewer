use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum LinuxInstallType {
    AppImage,
    Deb,
    Rpm,
    Unknown,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedLinuxUpdate {
    pub version: String,
    pub kind: &'static str,
}

pub fn updater_target(kind: LinuxInstallType, arch: &str) -> AppResult<String> {
    let arch = match arch {
        "x86_64" | "aarch64" => arch,
        _ => return Err(AppError::Storage("不支持的 Linux 更新架构".to_owned())),
    };
    let package = match kind {
        LinuxInstallType::Deb => "deb",
        LinuxInstallType::Rpm => "rpm",
        LinuxInstallType::AppImage => "appimage",
        LinuxInstallType::Unknown => {
            return Err(AppError::Storage(
                "未知安装类型，只允许浏览器下载".to_owned(),
            ))
        }
    };
    Ok(format!("linux-{arch}-{package}"))
}

pub fn detect_linux_install_type(
    appimage: Option<&str>,
    executable: &Path,
    dpkg_owned: bool,
    rpm_owned: bool,
) -> LinuxInstallType {
    if appimage.is_some_and(|value| !value.trim().is_empty()) {
        LinuxInstallType::AppImage
    } else if dpkg_owned {
        LinuxInstallType::Deb
    } else if rpm_owned {
        LinuxInstallType::Rpm
    } else if executable
        .extension()
        .and_then(|value| value.to_str())
        .is_some_and(|value| value.eq_ignore_ascii_case("appimage"))
    {
        LinuxInstallType::AppImage
    } else {
        LinuxInstallType::Unknown
    }
}

pub fn validated_package_path(
    updates_root: &Path,
    version: &str,
    package: &Path,
    kind: LinuxInstallType,
) -> AppResult<PathBuf> {
    if version.is_empty()
        || !version
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_'))
    {
        return Err(AppError::Storage("更新版本无效".to_owned()));
    }
    let expected_root = updates_root.join(version);
    let canonical_root = expected_root
        .canonicalize()
        .map_err(|error| AppError::Storage(error.to_string()))?;
    let canonical = package
        .canonicalize()
        .map_err(|error| AppError::Storage(error.to_string()))?;
    let extension = canonical
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let valid_extension = matches!(
        (kind, extension),
        (LinuxInstallType::Deb, "deb") | (LinuxInstallType::Rpm, "rpm")
    );
    if !canonical.starts_with(canonical_root) || !valid_extension {
        return Err(AppError::Storage(
            "更新包不在隔离目录或类型不匹配".to_owned(),
        ));
    }
    Ok(canonical)
}

pub fn install_candidates(
    kind: LinuxInstallType,
    package: &Path,
) -> AppResult<Vec<(String, Vec<String>)>> {
    let path = package.to_string_lossy().to_string();
    match kind {
        LinuxInstallType::Deb => Ok(vec![
            ("pkcon".into(), vec!["install-local".into(), path.clone()]),
            (
                "pkexec".into(),
                vec!["apt".into(), "install".into(), path.clone()],
            ),
            ("pkexec".into(), vec!["dpkg".into(), "-i".into(), path]),
        ]),
        LinuxInstallType::Rpm => Ok(vec![
            ("pkcon".into(), vec!["install-local".into(), path.clone()]),
            (
                "pkexec".into(),
                vec!["dnf".into(), "install".into(), path.clone()],
            ),
            (
                "pkexec".into(),
                vec!["yum".into(), "install".into(), path.clone()],
            ),
            ("pkexec".into(), vec!["rpm".into(), "-U".into(), path]),
        ]),
        _ => Err(AppError::Storage(
            "未知安装类型，拒绝执行系统命令".to_owned(),
        )),
    }
}

pub fn discard_prepared_package(updates_root: &Path, version: &str) -> AppResult<()> {
    if !version.is_empty()
        && version
            .chars()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, '.' | '-' | '_'))
    {
        for extension in ["deb", "rpm"] {
            for suffix in [extension.to_owned(), format!("{extension}.part")] {
                let path = updates_root
                    .join(version)
                    .join(format!("cursor-usage-viewer.{suffix}"));
                match std::fs::remove_file(path) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(AppError::Storage(error.to_string())),
                }
            }
        }
        return Ok(());
    }
    Err(AppError::Storage("更新版本无效".to_owned()))
}

#[cfg(target_os = "linux")]
pub fn detect_current_install_type() -> LinuxInstallType {
    use std::process::Command;

    let executable = match std::env::current_exe() {
        Ok(path) => path,
        Err(_) => return LinuxInstallType::Unknown,
    };
    let dpkg_owned = Command::new("dpkg-query")
        .arg("-S")
        .arg(&executable)
        .output()
        .is_ok_and(|output| output.status.success());
    let rpm_owned = Command::new("rpm")
        .arg("-qf")
        .arg(&executable)
        .output()
        .is_ok_and(|output| output.status.success());
    detect_linux_install_type(
        std::env::var("APPIMAGE").ok().as_deref(),
        &executable,
        dpkg_owned,
        rpm_owned,
    )
}

#[cfg(target_os = "linux")]
pub async fn download_package_update(
    app: &tauri::AppHandle,
    updates_root: &Path,
    expected_version: &str,
) -> AppResult<PreparedLinuxUpdate> {
    use tauri::Emitter;
    use tauri_plugin_updater::UpdaterExt;

    let kind = detect_current_install_type();
    if !matches!(kind, LinuxInstallType::Deb | LinuxInstallType::Rpm) {
        return Err(AppError::Storage(
            "当前安装类型不使用 Linux 托管包更新".to_owned(),
        ));
    }
    let target = updater_target(kind, std::env::consts::ARCH)?;
    let update = app
        .updater_builder()
        .target(target)
        .build()
        .map_err(update_error)?
        .check()
        .await
        .map_err(update_error)?
        .ok_or_else(|| AppError::Storage("没有可下载的新版本".to_owned()))?;
    if update.version != expected_version {
        return Err(AppError::Storage("更新版本与预期不一致".to_owned()));
    }
    let url = update.download_url.as_str();
    if !url.starts_with("https://github.com/")
        || !url.contains("/cursor-usage-viewer/releases/download/")
    {
        return Err(AppError::EndpointRejected);
    }

    let version_dir = updates_root.join(expected_version);
    std::fs::create_dir_all(&version_dir).map_err(update_error)?;
    let extension = if kind == LinuxInstallType::Deb {
        "deb"
    } else {
        "rpm"
    };
    let package = version_dir.join(format!("cursor-usage-viewer.{extension}"));
    let temporary = version_dir.join(format!("cursor-usage-viewer.{extension}.part"));
    let mut received_total = 0usize;
    let bytes = update
        .download(
            |received, total| {
                received_total += received;
                let _ = app.emit(
                    "linux-update-progress",
                    serde_json::json!({ "received": received_total, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(update_error)?;
    std::fs::write(&temporary, bytes).map_err(update_error)?;
    std::fs::rename(&temporary, &package).map_err(update_error)?;
    validated_package_path(updates_root, expected_version, &package, kind)?;
    Ok(PreparedLinuxUpdate {
        version: expected_version.to_owned(),
        kind: extension,
    })
}

#[cfg(target_os = "linux")]
pub fn install_package_update(updates_root: &Path, version: &str) -> AppResult<()> {
    use std::process::Command;

    let kind = detect_current_install_type();
    let extension = match kind {
        LinuxInstallType::Deb => "deb",
        LinuxInstallType::Rpm => "rpm",
        _ => {
            return Err(AppError::Storage(
                "未知安装类型，拒绝执行系统命令".to_owned(),
            ))
        }
    };
    let package = updates_root
        .join(version)
        .join(format!("cursor-usage-viewer.{extension}"));
    let package = validated_package_path(updates_root, version, &package, kind)?;
    for (program, arguments) in install_candidates(kind, &package)? {
        if Command::new(program)
            .args(arguments)
            .status()
            .is_ok_and(|status| status.success())
        {
            return Ok(());
        }
    }
    Err(AppError::Storage(
        "系统包管理器未能完成更新，未返回命令输出".to_owned(),
    ))
}

#[cfg(target_os = "linux")]
fn update_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;
    #[test]
    fn unknown_type_never_produces_a_command() {
        assert!(install_candidates(LinuxInstallType::Unknown, Path::new("/tmp/x")).is_err());
    }
    #[test]
    fn package_must_stay_inside_version_directory() {
        let dir = tempdir().unwrap();
        let version = dir.path().join("1.0.0");
        std::fs::create_dir(&version).unwrap();
        let good = version.join("app.deb");
        std::fs::write(&good, b"fake").unwrap();
        assert!(validated_package_path(dir.path(), "1.0.0", &good, LinuxInstallType::Deb).is_ok());
        let outside = dir.path().join("outside.deb");
        std::fs::write(&outside, b"fake").unwrap();
        assert!(
            validated_package_path(dir.path(), "1.0.0", &outside, LinuxInstallType::Deb).is_err()
        );
    }
    #[test]
    fn updater_target_preserves_linux_package_type() {
        assert_eq!(
            updater_target(LinuxInstallType::Deb, "aarch64").unwrap(),
            "linux-aarch64-deb"
        );
        assert_eq!(
            updater_target(LinuxInstallType::Rpm, "x86_64").unwrap(),
            "linux-x86_64-rpm"
        );
        assert!(updater_target(LinuxInstallType::Unknown, "x86_64").is_err());
        assert!(updater_target(LinuxInstallType::Deb, "riscv64").is_err());
    }

    #[test]
    fn cancelling_a_linux_download_removes_only_known_package_files() {
        let dir = tempdir().unwrap();
        let version = dir.path().join("1.2.3");
        std::fs::create_dir(&version).unwrap();
        let package = version.join("cursor-usage-viewer.deb");
        let unrelated = version.join("keep.txt");
        std::fs::write(&package, b"fake").unwrap();
        std::fs::write(&unrelated, b"keep").unwrap();
        discard_prepared_package(dir.path(), "1.2.3").unwrap();
        assert!(!package.exists());
        assert!(unrelated.exists());
        assert!(discard_prepared_package(dir.path(), "../outside").is_err());
    }

    #[test]
    fn isolated_updater_signature_rejects_a_tampered_package() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        use minisign_verify::{PublicKey, Signature};

        const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEZCQkExREVGMDQ0NTdGOEIKUldTTGYwVUU3eDI2KzUrVnRaZzd4RnBTQjR3WXBxWFYvZ0ZHMXNOcFVNQ3ZEL2w1a0tkQW1TZlYK";
        const SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTTGYwVUU3eDI2KytTeVZPaUhPdlJPNkVuQ0V1ZXdYdnk3VjhuTXpWTVFwdWVzRnR2RFFKMXRmaDg4aFBGRnhHUWRVem9wSkxqN09SQVNGWVVUS2NuOTdlQUR3S3l0eXdJPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg4MTAxMTk3CWZpbGU6ZmFrZS1saW51eC1wYWNrYWdlLmRlYgpYMVVqMkFoSzIrWm9PNzNtRjlFS2FsNXp1cHpENGpSOTNpdWxwN0NjOWs1dU1LWTVPMmNGM0s4dy85TTNsbVR6VENLd2xuTDkzSmVRMmxMSlA4U1BDUT09Cg==";
        let public_key =
            PublicKey::decode(std::str::from_utf8(&STANDARD.decode(PUBLIC_KEY).unwrap()).unwrap())
                .unwrap();
        let signature =
            Signature::decode(std::str::from_utf8(&STANDARD.decode(SIGNATURE).unwrap()).unwrap())
                .unwrap();
        let package = b"cursor-usage-viewer isolated updater fixture\n";
        assert!(public_key.verify(package, &signature, true).is_ok());
        assert!(public_key
            .verify(b"cursor-usage-viewer tampered fixture\n", &signature, true)
            .is_err());
    }
}
