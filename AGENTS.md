# Cursor 额度查看器仓库规则

## 适用范围

本文件适用于整个仓库。产品语义与安全边界以 `docs/DECISIONS.md` 为准。

## Cockpit 固定提交本地源码

只读参考在 `references/cockpit-tools/`，固定提交
`a0508ae815e104e931dae515389e680840008367`（CC BY-NC-SA 4.0）。这是对照真源，不是本应用源码：禁止编进前端/Tauri、禁止 `npm`/`cargo` 引用，禁止把其他 Provider、sidecar、品牌图或远程配置拷进产品。

修改 Cockpit 定向移植区域或声称“与 Cockpit 一致”前，必须先读这个目录里的实际文件和 `docs/UPSTREAM_COCKPIT_UI.md`。禁止默认去 GitHub、禁止用截图或记忆代替源码。若该目录缺失，或 `PINNED_COMMIT.txt` 中的 commit 不是上述 SHA，必须停止并询问，不得改用 `main` 或网上最新提交。

默认实例 Play 一键切号（§D-033）优先读（路径均相对 `references/cockpit-tools/`）：

| 用途 | 参考文件 |
|---|---|
| 卡片/列表 Play 按钮、顺序、禁用态、busy spinner | `src/pages/CursorAccountsPage.tsx` |
| 切号编排、已切换消息、Windows 错误重试 | `src/hooks/useProviderAccountsPage.ts` |
| `injectCursorAccount` 命令包装 | `src/services/cursorService.ts` |
| 路径缺失/启动失败恢复弹层 | `src/pages/CursorAccountsPage.tsx`；设置项在 `src/pages/SettingsGeneralPanel.tsx` |
| Windows 操作错误弹层 | `src/components/WindowsOperationDialog.tsx`；`src/utils/windowsOperationDialog.ts`；`src/utils/windowsOperationError.ts` |
| 卡片 32px / 列表 24px 与 `success` | `src/styles/pages/github-copilot.css`；`src/styles/components.css` |
| 注入命令与部分成功 | `src-tauri/src/commands/cursor.rs`；`src-tauri/src/commands/cursor_instance.rs` |
| 七键写入 | `src-tauri/src/modules/cursor_account.rs` |
| 默认实例关闭/启动/路径 | `src-tauri/src/modules/cursor_instance.rs`；`src-tauri/src/modules/process_*.rs` |
| 当前账号与默认绑定 | `src-tauri/src/modules/provider_current_state.rs` |
| 受限 UAC 重试 | `src-tauri/src/modules/windows_operation.rs`；`src-tauri/src/commands/system_app_commands.rs` |

其他已移植页面、侧栏、筛选、设置对照 `docs/UPSTREAM_COCKPIT_UI.md` 的文件表，在本目录打开对应上游路径。快照省略项见 `references/cockpit-tools/PINNED_COMMIT.txt`。

## Clean-room 与隐私

- 不复制或改写 Sirocco 的源码、资源、界面、品牌或文案；只可使用项目决策记录中列出的行为事实。
- Cockpit Tools UI 按 `docs/DECISIONS.md` §D-017 作为 CC BY-NC-SA 4.0 派生代码定向移植：只复用固定提交中 Cursor 页面、共享账号组件、经典侧栏、深浅主题与相关 CSS；必须记录来源、固定提交、原文件路径和修改，不得引入其他 Provider、sidecar、无关权限或品牌资源。默认实例 Play 一键切号按 §D-033 定向移植固定提交的注入、关闭/重启与路径恢复语义（含单事务与窄 UAC 白名单加固），不引入通用 Provider、多开框架或品牌资源。
- 不自动读取 Cursor 数据，也不在启动时自动发起网页登录；读取默认 Cursor `state.vscdb` 必须由用户在界面中主动触发。仅当用户启用的 Cursor 自动刷新间隔大于 0 且已有账号时，应用进程才可按 `docs/DECISIONS.md` §D-022 在前后台或托盘期间查询额度；应用更新检查仍按独立设置访问本项目固定 GitHub updater endpoint。
- 按用户确认的 Cockpit 兼容持久化方案，Access Token 与 Refresh Token 可写入应用数据目录的账号明细及 `.bak`；普通列表/刷新 DTO、自动刷新事件、网页登录状态、日志和错误不得包含 Token 或 PKCE verifier。只有用户主动粘贴 Token/JSON、选择 JSON 文件或主动预览/复制/保存完整导出时，完整凭据才可进入受控敏感数据流。
- 生产网络请求只能访问 `docs/DECISIONS.md` §D-012、§D-020、§D-022 列出的 Cursor 第一方精确 HTTPS 端点；禁止重定向、任意 URL、遥测和远程日志。
- 未经用户明确授权，开发与测试不得读取本机真实 `state.vscdb`，不得使用真实凭据联网。

## 实现与验证

