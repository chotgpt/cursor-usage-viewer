# Cursor Usage Viewer：Cockpit 风格多账号、三平台更新与 GitHub 开源发布实施计划

状态：**最终封板，待新窗口实施**  
日期：2026-08-30  
代码实施基线：`3be91db feat: establish Cursor usage viewer baseline`  
Cockpit 研究基线：`jlcodes99/cockpit-tools@a0508ae815e104e931dae515389e680840008367`

## 1. 目标、模式与权威读取顺序

把当前 Windows 单账号额度页升级为只服务 Cursor 的三平台开源桌面应用：深色高密度账号页；多账号明文持久化；Cockpit JSON 粘贴导入和完整导出；用户主动触发的 Cursor 账号读取与额度刷新；Windows、macOS、Linux 同时发布；Cockpit 同等的检查、下载、跳过、重试、安装、重启和更新后说明；以及 GitHub 仓库创建、治理、CI、三平台构建、Draft Release、更新清单和公开发布全流程。

这是计划封板，不是代码已完成声明。新窗口 Agent 先读仓库规则，再按以下顺序解决语义冲突：

1. `docs/DECISIONS.md` §D-011、§D-012、§D-013、§D-014；
2. `CONTEXT.md`；
3. `docs/adr/0001-cockpit-compatible-local-persistence.md`；
4. `docs/adr/0002-github-releases-and-signed-updater.md`；
5. 本计划；
6. `SECURITY.md`、仓库 `AGENTS.md`；
7. 当前源码和 `README.md`，它们只代表实施前基线，不覆盖上述目标。

新窗口直接实施，不重新发明产品方向。只有 GitHub 未登录、最终 owner 无法确定、必需文件缺失、公开仓库/发布 Release 等外部写操作缺少当下授权，或权威资料冲突时才停下来问用户。

## 2. 已封板产品决策

### 2.1 产品与品牌

- 产品长期只做 Cursor，不抽象成多 Provider。
- 英文名 `Cursor Usage Viewer`；中文名/副标题 `Cursor 额度查看器`。
- GitHub 仓库名 `cursor-usage-viewer`，归属用户个人 GitHub 账号。
- MIT 许可证。
- 使用原创中性“额度/光标”图标；不得使用 Cursor 官方 Logo。
- README、About 页和 Release 标注：本项目为非官方社区工具，与 Cursor/Anysphere 无隶属或背书关系。
- 首版界面维护简体中文和英文；README、更新说明与安全说明有中英入口。其他语言由社区后续贡献。

### 2.2 发布与支持

- 本地与私有 GitHub 仓库完成清密、三平台构建和验收后，再公开并发布 `v0.1.0`。
- 只维护 stable，不做 beta/nightly。
- `v*` 标签只生成 Draft Release；全部资产、签名、清单、校验和和验证通过后由用户人工发布。
- 任一必需平台失败，Draft 不得发布为 stable。
- Issues 和外部 PR 开放；提供模板、贡献指南和私密漏洞报告；首版不开 Discussions。
- 以 Cursor 最新稳定版为主要验收目标。上游变化时尽力通过补丁修复，不承诺旧版长期兼容。

### 2.3 平台、签名与安装包

- Windows、macOS、Linux 同时首发。
- 参考 Cockpit 发布矩阵：Windows x86_64 的 NSIS（current-user）和 MSI；macOS Apple Silicon/Intel 更新包和 Universal 手动包；Linux x86_64/aarch64 的 AppImage、deb、rpm。
- 首版不购买 Windows 代码签名，也不配置 Apple Developer ID/notarization；接受 SmartScreen/Gatekeeper 提示并在下载文档说明。
- Tauri updater 签名强制启用。它与操作系统代码签名不同：公钥嵌入应用，私钥只进入 GitHub Actions Secrets 和离线备份。

### 2.4 Cockpit 行为优先规则

用户已明确“Cockpit 有明确做法的相关功能照其行为与结构实现”。账号页、导入导出、分页、关闭到托盘、设置分层和更新状态机以固定提交为行为真源，不再作为开放产品问题。

明确不复制：

- Cockpit 源码、workflow、CSS、图标、品牌、文案或可识别表达；
- 与本工具无关的 Provider、切号、注入、多开、OAuth、API 中转、远程配置、公告和额度后台刷新；
- 已确认的安全缺陷，例如删除账号后遗留含 Token 的 `.json.bak`、日志写入邮箱；
- Homebrew Cask、winget、应用商店等 GitHub Releases 之外的分发；
- 任意 URL、任意命令或任意文件访问。

## 3. Cockpit 本地源码基准与 clean-room 边界

只读参考副本位于当前仓库同级目录 `../cockpit-tools-reference`，HEAD 必须是：

```text
a0508ae815e104e931dae515389e680840008367
```

