# Cockpit 对齐：额度定时刷新与 Cursor 账号“+”导入流程

状态：最终封板，待实施

日期：2026-09-03

范围：Cursor 账号页的工具栏、账号导入、额度刷新设置与安全/文档同步。

## 现状与结论

- Release blocker Issue #13（`v0.1.0` 缺少 owner 验收与 updater E2E）已由仓库 owner 关闭；关闭记录不等于 stable 发布授权。
- 当前 `src/App.tsx` 的右侧工具栏把“读取本机账号”和“粘贴 Cockpit JSON”拆成两个入口，缺少 Cockpit 风格的主 `+` 入口。
- 当前应用只有手动 `refresh_cursor_account(s)`；`src/hooks/useAppUpdater.ts` 中的定时器只检查应用更新，不刷新 Cursor 额度。
- 当前后端只支持读取本机当前账号和 Cockpit JSON，尚无网页登录 OAuth/device flow 或原始 Token 导入命令。
- 当前 `src-tauri/src/lib.rs` 创建 `TrayIconBuilder` 时没有调用 `.icon(...)`；虽然 `src-tauri/tauri.conf.json` 配置了应用图标，但没有把图标绑定到托盘，因此需要一并修复“托盘无图标”。

Cockpit 固定提交中的 `useAutoRefresh` 确实包含 `cursor_auto_refresh_minutes`，并把 Cursor 的全量/当前账号刷新接入统一调度器；其调度器采用 5 秒 tick、默认单并发、错峰初始延迟和运行中任务保护。参考：[useAutoRefresh.ts](https://raw.githubusercontent.com/jlcodes99/cockpit-tools/a0508ae815e104e931dae515389e680840008367/src/hooks/useAutoRefresh.ts)、[autoRefreshScheduler.ts](https://raw.githubusercontent.com/jlcodes99/cockpit-tools/a0508ae815e104e931dae515389e680840008367/src/utils/autoRefreshScheduler.ts)。

Cockpit 固定提交的账号页使用一个主 `+` 打开添加弹层，并提供“授权登录 / Token 或 JSON / 本机导入”三类路径；本机导入同时覆盖 Cursor 客户端数据与 JSON 文件导入。参考：[CursorAccountsPage.tsx](https://raw.githubusercontent.com/jlcodes99/cockpit-tools/a0508ae815e104e931dae515389e680840008367/src/pages/CursorAccountsPage.tsx)。

## 目标交互

### 1. 右侧工具栏

将右侧操作调整为 Cockpit 的信息层级和顺序：

`+ 添加账号` → `刷新全部` → `隐私显示/隐藏` → `导出` → `设置/更多`（仅保留已有真实能力）。

删除独立的“读取本机账号”和“粘贴导入”图标；所有新增账号方式统一进入 `+`。不添加没有实际实现能力的装饰按钮。

空账号页的主 CTA 也改为 `+ 添加账号`，避免首页与工具栏出现两套入口语义。

### 2. `+` 添加弹层

弹层采用三段式选项卡，顺序与 Cockpit 对齐：

1. **网页登录**：用户主动点击后打开 Cursor 第一方授权页面；显示等待、成功、取消、超时和失败状态，可重试，不在启动时触发。
2. **Token / JSON**：按 Cockpit 行为支持粘贴单个原始 access token；需要 refresh token 或完整资料时继续使用现有 Cockpit JSON。提交后清空敏感输入，前端列表和日志只显示布尔凭据状态。
3. **本机导入**：复用只读 SQLite 读取约束；固定导入默认 Cursor `state.vscdb` 中的当前账号，并在同一 tab 提供 JSON 文件选择动作；不能通过扫描扩大读取范围。

弹层需要明确显示凭据用途和保存位置，所有路径都复用已有账号去重、持久化、错误展示和成功后列表刷新逻辑。

### 3. 额度定时刷新

新增 Cursor 专用刷新间隔设置，选项与 Cockpit 保持一致：关闭、2、5、10、15 分钟及自定义值；固定提交的默认值为 **10 分钟**。设置持久化在应用数据目录，`-1` 表示关闭。

调度器设计：

- 应用级只创建一个后端 scheduler；它隶属 Tauri 应用进程而非 React 页面，设置变更时重排任务，应用退出时停止，避免重复定时器。
- 采用 5 秒 tick、最多 1 个并发刷新；同一账号手动刷新与自动刷新互斥。
- 任务按到期时间和稳定 key 排序；初次运行错峰，避免打开应用后瞬时并发请求。
- 关闭或无账号时不发起 Cursor 请求；刷新失败只记录账号状态并允许下一周期重试，不阻塞手动操作。
- 用户确认：窗口最小化到系统托盘后，scheduler 继续运行；只有 Cursor 自动刷新间隔大于 0 时才会请求额度。
- 手动与自动刷新复用同一个 Rust 批量刷新函数和互斥协调器，不在 command 与 scheduler 中复制 Provider 调用链。
- 自动刷新完成后由 Tauri 发出只包含 `BatchAccountResult<CursorAccountView>` 的脱敏事件；前端复用现有 `replaceAccount` 更新卡片/表格，不新增包含 token 的载荷。

## 决策与安全门

这是对当前 D-012、D-014、D-017 中“无 OAuth / 无后台额度刷新”范围的用户最新变更。实施前追加 D-022 决策记录，明确：

- 自动额度刷新仅针对用户启用的 Cursor 间隔，默认 10 分钟；它与“自动检查应用更新”是两个独立设置，并在托盘运行期间保持有效。
- 网页登录严格采用固定 Cockpit 提交的 device flow：浏览器打开 `https://cursor.com/loginDeepControl`，后端 `GET https://api2.cursor.sh/auth/poll?uuid=...&verifier=...` 每 2 秒轮询，最多 300 秒；不使用任意回调 URL、重定向或第三方 OAuth 服务。
- 网页登录获得的凭据只在 Rust 中进入现有 `AppState::upsert`/`AccountStore` 持久化；前端仅接收脱敏视图。禁止 token、PKCE verifier 或完整轮询 URL 进入普通 DTO、日志、错误、测试快照或 DOM 持久化。
- 本机导入固定为当前默认 Cursor `state.vscdb` 账号；仍然只读打开、只读取白名单 key，不扫描账号集合或写回 Cursor 数据库。

实现时必须把上述两个 HTTPS 端点加入生产 allowlist，并把 `cursor.com/loginDeepControl` 加入 Tauri opener 的精确 URL 权限；若固定源码、allowlist 或当前 Cursor 行为发生冲突，暂停实现并让 owner 决定，不能用猜测的 URL 代替。

依据：[`docs/DECISIONS.md`](../DECISIONS.md) §D-011、§D-012、§D-014、§D-016、§D-017；[`docs/UPSTREAM_COCKPIT_UI.md`](../UPSTREAM_COCKPIT_UI.md)。

## 实施分阶段计划

### Phase 0：基线与决策

- 固定并记录 Cockpit 提交、实际来源文件、端点和默认配置（Cursor 默认 10 分钟）。
- 追加 D-022；同步更新 `docs/UPSTREAM_COCKPIT_UI.md` 的产品适配说明，明确用户已批准 OAuth、自动刷新和托盘行为。
- 本机导入按固定提交的 `read_local_cursor_auth`/`import_from_local` 语义只导入当前账号；网页登录按 2 秒轮询、300 秒过期、可取消实现。

### Phase 1：设置与调度器

- 当前仓库没有通用 GeneralConfig；沿用 `src-tauri/src/desktop.rs`、`src-tauri/src/updater.rs` 的 `read_json_with_backup`/`write_json_atomic` 模式，新建独立 Cursor 设置存储 `cursor_settings.json`（schema 1，整数字段 `autoRefreshMinutes`；`-1` 关闭，正整数至少为 2，预设为 2/5/10/15），新增 `get_cursor_settings`/`save_cursor_settings` 命令并在 Rust 侧校验范围。
- 复用固定提交 `autoRefreshScheduler.ts` 的行为契约（5 秒 tick、单并发、稳定 key 错峰、stop 清理），但在 Rust/Tauri 应用进程实现，避免隐藏 WebView 对 JavaScript timer 的节流；不要复用 `useAppUpdater` 的前端 interval。
- `AppState` 持有内存中的 Cursor 设置和唯一 scheduler 控制句柄；`save_cursor_settings` 原子落盘成功后通知 scheduler 重排。启动时从设置存储恢复，退出时取消任务。
- 把 `refresh_cursor_accounts` 的现有逐账号刷新提取成后端共享函数，命令和 scheduler 都调用它；共享运行锁确保自动/手动批量刷新不会重叠。
- 先接入现有 `src/components/settings/SettingsPage.tsx` 的“应用设置”分组；仓库没有 QuickSettingsPopover，不新增第二套设置 UI。工具栏齿轮只是跳转现有设置页。

### Phase 2：账号添加后端

- 扩展 `src-tauri/src/provider.rs` 和命令层，加入经决策批准的 Cursor device flow（`loginDeepControl` + `auth/poll`）与单 access-token 建档路径；不要引入 Cockpit 其他 provider 的 OAuth 代码。`auth/poll` 带受控 query，必须新增专用校验器，不能放宽现有禁止所有 query 的额度端点 `validate_production_endpoint`。
- 扩展 `src-tauri/src/cursor_db.rs` 时保持只读、白名单 key 和不复制数据库约束。
- JSON 文件导入复用现有 `cockpit_import::parse_cockpit_accounts_json`、8 MiB/500 账号限制和 `AppState::import`；前端用现有 dialog plugin 选择单个 `.json` 路径，再调用新增 Rust 命令先检查文件类型/大小、再从该精确路径限长读取。不要新增通用文件系统插件权限。
- 在 `src-tauri/capabilities/default.json` 增加 `dialog:allow-open`，并为 opener 增加只匹配 `https://cursor.com/loginDeepControl` 及其受控 query 的 scope；打开前再次验证 scheme、host、path 以及仅允许 `challenge`、`uuid`、`mode=login` 参数，不开放任意 URL。
- `src/services/cursorService.ts` 只暴露 typed、脱敏返回值；统一复用现有 upsert、去重、刷新和错误映射。

### Phase 3：账号添加前端与工具栏

- 从 `src/App.tsx` 拆出可测试的 Add Account modal，复用 `Modal`/`useDialogFocus` 的焦点圈定、Esc 和焦点返回行为；工具栏改为单一 `+` 主入口。
- 右侧固定顺序为 `+`、刷新全部、隐私显示/隐藏、导出、齿轮；齿轮跳转现有设置页。移除独立本机读取/JSON 导入图标。
- 完成键盘焦点、Esc 关闭、取消中止、敏感字段清空、中文/英文长文案和深浅主题布局。
- 修复 `src-tauri/src/lib.rs` 的托盘初始化：复用 `app.default_window_icon().unwrap().clone()` 传给 `TrayIconBuilder::icon(...)`，保留现有显示/隐藏、更新和退出菜单；应用图标资源继续由 `tauri.conf.json` 提供。

### Phase 4：契约、视觉与文档

- 新增行为契约测试：刷新关闭不请求、默认 10 分钟、周期触发、托盘隐藏仍运行、单并发、手动/自动去重、退出清理、设置热更新、失败重试、脱敏事件；三种导入路径的成功/失败/取消/超时及敏感数据清理。
- 更新 `src/App.test.tsx`、新增 scheduler/provider command tests；更新 `tests/visual/accounts.spec.ts` 覆盖工具栏、三种弹层 tab、窄窗口、深色/浅色和中英文。
- 增加 Tauri 启动/集成 smoke 验证，确认 TrayIconBuilder 绑定非空图标；Windows 实机验收托盘区可见图标、菜单、恢复窗口，以及窗口隐藏时自动刷新仍继续。
- 运行 `npm run test:visual` 并人工检查 actual/diff；同时运行既有前端、Rust、build、fmt、clippy、凭据扫描。
- 同步 `README.md`、`SECURITY.md`、`CONTEXT.md`、`docs/RELEASING.md` 和相关本地化文案，删除与新行为冲突的“永不后台刷新”描述。

### Phase 5：提交与发布前收尾

- 按“决策/设置 → 调度器 → 后端导入 → 前端 UI → 测试文档”拆分提交，保持每个提交可回滚。
- 重新检查完整 diff 和调用链；若改变网络端点或凭据流，先完成决策记录再合并。
- 生成新的候选版本和 Draft；不把自动化通过当作 owner 的产品验收或 stable 发布授权。

## 验收标准

- 工具栏只有一个清晰的 `+` 新增账号入口，按钮顺序、间距、禁用态和反馈与 Cockpit 适配后的真实能力一致。
- `+` 弹层三种路径均可完成或安全取消；原始 token 不出现在列表、日志、错误和测试快照。
- 关闭自动刷新时零后台 Cursor 请求；启用后按设置周期刷新，最多一个并发，手动刷新不会重复打请求。
- 本机读取仍是只读和白名单 key；启动应用不会隐式读取 Cursor 数据。
- 深浅主题、主要窗口尺寸、中英文长文案均无裁切、错位或遮挡；视觉基线差异均能解释。
- 文档、决策、设置默认值、网络 allowlist、测试和发布说明互相一致。

## 已封板的关键决策

1. 自动刷新默认 10 分钟；用户可关闭或选择 2/5/10/15 分钟及自定义值；应用最小化到托盘后继续运行。
2. 网页登录按 Cockpit 固定 device flow 实施：`loginDeepControl` 浏览器页 + `api2.cursor.sh/auth/poll` 轮询，2 秒间隔、300 秒超时、可取消。
3. 本机导入只导入默认 Cursor `state.vscdb` 当前账号；JSON 文件导入作为同一 tab 的独立动作。
4. 刷新设置放入现有设置页；不新建 Quick Settings 体系。
5. 托盘图标使用 Tauri 默认窗口图标显式绑定到 `TrayIconBuilder`；这是本轮新增 BUG 修复项。
