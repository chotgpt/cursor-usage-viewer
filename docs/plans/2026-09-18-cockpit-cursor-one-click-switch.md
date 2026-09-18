# Cockpit Cursor 一键切号实施计划（最终封板）

## 目标与固定口径

在 Windows、macOS、Linux 定向移植 Cockpit Tools 固定提交
`a0508ae815e104e931dae515389e680840008367` 的 Cursor 账号页 Play
一键切号能力。只实现默认 Cursor 实例，不引入多开实例页、其他 Provider、
sidecar、任意命令执行或 Cockpit 品牌资源。

已由 owner 明确确认：

- 点击 Play 后不二次确认。
- 卡片和列表的 Play 均位于账号操作区最左侧；当前账号也允许再次切换。
- Windows 严格采用 Cockpit 的 `taskkill /PID … /T /F`，访问被拒时提供仅限
  已验证 Cursor PID 的 UAC 提权重试；必须在 UI/安全文档中说明未保存内容可能丢失。
- 账号缺少 Refresh Token、套餐或订阅状态时，严格沿用 Cockpit 语义：
  不写该键，也不删除 Cursor 数据库中的旧值。
- 账号缺少邮箱时，严格沿用 Cockpit Token 导入习惯，向
  `cursorAuth/cachedEmail` 和 `cursor.email` 写入 `unknown`。
- “当前”表示上次由本应用主动读取或切换的账号并持久化；重启后继续显示。
  这可能在用户随后直接于 Cursor 内切号后过期，本应用不得为校准它而在启动时
  自动读取真实 `state.vscdb`。

“完整复刻”指上述可见结构、状态转换、写库、默认实例关闭/重启、路径恢复和
Windows 错误恢复语义；允许做不改变外部行为的安全加固，例如 SQLite 单事务和
更窄的 UAC 进程白名单。

## 实施前读取与保护规则

1. 先读 `AGENTS.md`、`docs/DECISIONS.md`、`SECURITY.md`、`CONTEXT.md`、
   `docs/UPSTREAM_COCKPIT_UI.md` 以及本计划；检查 `git status`/`git diff`，
   把未提交文件视为用户工作。
2. 当前工作区已有 D-032“单行 `user_id::JWT` 网页 Token 导入”改动。不得覆盖、
   回退或重写以下实现和测试：
   - `src-tauri/src/cursor_oauth.rs` 的 `normalize_access_token_input` 及其测试；
   - 当前已显示为 modified 的 `src-tauri/Cargo.toml`，先核对实际 diff/行尾状态，
     再加入本功能依赖，禁止整文件覆盖；
   - `src/components/accounts/AddAccountModal.tsx` 及测试；
   - `src/App.tsx` 的 `addWithTokenOrJson`、`src/App.test.tsx` 对应测试；
   - `tests/visual/accounts.spec.ts` 的单行网页 Token 断言和
     `cursor-add-account-token-dark-chromium-win32.png` 基线；
   - `docs/DECISIONS.md`、`SECURITY.md`、`CONTEXT.md`、
     `docs/UPSTREAM_COCKPIT_UI.md` 中的 D-032 文案。
   此列表只是计划封板时已观察到的文件，不替代实施开始时重新检查完整工作区。
3. 修改 Cockpit 派生区域前，重新读取固定提交中的实际文件，不得只依赖本计划：
   - `src/pages/CursorAccountsPage.tsx`
   - `src/hooks/useProviderAccountsPage.ts`
   - `src/services/cursorService.ts`
   - `src/App.tsx`
   - `src/components/WindowsOperationDialog.tsx`
   - `src/utils/windowsOperationDialog.ts`、`windowsOperationError.ts`
   - `src-tauri/src/commands/cursor.rs`
   - `src-tauri/src/modules/cursor_account.rs`
   - `src-tauri/src/commands/cursor_instance.rs`
   - `src-tauri/src/modules/cursor_instance.rs`
   - `src-tauri/src/modules/process_{close_lifecycle,detection_matching,editor_launch,launch_candidates,path_resolution}.rs`
   - `src-tauri/src/modules/provider_current_state.rs`
   - `src-tauri/src/modules/windows_operation.rs`
   - `src-tauri/src/commands/system_app_commands.rs`
   - `src-tauri/Cargo.toml`
