# ADR-0002：采用 GitHub Releases 与 Tauri 签名更新实现三平台发布

- 状态：已接受
- 日期：2026-08-30

## 背景

项目准备以 MIT 许可证在 GitHub 开源，并要求 Windows、macOS、Linux 同时首发。应用需要完整参考 Cockpit Tools 的更新体验：自动与手动检查、跳过、提醒、下载进度、取消、重试、安装、重启和更新后说明。

候选方案包括：只提供手动下载、使用自建更新服务器、使用 GitHub Releases + Tauri updater，以及直接复制 Cockpit 的发布代码。只提供手动下载不能满足产品需求；自建服务器增加运维和隐私边界；复制 Cockpit 源码/workflow 与其 README 声明的 CC BY-NC-SA 4.0 约束冲突。GitHub Releases 与 Tauri updater 能使用公开发布资产、签名校验和固定更新元数据，同时保持项目独立实现。

Tauri updater 签名只验证更新资产是否由本项目发布，不能消除 Windows SmartScreen 或 macOS Gatekeeper 警告。操作系统代码签名需要额外证书、开发者账号和公证流程。

## 决策

1. 使用个人 GitHub 仓库 `cursor-usage-viewer`、GitHub Releases 和官方 Tauri updater 作为唯一稳定发布与应用更新来源。
2. 只维护 stable 通道。`v*` 标签生成 Draft Release；Windows、macOS、Linux 必需资产全部完成并验证后，由用户人工发布。
3. Windows x86_64 提供 NSIS/MSI；macOS 提供 Apple Silicon、Intel updater assets 和 Universal 手动包；Linux x86_64/aarch64 提供 AppImage/deb/rpm。
4. 所有 updater assets 使用 Tauri 私钥签名。公钥嵌入应用；私钥和密码只存 GitHub Actions Secrets，并做离线加密备份。
5. 首版不做 Windows 代码签名和 Apple Developer ID/notarization；文档明确说明相应系统警告。未来加入平台签名不改变 updater 签名要求。
6. 应用只访问本项目固定 GitHub Release updater endpoint，不额外轮询 GitHub Releases API，不允许任意更新 URL。
7. Windows、macOS 和 Linux AppImage 使用 Tauri updater 标准安装路径。Linux deb/rpm 独立实现安装类型识别、资产下载和 Tauri/minisign 验证；只有用户明确点击安装且签名验证成功后，才调用系统包管理器提权安装。
8. 发布工作流独立编写，不复制 Cockpit workflow。第三方 Actions 固定完整 commit SHA，权限最小化，fork PR 不获取签名 Secrets。
9. 发布前生成并验证 target manifests、完整 `latest.json`、SHA256 和 artifact attestations；任一必需平台失败时 fail closed。
10. GitHub repo 先 private 演练。清密和 `v0.1.0` Draft 验收完成后，再经用户确认改 public 并人工发布。

## 后果

### 正面

- 三平台用户获得一致的应用内更新入口和签名校验；
- GitHub 同时承载源码、问题、构建和公开资产，不需要自建服务；
- Draft + 人工发布避免平台资产不完整时污染稳定通道；
- target-specific metadata 能区分 Windows 安装器和 Linux 包类型；
- updater 私钥与账号凭据完全分离。

### 代价

- CI 矩阵、manifest 汇总和 Linux deb/rpm 安装器增加实现与测试成本；
- 首版无操作系统代码签名，Windows/macOS 安装体验会出现系统警告；
- updater 私钥必须长期安全保存，丢失会影响已安装版本继续更新；
- 三平台全部通过才可发布，单平台故障会延迟版本。

### 约束

- 不得把 Cursor Token、Cookie 或账号 JSON放进 GitHub、Release、Actions logs 或 updater 请求；
- 不得让签名失败、未知安装类型或不匹配版本进入安装步骤；
- 不得在 workflow 中自动把 Draft 公开为 stable；
- 不得用 SHA256 或 attestation 替代应用内 updater 签名验证；
- 更换 repo owner、bundle identifier、updater public key 或发布通道都属于高成本迁移，必须另行记录决策。

## 决策依据

- 用户于 2026-08-30 确认三平台同时首发、MIT、个人仓库、只维护 stable、Draft 后人工发布、首版仅 updater 签名、不做平台代码签名。
- Cockpit Tools 固定提交 `a0508ae815e104e931dae515389e680840008367` 的 `src-tauri/src/modules/update_checker.rs`、`src/App.tsx`、`src/components/UpdateNotification.tsx`、`src-tauri/src/modules/linux_updater.rs`、`src-tauri/tauri.conf.json` 和 `.github/workflows/release.yml` 仅用于行为研究。
- Tauri 官方 updater 与 GitHub Actions 发布能力，以及 GitHub Draft Release、Rulesets、immutable releases 和 artifact attestations 的官方文档。