若副本不存在，按固定 SHA 重新拉取；不得改用会漂移的 `main`。便携证据使用固定链接前缀：

```text
https://github.com/jlcodes99/cockpit-tools/blob/a0508ae815e104e931dae515389e680840008367/
```

Cockpit README 声明默认采用 CC BY-NC-SA 4.0，但仓库没有标准 `LICENSE` 文件且 GitHub 未识别许可证。本项目必须 clean-room：只记录输入、输出、状态、交互结果和调用顺序后独立实现；不得复制源码、样式或 workflow 文本。README 的 Credits/References 记录上游仓库和固定 SHA。

### 3.1 账号与额度参考索引

| Cockpit 文件 / 符号 | 研究行为 | 本项目落点 |
|---|---|---|
| `src/pages/CursorAccountsPage.tsx` | 工具栏、可折叠说明、网格/列表、卡片、筛选、导入、分页 | Cursor 账号页组件 |
| `src/hooks/useProviderAccountsPage.ts` | 单/批刷新、选择与导出范围、错误状态 | `src/hooks/useCursorAccountsPage.ts` |
| `src/services/cursorService.ts` | 前端到 Tauri command 边界 | `src/services/cursorService.ts` |
| `src/hooks/usePagination.ts` | 默认 20、20/50/100、页大小记忆、换页定位 | `src/hooks/usePagination.ts` |
| `src/components/PaginationControls.tsx` | 分页信息与上一页/下一页 | `src/components/accounts/Pagination.tsx` |
| `src/components/ExportJsonModal.tsx`、`src/hooks/useExportJsonModal.ts` | 默认遮罩、显隐、复制、保存、路径反馈 | Export modal 与 hook |
| `src/types/cursor.ts` | `usage-summary` 的 Total/Auto/API/On-Demand 宽松映射 | Rust model 与 view types |
| `src-tauri/src/commands/cursor.rs` | command 调用链与逐账号刷新 | Tauri commands |
| `crates/cockpit-core/src/modules/cursor_account.rs` | 本机路径、合并、文件模型、Token 续期、刷新顺序、批量串行 | `cursor_db.rs`、`storage.rs`、`provider.rs` |
| `crates/cockpit-core/src/modules/atomic_write.rs` | 临时文件、`.bak`、恢复 | `src-tauri/src/storage.rs` |
| `crates/cockpit-core/src/models/cursor.rs` | 完整账号与轻索引字段 | `src-tauri/src/model.rs` |

### 3.2 更新、托盘与发布参考索引

| Cockpit 文件 / 符号 | 研究行为 | 本项目落点 |
|---|---|---|
| `src-tauri/src/modules/update_checker.rs::UpdateSettings` | 自动检查、1 小时、自动安装、提醒、跳过、版本变化、pending notes | `src-tauri/src/updater/settings.rs` |
| `src/App.tsx` 的 `runUpdaterCheck` 与更新 effects | 启动/每小时、防重入、target、重试、静默下载、取消、重启 | `src/hooks/useAppUpdater.ts` + Rust commands |
| `src/utils/updaterRetry.ts` | 检查 800/2000/5000ms；下载 1000/2500/5000ms；错误脱敏 | `src/utils/updaterRetry.ts` |
| `src/components/UpdateNotification.tsx` | 手动检查、说明、进度、跳过、取消、重试、详情、浏览器兜底 | `UpdateDialog.tsx` |
| `src/components/SilentUpdateToast.tsx` | 静默下载后的“稍后/重启” | `UpdateReadyToast.tsx` |
| `src/components/VersionJumpNotification.tsx` | 更新后首次启动说明 | `VersionChangedDialog.tsx` |
| `src/pages/SettingsGeneralPanel.tsx` | 自动安装、提醒、语言、关闭行为 | Settings General tab |
| `src/pages/SettingsPageView.tsx` | About 版本、检查、历史 | Settings About tab |
| `src/components/layout/SideNav.tsx` | 底部设置入口 | 本项目 SideNav |
| `crates/cockpit-core/src/modules/config.rs::default_close_behavior` | 默认关闭时询问 | desktop config |
| `src-tauri/src/lib.rs` 的 `WindowEvent::CloseRequested` | 最小化到托盘 / 退出 / 询问 | 本项目 `lib.rs` |
| `src/i18n/index.ts`、`src/locales/*` | i18next、保存语言、按需资源 | 本项目 i18n 与两份 locale |
| `src-tauri/src/modules/linux_updater.rs` | AppImage/deb/rpm 识别、target、签名、提权安装 | `src-tauri/src/updater/linux.rs` |
| `src-tauri/tauri.conf.json` | bundle、updater 公钥、动态 target endpoints | 本项目 Tauri config |
| `.github/workflows/build-matrix.yml` | 多平台 CI 平台/架构事实 | 独立编写 `ci.yml` |
| `.github/workflows/release.yml` | 版本校验、平台 job、汇总、SHA256、完整清单 gate | 独立编写 `release.yml` |
| `scripts/release/stage_release_assets.cjs` | 资产白名单和稳定命名 | `stage-assets.mjs` |
| `scripts/release/build_target_latest_json.cjs` | target manifest 与签名配对 | `build-target-manifests.mjs` |
| `scripts/release/build_merged_latest_json.cjs` | 合并 `latest.json` | `build-latest-manifest.mjs` |
| `scripts/release/verify_published_updater_manifests.cjs` | 清单、签名、URL、资产验证 | `verify-manifests.mjs` |