4. 未经 owner 另行明确授权，开发和测试不得读取真实 Cursor 数据库、枚举/关闭/
   启动真实 Cursor、使用真实凭据联网或更新未知视觉基线。

## 1. 先更新决策、边界与来源记录

在 `docs/DECISIONS.md` 追加下一个可用决策编号（不要覆盖 D-032），只建立窄例外：

- D-003 的现有导入读取路径继续严格只读；只有新的、由用户点击 Play 触发的
  注入函数可对默认 `state.vscdb` 进行精确写入。
- 窄范围取代 D-001、D-011、D-016、D-017、D-022 中与默认实例一键切号直接
  冲突的句子；其他 Provider、无关权限、自动读取、多开和任意启动仍禁止。
- 记录本计划“目标与固定口径”中的四项 owner 决定，以及切号的部分成功语义。
- 记录测试只能使用假账号、临时 SQLite 和 fake 进程层。

同步更新 `AGENTS.md`、`SECURITY.md`、`CONTEXT.md`、`README.md`、
`CHANGELOG.md`、`docs/UPSTREAM_COCKPIT_UI.md`。来源记录必须列出固定提交、
上节实际参考文件、本项目对应文件和安全性改动；明确 CC BY-NC-SA 4.0
定向移植，不引入其他 Cockpit 模块或品牌资源。

## 2. 复用现有存储，增加最小运行时状态

### 2.1 用户设置

- 扩展 `src-tauri/src/cursor_settings.rs` 的 `CursorSettings`，增加
  `cursor_app_path`，继续复用 `CursorSettingsStore`、
  `read_json_with_backup`、`write_json_atomic` 和 `.bak` 恢复。
- 新字段使用 serde 默认值兼容现有 `cursor_settings.json`；只有确有不兼容迁移
  时才升级 schema，不因简单可选字段盲目升级。
- 增加锁内字段 patch 方法。路径弹层只更新路径，自动刷新设置只更新间隔，
  防止两个界面用旧的完整对象互相覆盖。
- `DesktopSettingsStore` 只管理本应用窗口/关闭行为，不用于 Cursor 路径。

### 2.2 当前账号、默认绑定和 PID

- 新增职责单一的 `src-tauri/src/cursor_runtime.rs`，存储
  `current_account_id`、`default_bind_account_id`、`last_pid`，但复用
  `storage.rs` 的原子写入和备份恢复，不另造通用存储框架。
- `AppState::new` 从运行时状态恢复 `current_id`；ID 不存在时清理悬空值。
- `load_current_cursor_account` 在用户主动读取成功后同步持久化当前 ID。
- 切号首次注入成功后持久化当前 ID和默认绑定；即使后续缺路径、关闭失败或启动
  失败，也保留 Cockpit 的“已经切换/绑定”的部分状态。
- `AppState::delete`/`delete_many` 清理指向被删账号的当前 ID和默认绑定；
  `last_pid` 绝不能作为直接终止依据，使用前必须重新验证进程。
- 不得把现有 `select_cursor_account` 当成真实切号；可保留原命令，但 Play 只能走
  新的完整编排。

## 3. 精确且隔离的 SQLite 注入

在 `src-tauri/src/cursor_db.rs` 保持现有
`read_cursor_account`/`read_default_cursor_account` 只读不变，新增命名明确的写入
函数：

- 仅打开已存在的默认数据库，使用 `READ_WRITE | NO_MUTEX`，不得带 `CREATE`、
  复制数据库或修改 journal mode；设置有界 `busy_timeout`。
- 使用单个 `TransactionBehavior::Immediate` 事务和参数化
  `INSERT OR REPLACE INTO ItemTable (key, value)`。这是不改变最终成功行为的
  原子性加固。
- 始终写入：
  - `cursorAuth/accessToken`
  - `cursorAuth/cachedEmail`
  - `cursor.accessToken`
  - `cursor.email`
- 仅在账号字段存在时写入，缺失时严格保留旧值：
  - `cursorAuth/refreshToken`
  - `cursorAuth/stripeMembershipType`
  - `cursorAuth/stripeSubscriptionStatus`
- 不写 `cursorAuth/authId`、`cursorAuth/cachedSignUpType` 或其他键。
- 邮箱缺失时两个邮箱键写字面值 `unknown`；Access Token 为空则在写库前失败。
- 错误、日志、DTO、事件不得包含 Token、邮箱、SQL 值或数据库内容。