- SQLite 只读打开原数据库；不得复制数据库或用读写连接规避锁。唯一例外是用户点击 Play 触发的新注入函数，可按 `docs/DECISIONS.md` §D-033 对默认 `state.vscdb` 精确写入（无 `CREATE`、单 `Immediate` 事务、有界 `busy_timeout`）。
- 外部响应字段、单位、周期或认证细节没有权威证据时必须保持“未知”，不得通过端点名猜测。
- 网络测试使用 mock；fixture 必须脱敏且不得来自未经检查的真实响应。
- 新增敏感数据流、端点或权限前，先更新 `docs/DECISIONS.md` 并取得用户确认。
- 影响 Cursor 账号页布局或样式的改动必须运行 `npm run test:visual`；不得用 `--update-snapshots` 消除未知差异。基线更新必须与可解释的界面变更一起审核，并保留用户对候选版本的独立人工视觉验收。

## Cockpit 对齐门

- 修改 Cockpit 定向移植区域前，必须读取 `references/cockpit-tools/` 中固定提交的实际来源实现和 `docs/UPSTREAM_COCKPIT_UI.md`，不得仅凭截图、文件名、GitHub 或旧项目行为推断。
- 控件对齐必须逐项核对可见结构和行为语义，包括选项集合与顺序、默认值、比较/筛选逻辑、空值策略、方向切换、置顶规则、禁用态和本地化；不得只复制组件外观后保留旧业务逻辑。
- 每个新增或修正的 Cockpit 行为必须有能在修复前失败的行为契约测试；下拉、弹层、菜单等非默认可见状态还必须有展开态语义断言和必要的视觉基线。
- 交付前以固定 Cockpit 源码、当前实现、行为测试和可见截图四方交叉核对；任何一方缺失都不得声称“与 Cockpit 一致”。

## UI/UX 质量门

- UI 与 UX 是所有功能改动的一等验收条件，不得把“功能能用”“测试通过”或“截图基线已更新”当作视觉质量完成。
- 修改界面前先识别并复用相邻组件已有的字体、字号、字重、颜色、间距、边框和信息层级；不得凭感觉拼接一套不一致的局部样式。
- 每次可见改动必须同时检查真实渲染的深色与浅色界面、主要窗口尺寸和中英文长文案；重点检查对齐、密度、可读性、截断、状态层级及交互反馈。
- 自动视觉测试只负责阻止意外漂移。更新基线前必须人工查看 actual/diff，确认差异完全来自预期改动；不得为了让测试变绿掩盖丑陋、粗糙或不一致的结果。
- 交付前主动审视最终界面。发现字体混用、层级混乱、留白失衡、控件突兀或其他明显低质量结果时，必须继续打磨和返工，不得把垃圾产出交给用户再要求用户指出。

## AI 开发与发布边界

- 自动化测试、CI、CodeQL、构建、签名、Draft、attestation 通过只证明对应技术门禁通过，不得声称用户已经验收产品或 stable 已具备发布资格。
- 产品验收是 owner 本人的判断，不可委托：Release Acceptance 清单的每一项只能由 owner 在对话中针对精确 tag/SHA 明确确认为真；Agent 不得凭自动化结果或自测替 owner 勾选任何一项。
- 按 `docs/DECISIONS.md` §D-024，只有在 owner **明确验收通过**并**明确同意发布精确 tag**（如“同意发布 v0.1.2”）之后，Agent 才可以 owner 身份代为执行：填写并关闭 Release Acceptance Issue、添加 `release-approved`、触发 `Publish stable release`、批准 `stable-release` Environment。Issue 证据中必须如实记录“由 Agent 依据 owner 授权代为执行”并引用 owner 的确认要点；不得伪造证据，不得为通过发布而修改 `approval.mjs`、模板 ID 或工作流门禁。
- 稳定版只能经 `.github/workflows/publish-stable.yml` 发布。必须满足 `docs/DECISIONS.md` §D-015、§D-024 和 `docs/RELEASING.md` 的精确 tag/SHA、人工验收、required checks、Draft 完整性、SHA256、attestation 与双重确认门禁。
- 用户说“构建通过”“转公开”“生成 Draft”或“看起来没问题”均不等于验收通过或授权发布 stable。授权只对 owner 明确指定并记录在 Issue 中的精确 tag/SHA 有效；任何代码、tag 或资产变化都会使授权失效，必须重新验收和授权。
- 人工验收未完成、只完成部分清单项或同意未落到精确 tag 时，Agent 必须停止并提问，只能报告未完成项和提供测试方法；禁止用 mock、单测、截图、打包成功或 Agent 自测冒充用户产品验收和计划 §17.4 的真实多平台安装/更新 E2E。
- 除完成用户明确请求或仓库强制流程所必需的 PR、Release Acceptance Issue 外，Agent 不得自行创建公开 Issue、Discussion、Project item、公告或其他长期外部跟踪事项。“解决告警”“处理风险”“继续直到通过”不包含此类授权；如认为需要公开 tracker，必须先单独询问并取得明确同意。依据：`docs/DECISIONS.md` §D-030。