Cockpit 当前 workflow 会在平台未全部完成前提前公开 staged release，并含 Homebrew 更新；本项目不照搬。用户已选择 Draft + 人工发布，因此所有平台先上传 Draft，完整验证后才公开。

### 3.3 官方实现资料（不再临时搜索替代）

- Tauri GitHub 发布流水线：<https://v2.tauri.app/distribute/pipelines/github/>
- Tauri Updater：<https://v2.tauri.app/plugin/updater/>
- Tauri Windows 安装器：<https://v2.tauri.app/distribute/windows-installer/>
- Tauri Windows 代码签名：<https://v2.tauri.app/distribute/sign/windows/>
- 官方 `tauri-action`：<https://github.com/tauri-apps/tauri-action>
- GitHub CLI 创建仓库：<https://cli.github.com/manual/gh_repo_create>
- GitHub Rulesets：<https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets>
- GitHub immutable releases：<https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases>
- GitHub artifact attestations：<https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations>
- GitHub private vulnerability reporting：<https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting>

实现时优先使用这些官方资料核对当前参数；Cockpit 本地源码只决定产品行为和已验证的目标映射，不覆盖官方 API/Action 语法。

## 4. 当前仓库基线与必须复用的实现

当前仓库没有 `.codegraph/`。不要引入与以下模块平行的新系统：

- `src-tauri/src/cursor_db.rs`：复用 SQLite 只读访问、五个授权键、JSON 规范化和 fixture 测试；扩展 macOS/Linux 路径和输出字段，不重写读取层。
- `src-tauri/src/cockpit_import.rs`：复用 8 MiB、500 账号、字段/JWT 限制、`Zeroize`、不回显 Token 和数组测试；扩展单对象/包装层/完整字段/缓存额度/合并，不建第二套解析器。
- `src-tauri/src/provider.rs`：复用禁重定向、固定端点、敏感 Header、512 KiB、脱敏错误、wiremock、Free 和 Sand 部分失败测试；作为 Cursor 网络唯一出口，不做任意 URL fetch。
- `src-tauri/src/state.rs`：复用 Mutex 和脱敏摘要，重构为持久化服务、运行时当前账号标记和更新协调；Token 只在 Rust 持久化/请求/主动导出路径出现。
- `src/App.test.tsx`：保留一次点击查询、导入后清空、普通 DOM 无 Token、Free 缺字段不崩溃等回归意图。
- `src/styles.css`：复用深色 token、焦点、响应式和 reduced-motion；可拆 CSS，不引 UI 框架。

当前 `package.json`、Cargo 和 Tauri 都是 `0.1.0`；`bundle.active=false`，没有 updater、tray、autostart、i18n、dialog、process 或 opener。版本同步、插件初始化和 capabilities 属于本计划范围。

## 5. 账号领域模型与持久化

### 5.1 Rust 模型

在 `src-tauri/src/model.rs` 建立：

- `CursorAccountRecord`：schema version、ID、邮箱、Auth ID、name、tags、Access/Refresh Token、套餐/订阅/注册方式、auth raw、usage raw、状态、创建/使用时间、最后错误；
- `CoreUsageSnapshot`：Total、Auto、API、On-Demand 的 enabled/used/limit/remaining、周期、来源 `imported_cache | live` 和更新时间；
- `SandSnapshot`：usage、可用性、计划、access、阻塞原因、reset、更新时间和独立错误；
- `CursorAccountSummary`：轻索引，不含 Token/raw/完整额度；
- `CursorAccountView`：普通 IPC DTO，不含 Token、Cookie、auth raw；
- `BatchAccountResult<T>`：逐账号成功/失败。

所有可缺失外部值使用 `Option`；未知不等于 0。核心额度、Sand usage、Sand access 分别保存最后成功值、时间和错误。

### 5.2 数据结构

通过 `AppHandle.path().app_data_dir()` 获取：

```text
cursor_accounts.json
cursor_accounts.json.bak
cursor_accounts/<account-id>.json
cursor_accounts/<account-id>.json.bak
update_settings.json
pending_update_notes.json
updates/<version>/...
```