## 4. 默认 Cursor 进程、路径与启动

新增小型 `src-tauri/src/cursor_launch.rs`。仓库没有可复用的外部应用进程层，因此
该文件是必要新抽象；不要移植 Cockpit 的通用 Provider/多开进程框架。

### 4.1 可测试边界

- 定义一个最小 `CursorProcessOps`（或等价窄接口），覆盖路径检测、进程快照、
  终止、等待和启动；生产实现只在命令编排层注入。
- 将平台命令构造和进程匹配写成纯函数，fake 可覆盖三平台；20 秒等待使用 fake
  clock/sleeper，单测不得真实等待或控制进程。
- 阻塞的 SQLite/枚举/等待/spawn 编排放入 `spawn_blocking`；不得持有
  `AccountStore`、设置锁或 `refresh_gate` 等待进程退出。
- 使用独立 `switch_gate` 防止两个切号并发。关闭后第二次注入前重新从
  `AccountStore` 读取账号，以吸收并发刷新得到的新凭据。

### 4.2 路径检测与验证

- 默认数据目录：
  - Windows `%APPDATA%\Cursor`
  - macOS `~/Library/Application Support/Cursor`
  - Linux `~/.config/Cursor`
  数据库路径继续由 `cursor_db::default_cursor_database_path` 作为唯一真源。
- 检测候选与 Cockpit 一致：
  - Windows：已验证运行中 Cursor 路径、
    `%LOCALAPPDATA%\Programs\Cursor\Cursor.exe`/`Electron.exe`；
  - macOS：`/Applications/Cursor.app/Contents/MacOS/Cursor` 或
    `Electron`，再回退到 `ps`；
  - Linux：`/usr/bin/cursor`、`/opt/cursor/cursor`。
- 保存前按平台验证目标存在且确为 Cursor；macOS 同时接受 `.app` 根和其
  `Contents/MacOS` 可执行文件并规范化。拒绝任意命令、参数和非 Cursor 目标。
- Windows 提供运行中候选扫描（2 秒上限）供弹层选择；其他平台提供单一自动检测。

### 4.3 进程范围和关闭

- 只匹配已配置/已检测 Cursor 启动路径对应的主进程，排除 renderer、GPU、
  utility、crashpad、sandbox、`--type=` 等 helper。
- 只关闭默认 `--user-data-dir` 的进程；未显式带该参数的 Cursor 主进程在目标
  是默认目录时视为默认实例。其他自定义 user-data-dir 实例保持运行。
- `last_pid` 只有在可执行路径和默认 profile 再验证通过后才优先处理。
- Windows：`taskkill /PID <pid> /T /F`，隐藏控制台，最多等待 20 秒。
- macOS/Linux：发送 SIGTERM，最多等待 20 秒；严格复刻，不增加 SIGKILL 回退。
- Windows 拒绝访问时返回 `WINDOWS_OPERATION_ERROR:` 前缀的脱敏结构化错误，
  携带稳定错误码和 PID；UAC 命令最多接受 32 个 PID，并再次验证它们属于
  当前配置的 Cursor 可执行路径/默认 profile，禁止 Cockpit 的其他应用白名单。

### 4.4 启动

- 启动参数固定为 `--user-data-dir <默认目录> --new-window`，不接受前端任意参数。
- Windows/Linux 直接执行已验证可执行文件；Windows 使用
  `CREATE_NO_WINDOW`，三端 stdin/stdout/stderr 均置空。
- macOS 使用 `open -n -a <Cursor.app> --args ...`，移除
  `__CFBundleIdentifier`/`XPC_SERVICE_NAME` 后启动。
- 成功后只保存经重新验证的 PID；不得添加 shell 插件、sidecar 或前端执行权限。
  `src-tauri/capabilities/default.json` 保留现有文件选择权限即可。
- 依赖只加入固定源码实际需要的 `sysinfo`，以及 Windows 目标专用、最窄 feature
  集的 `windows` crate；先核对 Rust `1.77.2`/锁文件兼容，不复制上游无关依赖。

## 5. Tauri 编排与精确失败语义

在 `src-tauri/src/lib.rs` 注册并由 `src/services/cursorService.ts` 包装：