正式 identifier 在首次公开构建前改为 `io.github.<authenticated-owner>.cursor-usage-viewer`；公开后不得随意改动，否则会改变数据目录和更新身份。

实现 `storage.rs`：路径边界验证；同目录唯一临时文件写入/flush/原子替换；覆盖前 `.bak`；主文件损坏尝试备份；索引损坏扫描扩展名严格为 `.json` 的明细去重重建；删除同时清主文件和备份；每个对象带 `schema_version=1`；以后升级先备份再显式迁移，绝不静默清空；测试仅注入 `tempfile`。

### 5.3 身份合并

1. Auth ID：顶层 `auth_id` → `cursor_auth_raw.authId/workosId` → JWT `sub`；
2. 双方都有 Auth ID 时只按 Auth ID；只有一方有时不降级邮箱误合并；
3. 双方都无 Auth ID 时比较小写邮箱，再比较规范化 Access Token；
4. 合法稳定导入 ID 优先；缺失/冲突时由身份种子生成稳定 `cursor_<hash>`；
5. 补空字段、更新有效凭据/元数据、标签去重、创建时间取早、使用时间取晚、快照按时间取新；
6. “本机当前账号”仅是用户主动读取后的运行时标记，不跨重启。

## 6. 导入、导出与本机读取

### 6.1 粘贴导入

- 只提供输入框粘贴；不提供文件导入，不扫描 Cockpit 目录。
- 接受单对象、数组、`accounts`/`items` 包装；上限 8 MiB、500 账号。
- 保留 Auth ID、Refresh Token、套餐/订阅、时间、auth raw 和 usage raw；立即映射 `imported_cache` 并存盘。
- 重复导入 upsert/合并，不整批替换。
- 提交后无论成功失败都清空输入框；错误只报告位置/字段/原因，不回显值。
- 按 Cockpit 行为不加二次确认。账号页有可折叠说明，明确 Token 本地处理、不上传；普通 DOM 不展示 Token。

### 6.2 完整导出

- 有选择时导出当前筛选范围内选中账号；无选择时导出当前筛选结果；单卡可单独导出。
- JSON 保持 Cockpit 兼容，包含明文 Token、auth raw 和 usage raw。
- 点击导出直接打开预览，不先弹额外确认；默认遮罩全部字符串，可显隐、复制或保存。
- 原生保存对话框只允许 JSON；Rust 按账号 ID 重新生成并写用户所选路径。
- 普通 DTO 和日志不因导出能力扩大敏感字段。

### 6.3 三平台本机读取

在 `cursor_db.rs` 复用 SQLite 逻辑，只增加路径解析：

```text
Windows: %APPDATA%/Cursor/User/globalStorage/state.vscdb
macOS:   ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
Linux:   ~/.config/Cursor/User/globalStorage/state.vscdb
```

证据来自 Cockpit `cursor_account.rs::get_default_cursor_data_dir`。不存在或缺登录字段时返回“未找到本机 Cursor 登录信息”，应用仍可用粘贴账号。只读，不写回、不切号、不启动 Cursor。

## 7. 用户主动额度刷新链路

决策依据：`docs/DECISIONS.md` §D-012。单账号严格顺序：

1. JWT 不可解析或 `exp <= now + 5min`：`POST https://api2.cursor.sh/oauth/token` 条件续期；失败保存脱敏错误并继续旧 Token；
2. 可选 `POST https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta`；
3. 可选 Bearer `GET /auth/full_stripe_profile`，非 200 fallback `GET /auth/stripe_profile`，401/403 为认证错误；
4. 必需 `GET https://cursor.com/api/usage-summary`，WorkOS Cookie、Accept JSON、固定普通 User-Agent，作为四组额度与周期唯一真源；
5. 可选 `POST https://cursor.com/api/dashboard/get-sand-usage-status`；
6. 可选 `POST https://cursor.com/api/dashboard/get-sand-access-status`。

删除 `GetCurrentPeriodUsage` 常量、白名单、调用和真源测试。核心失败保留上次快照并记 `core_error`；两个 Sand 结果独立。成功或失败状态都持久化。

批量刷新按 Cockpit 逐账号 `await`；一个失败不停止后续。页面立即显示逐账号状态，无二次确认。托盘常驻和更新检查不得触发 Cursor 额度后台刷新。

非 JSON 诊断只含 HTTP 状态、规范化 Content-Type、body 长度和 `empty | html | json_like | other`；不得含正文、Token、Cookie、邮箱或完整 URL。

## 8. 最终界面与交互

### 8.1 壳层与 Cursor 页

- 窗口 1280×800，最小 900×600，居中、可缩放。
- 深色窄侧栏：原创品牌；`Cursor` 主入口；底部 `设置` 和版本/更新状态。
- 主区域只有 `Cursor` 与 `设置`，用页面枚举，不引路由库。
- Cursor 页按用户 2026-08-31 提供的 Cockpit 参考截图复刻整体结构、空间关系、密度和视觉结果，同时保持 clean-room：不得复制源码、CSS、品牌、资源或文案；详见 `docs/DECISIONS.md` §D-016。
- 顶部可折叠说明：本地明文、Token 不上传、用户主动查询；展开状态本地保存。
- 工具栏：搜索、网格/列表、套餐筛选、标签筛选/分组、排序、升降序、读取本机、粘贴导入、刷新全部、隐私模式、导出。
- 不显示 OAuth `+`、切号/注入/播放按钮或无关快捷设置。
- 先筛选/分组/排序再分页；默认 20，可选 20/50/100，页大小记忆；全选只作用当前页。
- 用户主动读取并识别的本机当前账号在筛选结果中固定置顶，优先级高于排序字段和升降序；其余账号按用户选择排序。
- “一屏展示所有数据”指单卡无需详情即可看完整指标，不承诺全部账号无滚动。

卡片顺序：复选/邮箱/当前/套餐/错误；Auth ID/标签；Total；Auto + Composer；API；On-Demand；紧凑 Sand usage/access/reset；数据来源与时间；编辑标签/刷新/导出/删除。Free 缺字段显示“暂无数据”，不伪造 0；列表视图复用同一 view model；隐私模式遮罩邮箱/Auth ID。

### 8.2 设置页

按 Cockpit 分层但只保留本项目设置：

- `常规`：语言、关闭行为、开机启动、启动后最小化、记忆窗口位置、自动检查、自动安装、更新提醒；
- `关于`：应用名、版本、非官方声明、仓库、许可证、手动检查、版本历史。

不加入网络代理、Provider 路径、额度后台刷新、远程配置或其他 Cockpit 设置。

### 8.3 推荐前端组织

```text
src/components/accounts/{AccountCard,AccountsToolbar,AccountSelectionBar,ImportAccountsModal,ExportAccountsModal,ConfirmDialog,Pagination}.tsx
src/components/layout/SideNav.tsx
src/components/updater/{UpdateDialog,UpdateReadyToast,VersionChangedDialog}.tsx
src/hooks/{useCursorAccountsPage,usePagination,useAppUpdater}.ts
src/i18n/index.ts
src/locales/{en,zh-CN}.json
src/pages/{CursorAccountsPage,SettingsPage}.tsx
src/services/cursorService.ts
src/utils/updaterRetry.ts
```

可加入 `lucide-react`、`i18next/react-i18next`；不加入全局状态库、组件框架或路由库。

## 9. 托盘、关闭与桌面生命周期

- 单实例；再次启动聚焦已有窗口，避免两个进程同时写文件。
- 系统托盘至少含“显示/隐藏”“检查更新”“退出”；托盘不展示或自动刷新 Cursor 额度。
- 默认关闭时每次询问“最小化到托盘 / 退出”，可记住；设置可改固定行为。
- 真正退出时停止定时器、关闭 updater handle、flush 设置和存储，不清空账号。
- 支持开机启动和启动后最小化，默认关闭。
- 记忆窗口位置/尺寸默认关闭；恢复时保证窗口在可见屏幕。
- 托盘运行时可继续每小时检查 GitHub 更新，但不得访问 Cursor 网络或本机数据库。

建议使用官方 Tauri single-instance、autostart、updater、process、opener、dialog 插件；每个插件只授予所需 capability。

## 10. Cockpit 同等应用更新行为

### 10.1 设置与触发

`UpdateSettings` 独立保存且不含凭据：

```text
auto_check=true
check_interval_hours=1
auto_install=false
remind_on_update=true
last_check_time=0
last_run_version=""
skipped_version=""
```

- auto-check 开启时，UI 就绪后异步立即检查，此后每小时检查；同一时刻只允许一个流程。
- 关闭 auto-check 后无启动/定时检查；手动检查始终可用。
- 自动检查无更新不打扰；有未跳过版本才提示。
- 手动检查立即开对话框，明确显示检查中、最新或失败。
- 跳过精确版本后不再自动提醒；更高版本恢复。`稍后` 只关闭当前提示，入口仍保留。

### 10.2 下载、安装与重启

- auto-install 关闭：发现版本后用户点下载，显示进度，可取消。
- auto-install 开启：Windows、macOS、Linux AppImage 静默下载；完成 Toast 提供“稍后/重启”。
- 检查重试 800/2000/5000ms；下载重试 1000/2500/5000ms。只重试临时错误，不重试签名/版本/格式错误。
- 失败显示简短错误、脱敏详情、重试和浏览器打开 GitHub Release 兜底。
- 安装期间禁止重复触发或退出到不一致状态。成功后立即重启或稍后重启。
- 安装前保存中英说明；新版本首次启动按 `last_run_version` 展示变化，随后清 pending notes。