- `inject_cursor_account(account_id)`
- `start_default_cursor_instance()`
- `get/detect/scan/save_cursor_app_path`
- `windows_elevated_close_cursor_processes(pids)`（Windows 有效）

`inject_cursor_account` 的顺序必须锁定为：

1. 读取所选账号并校验 Access Token；
2. 首次事务注入默认 `state.vscdb`（Cursor 此时可能仍运行）；
3. 持久化当前账号和默认绑定；
4. 校验启动路径；
5. 关闭已验证的默认 Cursor 实例，最多 20 秒；
6. 从账号存储重新读取所选账号并再次注入；
7. 以默认目录和 `--new-window` 启动并保存 PID。

返回脱敏 tagged DTO（至少含 `account` 和
`launchStatus: launched | pathRequired | launchFailed`），同时保持 Cockpit 的
外部语义：

- 首次注入失败：硬失败，不更新当前/绑定，不关闭 Cursor。
- 路径缺失：首次注入和当前/绑定已经完成；发出
  `app:path_missing { app: "cursor", retry: { kind: "default" } }`，命令按软成功
  返回，Cursor 不被关闭。
- spawn 失败且错误为“启动 Cursor 失败”：按软成功返回；当前/绑定和数据库写入
  保留。
- 关闭失败或第二次注入失败：硬失败，但不得回滚已经完成的首次注入及持久状态。
- 路径弹层保存后只调用 `start_default_cursor_instance`；该命令按持久化绑定执行
  “关闭 → 重新读取账号 → 注入 → 启动”，不得重复提交前端凭据。

## 6. UI 定向接入，复用现有模式

### 6.1 Play 与当前状态

- 在 `src/App.tsx` 内现有 `AccountCard`、`AccountTable` 增加 `onSwitch`，使用
  lucide `Play`；顺序固定为 Play → Tag → Refresh → Export → Delete。
- 类名沿用 Cockpit：Play 使用现有按钮尺寸并增加 `success` 状态；目标账号忙碌时
  用 `RefreshCw` + `loading-spinner`，不是新增图标体系。
- 复用现有消息、本地化函数、`busyRef` 防重复思想，但保留独立
  `injectingAccountId`，不要新建全局状态库：
  - 任一切号进行中，所有 Play 禁用；
  - 目标 Play 显示 busy；
  - banned/forbidden/suspended/disabled 账号禁用并显示现有封禁说明；
  - 当前账号仍可点击；
  - 不改变 Refresh/Export/Delete 原有并发与禁用语义。
- 成功或软成功后重新调用 `listAccounts`（或按返回 ID 原子 remap 全列表），确保
  旧账号清除 `isCurrent`、目标账号置顶；不得只 `replaceAccount` 导致两个
  Current。
- 普通成功和路径缺失软成功都显示 Cockpit 的“已切换”消息；路径缺失同时打开
  恢复弹层。硬失败显示脱敏失败消息。

### 6.2 路径恢复与设置

- 使用现有 `.modal-*` 样式和 `useDialogFocus` 实现一个聚焦的账号页路径弹层
  （可放 `src/components/accounts/CursorPathDialog.tsx`）；不要引入新的通用
  Modal 框架或 Quick Settings。
- 弹层包含当前路径、手动选择、自动检测、Windows 运行候选、保存并重试、取消、
  inline error；busy 时禁止关闭，支持 Esc、焦点归还和中英文长文案。
- 在现有 `SettingsPage.tsx` 的 Cursor 设置组增加同一启动路径编辑入口；这是
  Cockpit 固定提交已有设置能力在本项目 Settings 架构中的定向落点。

### 6.3 Windows 操作错误

- 以本地 React state + 现有 modal/focus 模式实现最小 Windows 操作错误弹层，
  不为此新增 Zustand。
- 解析 `WINDOWS_OPERATION_ERROR:`；提供取消、重试、受限 UAC 授权后重试和脱敏
  详情。复制详情不得含 Token、邮箱、完整命令行或数据库值。

### 6.4 样式与文案

- `src/cockpit-derived.css` 继续使用卡片 32px、列表 24px 按钮；只补
  `success`、busy、disabled、focus 和五按钮后的 action 列宽/窄屏布局。