### 10.3 平台 target

```text
windows-x86_64-nsis | windows-x86_64-msi
darwin-aarch64-app | darwin-x86_64-app
linux-x86_64-appimage | linux-x86_64-deb | linux-x86_64-rpm
linux-aarch64-appimage | linux-aarch64-deb | linux-aarch64-rpm
```

Windows 优先 bundle type，缺失时仅用 exe 目录可写性保守 fallback；macOS 按运行架构选择 `.app.tar.gz`，Universal 只用于手动下载；Linux 先看 `APPIMAGE`，再以 current executable 和 `dpkg-query -S` / `rpm -qf` 识别，未知类型只允许浏览器下载。

### 10.4 Linux deb/rpm 托管更新

独立复刻 `linux_updater.rs` 的结果和安全边界：

1. 从本项目固定 GitHub updater endpoint 获取目标清单；
2. 版本高于当前且与 expected version 一致；
3. 资产 URL 只允许本项目 GitHub Release 链路；
4. 下载到 `updates/<version>` 并发进度；
5. 用内嵌公钥验证 Tauri/minisign 签名；失败删除临时包且不执行；
6. deb 依次尝试 `pkcon install-local`、`pkexec apt install`、`pkexec dpkg -i`；rpm 依次尝试 `pkcon`、`pkexec dnf`、`pkexec yum`、`pkexec rpm -U`；
7. 提权由 OS 显示，取消属于正常失败；输出脱敏限长；
8. 仅在用户点安装后提权，成功后提示重启。

AppImage 用标准 Tauri updater；deb/rpm 即使 auto-install 开启也不静默提权，只显示一键安装入口。

### 10.5 Tauri 配置

- `bundle.active=true`；`createUpdaterArtifacts=true`；嵌入 updater public key；
- endpoint：

```text
https://github.com/<owner>/cursor-usage-viewer/releases/latest/download/latest-{{target}}.json
https://github.com/<owner>/cursor-usage-viewer/releases/latest/download/latest.json
```

只使用 Tauri metadata 判断版本，不额外轮询 GitHub Releases API。

## 11. 版本、图标与打包

- `package.json.version` 为真源；新增 `scripts/sync-version.mjs` 同步/校验 Cargo 与 Tauri。CI 不自动提交差异。
- tag 必须等于 `v${package.json.version}`，使用 SemVer。
- 原创单一高分辨率图标源生成 ICO/ICNS/PNG；验收透明边缘、16/32px、浅深任务栏。
- Windows NSIS/MSI 均安装、卸载、启动、识别 target。
- macOS Intel/Apple Silicon updater archive 正确，Universal 在两架构启动；README 说明 Gatekeeper。
- Linux 两架构 AppImage/deb/rpm 启动并识别类型；README 写依赖。
- 每个平台做一次“旧测试版 → 隔离更新源 → 新测试版”的真实安装包升级，只用假账号和隔离数据目录。

## 12. GitHub 开源仓库完整流程

### 12.1 公开前文件

新增：MIT `LICENSE`、双语 README、`SECURITY.md`、`CONTRIBUTING.md`、`CODE_OF_CONDUCT.md`、双语 CHANGELOG、`THIRD_PARTY_NOTICES.md`、Issue/PR templates、Dependabot、CI、CodeQL、Release 和发布后 smoke workflows。

README 至少含截图、平台下载表、安装警告、数据目录、明文 Token、网络端点、更新默认值、Cockpit clean-room Credits、非官方声明和贡献入口。

### 12.2 清密 gate

首次 push/public 前：

1. 扫描工作树和完整历史的 Token、Cookie、邮箱、私钥、证书、`.env`、账号 JSON、签名文件；
2. fixture 只能用明确不可用的假 JWT/邮箱；
3. `.gitignore` 增加 env、账号导出、更新私钥、证书、签名临时目录、真实响应和本地 app data；
4. 若历史泄密，停止公开；历史重写须单独获批，不能擅自 reset/clean；
5. `THIRD_PARTY_NOTICES.md` 只记录行为参考和固定 SHA，不暗示复制源码。

### 12.3 创建与配置顺序

实施阶段获得当下外部写授权后：

1. 只读确认 `gh auth status` 和个人 owner；
2. 固定 identifier `io.github.<owner>.cursor-usage-viewer`；
3. 创建 private `cursor-usage-viewer` repo，关联当前仓库并 push；
4. 配置 squash merge、自动删已合并分支、Issues 开、Discussions 关；
5. `main` ruleset：PR 必须、必需 CI、禁止 force push/删除、线性历史；owner 只保留紧急 bypass；
6. 启用 Dependabot、dependency review、CodeQL、secret scanning/push protection（套餐支持时）、private vulnerability reporting；
7. 添加 updater Secrets；运行 CI 与 Draft Release；
8. `v0.1.0` 完整后再次向用户确认公开；
9. repo 改 public，确认安全功能仍开；
10. 人工发布完整 Draft，验证公开 updater URL。

公开 repo 和发布 Release 是两次外部可见变化；执行 Agent 在发生前报告精确 owner/repo/tag。

## 13. GitHub Actions 与供应链

### 13.1 CI

`ci.yml` 触发 PR/push main/手动；同分支取消旧任务。Ubuntu 预检：`npm ci`、版本同步、locale keys、前端测试/构建、Rust fmt/test/clippy、release scripts 测试、secret/license 检查。随后 Windows/macOS/Linux unsigned bundle smoke matrix；用 CI override 关闭 updater signing，fork PR 不需要 Secrets；短期上传日志/测试报告，不发布安装包。

### 13.2 Release

`release.yml` 触发 `v*` tag 或针对 tag 手动重跑：

1. 校验 tag 与三处版本；
2. 从双语 CHANGELOG 生成 notes；
3. 创建/复用 Draft，不设 latest；
4. 并行构建 Windows x86_64、macOS aarch64/x86_64/universal、Linux x86_64/aarch64；
5. 注入 updater 私钥并生成签名；
6. 只上传白名单安装包、updater assets、`.sig`；
7. 独立脚本生成每 target manifest 和完整 `latest.json`；
8. 汇总 `SHA256SUMS.txt`；
9. 生成 artifact attestations；
10. 验证每 target 唯一资产、签名非空、版本/URL 正确、资产可经 GitHub API 下载；
11. 任一失败保持 Draft；workflow 不执行公开发布。

人工发布前：三平台全绿、资产齐、校验和/attestation、双语 notes、安装/升级 smoke、无凭据。启用 immutable releases 时必须先完整 Draft 再发布。

### 13.3 发布后验证

`release-published-smoke.yml` 在 `release.published` 只读验证 latest/target manifests、资产 URL、签名、SHA256、stable/latest 标志。失败创建维护 Issue/工作流告警，不自动删除或改写公开资产。

### 13.4 Action 安全

- 第三方 Actions 固定完整 commit SHA并旁注版本，不用浮动 tag。
- 默认 `contents: read`；发布 job 才给 `contents: write`、`id-token: write`、`attestations: write`。
- fork PR 永不获取 signing Secrets。
- 私钥/密码/未来平台证书不得打印、缓存或上传 artifact。
- 审查新增依赖 install scripts；不能盲目禁用 Tauri 必需脚本。

## 14. updater 密钥运维

1. 在受控本机生成 Tauri keypair 并设置强密码；
2. public key 写 Tauri config；
3. private key/密码分别存 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；
4. 私钥做离线加密备份；丢失将破坏已安装版本的更新信任；
5. 正反测试：正确包通过，篡改一字节必须失败；
6. 密钥轮换需单独 ADR 和兼容迁移，不在普通补丁临时决定。

## 15. 安全与隐私边界

- 启动可按设置访问本项目 GitHub updater；不得自动访问 Cursor、本机 Cursor DB 或其他服务。
- Cursor 网络与更新网络是独立 allowlist。Cursor Token/Cookie 绝不发 GitHub；GitHub 请求不携带账号凭据。
- WebView CSP 保持 `connect-src 'none'`；Cursor 与 updater 网络只经受限 Rust/Tauri 能力执行，浏览器兜底只打开本项目固定 Release 页面。
- 账号 JSON 与 `.bak` 明文保存是已确认决策；无云同步、遥测、远程日志。
- 更新清单/资产必须签名；SHA256/attestation 不能替代应用内签名。
- 无 OS 代码签名风险透明说明。
- 日志脱敏；更新错误不得记录响应正文、环境变量、用户名路径或完整命令输出。
- Linux 提权仅在用户点安装后，且目标是已验证的固定包；未知类型不执行命令。
- 测试/截图只用假账号、临时目录、mock Cursor 和测试 updater，不读取用户真实数据/剪贴板。

## 16. 实施阶段与提交边界

每阶段完成测试再进入下一阶段；用正常编辑修复，不用 reset/restore/checkout 清理。