- 更新页面隐私说明：Play 会覆盖默认 Cursor 登录状态并强制关闭/重启默认实例；
  Windows 未保存内容可能丢失。
- 卡片/列表文案继续按当前工程的 inline `l(zh, en)` 惯例；设置页公共文案按现有
  locale 结构，不混造第三套 i18n。

## 7. 失败先行契约测试

### Rust

- `cursor_db.rs` 临时 SQLite：
  - 精确四个必写键和三个条件键；
  - 缺失可选字段保留旧值；
  - 缺失邮箱写 `unknown`；
  - 单事务回滚、无 CREATE、缺表/缺文件失败、无关键不变；
  - 原只读导入测试继续证明不会写库。
- `cursor_runtime.rs`/`cursor_settings.rs` 临时目录：
  - 旧 JSON 兼容、`.bak` 恢复、字段 patch 不丢更新；
  - 当前/绑定重启恢复、悬空 ID 修复、删除账号清理；
  - 原 `restart_restores_accounts_but_not_runtime_current_marker` 改为新决策对应契约，
    不能简单删除。
- `cursor_launch.rs` fake：
  - 三平台 argv/env/隐藏窗口；
  - 默认 profile 匹配、helper/其他 profile 排除、PID 重用拒绝；
  - Windows `/T /F`、Unix SIGTERM、20 秒超时；
  - 路径候选、验证和 macOS `.app` 规范化；
  - UAC PID 数量/路径/profile 白名单；
  - 成功、缺路径、关闭失败、二次注入失败、spawn 失败的精确顺序和部分状态；
  - 测试不得真实枚举、终止或启动进程。

### React/Vitest

- 扩展 `src/App.test.tsx` 的 invoke mock，未知命令仍失败。
- 锁定网格/列表 Play 最左顺序、当前账号可点、封禁账号不可点、全局 Play busy、
  目标 spinner、调用参数和重复点击抑制。
- 锁定成功后只有目标账号 Current 且置顶；重启加载持久 Current。
- 锁定路径事件 → 弹层 → 选择/检测/保存 → 仅重试启动。
- 锁定软成功、硬失败、Windows 结构化错误/UAC 重试及 DOM/错误不含凭据。
- D-032 单行网页 Token、五按钮页面工具栏、刷新/导出/删除等现有契约必须继续
  通过；页面工具栏的“五按钮”与账号卡片新增第五个 action 不得混淆。

### Playwright 视觉

扩展 `tests/visual/accounts.spec.ts` 的 mock，不触碰真实 Cursor。至少覆盖：

- 深/浅主题，中文/英文；
- 网格/列表，1280×800 与 900×600；
- Play 默认、封禁、全局 busy；
- 路径缺失默认态、Windows 候选展开、inline error；
- Windows 操作错误弹层；
- Settings 启动路径行；
- 原有 privacy/status/error/tag-group/refresh-busy 页面回归。

运行 `npm run test:visual` 后先人工查看 actual/diff；只有差异完全来自本功能且
布局、密度、长文案和焦点状态合格时才审核更新基线，不得用
`--update-snapshots` 掩盖未知差异。

## 8. 验证与完成定义

本地自动验证：

```text
npm test
npm run test:visual
npm run build
npm run test:release
npm run check:version
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
node scripts/credential-pattern-gate.mjs
git diff --check
```

CI 必须通过 `.github/workflows/ci.yml` 的 Windows 完整测试和
Windows/macOS/Ubuntu `tauri build -- --no-bundle` 矩阵；平台条件代码至少在各
runner 编译。自动化只能证明 fake/构造契约。

交付前用固定 Cockpit 源码、当前实现、行为测试和真实截图四方交叉核对。owner
需在隔离测试账号上分别人工验收 Windows、macOS、Linux：

1. Play 无确认；
2. 默认 Cursor 被精确关闭，其他 profile 不受影响；
3. 目标账号七键语义正确并以 `--new-window` 启动；
4. 缺路径可恢复并只重试启动；
5. Windows 强杀风险提示和 UAC 重试有效；
6. 应用重启后上次切换账号仍为 Current；
7. 账号删除、失败/部分成功、D-032 导入和自动刷新均无回归。

owner 未完成真实三平台验收前，只能报告实现和自动门禁完成，不得声称产品已验收
或 stable 可发布。