1. **测试锁边界**：存储、导入、刷新、分页、托盘、i18n、updater 状态机。提交 `test: lock open source cursor viewer boundaries`。
2. **模型与持久化**：record、storage、schema、恢复、合并、删除。提交 `feat: add recoverable cursor account storage`。
3. **导入导出/本机读取**：扩解析器、遮罩导出、原生保存、三平台 DB。提交 `feat: support cockpit compatible account transfer`。
4. **Cursor 刷新真源**：D-012、移除旧端点、非 JSON 证据。提交 `fix: refresh cursor usage and sand per account`。
5. **账号页与 i18n**：组件、筛选、分页、视图、隐私、两 locale。提交 `feat: rebuild cursor accounts workspace`。
6. **设置/托盘/生命周期**：单实例、托盘、关闭、autostart、窗口状态。提交 `feat: add cockpit style desktop lifecycle`。
7. **updater/Linux**：官方插件、设置、targets、UI、重试/取消、版本变化、deb/rpm 安装。提交 `feat: add signed cross platform updates`。
8. **打包/版本/品牌**：bundle、identifier、图标、同步、三平台 smoke。提交 `build: enable cross platform bundles`。
9. **开源与 CI/CD**：许可证、双语文档、贡献/安全、scripts、workflows。提交 `ci: add guarded multi platform releases`。
10. **私有演练/公开**：清密、private repo、rules/secrets/security、Draft `v0.1.0`、验收，报告精确目标后再公开和发布。此阶段含外部写操作。

## 17. 验证矩阵

### 17.1 Rust

- 存储：重启、备份、索引、穿越、migration、合并、删除无残留；
- 导入：单/数组/包装、500/8MiB、边界、缓存、upsert、不泄密；
- 导出：范围、完整往返、保存取消/失败；
- 本机路径：三平台 fixture、缺文件/键；
- Cursor：七端点、禁重定向、续期、Free、200 非 JSON、Sand 部分失败；
- updater：settings migration、版本、target、manifest、篡改签名、Linux 类型、未知拒绝、固定命令参数；
- 错误/日志不含假 Token、Cookie、邮箱、正文、私钥。

### 17.2 React

- 启动恢复账号但不自动读取/刷新 Cursor；updater 独立，关闭 auto-check 后无自动更新请求；
- 单击刷新一次、立即 busy、无确认；导入清空且缓存卡片出现；
- 搜索/筛选/分组/排序、20/50/100、当前页全选、批量；
- Free/Sand 缺失；Token 不进普通 DOM；
- 导出直接进入默认遮罩，显隐/复制/保存；
- General/About、语言、关闭行为；
- 更新 latest/up-to-date/error、skip/later/cancel/retry/fallback/restart、版本变化；
- 焦点、Escape、reduced-motion、中英文不溢出。
- 固定假账号、Chromium、1280×800、确定字体/时区和禁用动画的 Playwright 截图基线；CI 像素差失败即阻塞，基线更新作为显式代码变更审核。

### 17.3 本地命令

```powershell
npm test
npm run test:visual
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
```

Release scripts 必须有 Node 单元测试。

### 17.4 三平台更新 E2E

每个平台从旧测试版连接隔离 manifest 发现新测试版，覆盖进度、取消、重试、签名失败、手动下载、重启、版本说明；Windows 分别 NSIS/MSI，macOS Intel/Apple Silicon，Linux AppImage/deb/rpm 与取消提权。测试源不发布 stable，不碰真实账号。

## 18. 最终验收

- 单卡完整展示四组额度和紧凑 Sand；多账号导入、存盘、恢复、合并、筛选、分页、刷新、删除、完整导出工作。
- 本机当前账号始终位于筛选结果第一；1280×800 截图基线通过，且用户对精确候选 tag/SHA 的新鲜截图完成人工视觉验收。自动视觉门不得冒充用户验收。
- 删除不遗留含 Token 的账号 `.bak`；普通 DTO/日志/DOM 不泄密。
- 启动不访问 Cursor/本机 DB；只按设置访问本项目 GitHub 更新源。
- Cockpit 固定刷新与 updater 行为映射有源码路径和回归测试。
- 托盘默认关闭询问；托盘不后台刷新额度。
- 简中/英文完整；原创图标与非官方声明清楚。
- 三平台资产、签名、target manifests、`latest.json`、SHA256、attestation 齐全。
- tag 只生成 Draft；任一平台失败不能发布；用户人工发布。
- repo 公开前通过工作树和完整历史清密；MIT、贡献、安全和治理文件齐全。
- `v0.1.0` 公开后 updater latest URL 可用，旧测试版可升级。
- 所有证据来自假账号、临时目录、mock Cursor 和隔离 updater，不控制用户真实应用。

## 19. 新窗口反查结论

只持有“当前仓库 + 本计划”的新 Agent 已可确定：复用模块；Cockpit 固定 SHA、具体文件/符号/行为；必须复刻与禁止复制的边界；账号、刷新、UI、分页、托盘、i18n、updater 语义；三平台安装包/签名/清单；GitHub private→public、Draft→stable 的顺序；测试、清密和权限 gate。

正常编码细节按工程和官方 Tauri/GitHub 文档处理，无需重新做重大产品决策。唯一允许的实施中阻塞是缺少 GitHub 登录/owner、外部公开或发布授权、签名私钥材料，或权威材料出现新冲突。
