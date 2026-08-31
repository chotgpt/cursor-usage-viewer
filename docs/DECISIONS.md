# Cursor 额度查看器决策记录

更新时间：2026-08-30

## D-001 产品范围与技术栈

开发 Windows x64 桌面端“Cursor 额度查看器”，采用 Tauri 2、Rust、React、TypeScript、Vite 与 WebView2。应用查看当前 Cursor 账号、Auto/API 当前周期用量和 Grok/Sand 状态，并支持用户主动导入 Cockpit Tools JSON 后在本次会话内选择查询账号；不提供 Cursor 注入或补丁。

## D-002 用户主动触发

启动应用不读取 Cursor 数据、不联网。读取当前账号与查询额度是两个清晰、独立的用户操作。用户单击“查询额度”即视为本次真实请求授权，应用直接查询已记录的固定 Cursor 端点，不再弹出二次确认。

## D-003 本地数据源

只读打开 `%APPDATA%\Cursor\User\globalStorage\state.vscdb`，只查询 `ItemTable` 的以下键：

- `cursorAuth/accessToken`
- `cursorAuth/refreshToken`
- `cursorAuth/cachedEmail`
- `cursorAuth/stripeMembershipType`
- `cursorAuth/cachedSignUpType`

不得复制数据库或用普通读写连接规避锁；读取失败时保留原始系统状态并返回清晰错误。

## D-004 敏感数据边界

除用户主动粘贴 Cockpit Tools JSON 的导入输入框外，完整 Access Token、Refresh Token 与 Cookie 不进入前端。粘贴导入会使原始 JSON 短暂存在于 WebView 与 Tauri IPC；点击导入后必须立即清空输入框，Rust command 只返回脱敏 DTO。凭据默认只驻留 Rust 内存，在用户点击清除、窗口关闭或进程退出时尽力清除。邮箱可在账号卡片完整显示，但不得写入日志、上传或持久化到应用文件。

禁止遥测、崩溃上报、远程日志与云同步。

## D-005 网络边界

> 历史说明：本节关于 `GetCurrentPeriodUsage` 的生产使用已由 D-012 取代；Sand 的已验证 Cookie/Origin 事实继续有效。

生产 Provider 不接受任意 URL，只能访问 HTTPS 域名 `cursor.com` 的已确认精确路径，并禁止 HTTP 重定向。当前静态证据只确认：

- `POST /api/dashboard/get-sand-usage-status`
- `POST /api/dashboard/get-sand-access-status`
- 两者都要求 `Origin: https://cursor.com`
- Cookie 值由 JWT `sub` 中 `auth0|` 后的用户 ID 与 JWT 拼接后进行表单编码：`userId%3A%3Atoken`

2026-08-28 已在用户授权下对当前账号做脱敏真实验证：裸 JWT Cookie 得到 HTTP 403 `Invalid origin for state-changing request`；加入 Origin 后因 Cookie 结构不符跳转 WorkOS；使用上述 Cookie 格式与 Origin 后两个端点均返回 HTTP 200。生产 Provider 因此调用这两个固定端点，仍禁止重定向。

用户于 2026-08-28 明确要求增加 Auto 与 API 额度。当前 Cursor 客户端/仪表盘使用以下固定第一方端点读取当前计费周期用量：

- `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage`
- 使用现有 Access Token 的 `Authorization: Bearer` 认证
- 固定携带 `Content-Type: application/json` 与 `Connect-Protocol-Version: 1`，请求体为 `{}`

该 Connect RPC 端点不是 Cursor 公开承诺的稳定 API。生产 Provider 仅允许上述精确主机与路径，不刷新或持久化 Token，不接受重定向、查询参数、片段或任意 URL；字段缺失时前端显示“暂无数据”，不得臆造为 0。

## D-006 未知响应语义

> 历史说明：本节对 `GetCurrentPeriodUsage` 字段的映射已由 D-012 取代；“缺失保持未知、可选 Sand 失败不丢弃核心额度”的原则继续有效。

真实响应已确认 `usagePercent`、`hasAvailableUsage`、`hasNonZeroIncludedLimit`、`grokPlanLabel`、`currentPeriodStart`、`nextResetTimestampUtc`，以及资格响应中的 `state`、`blockReason`、`isPaidTrialPlan`、`proAndSuperGrokPlansGrantAccess`。这些 Grok/Sand 字段对没有 Bot allowance 的 Free 账号均按可选字段处理；字段缺失显示“暂无额度/暂无数据”，Sand 用量或资格请求的失败不得丢弃已成功取得的 Auto、API 与总用量。当前周期接口按原字段名解析可选的 `planUsage.autoPercentUsed`、`planUsage.apiPercentUsed`、`planUsage.totalPercentUsed` 和计费周期起止时间；`planUsage` 整体缺失时也保持为未知，不把缺失值臆造为 0。前端将它们标为 Auto、API 与总用量，不把 Auto 推断成新的独立套餐，也不猜测不存在的 Bot/Grok/Sand 数值池。官方当前定价文档将产品语义描述为 Cursor Models 与 Other Models 两个用量池，并说明 Auto 是路由模式；界面保留接口字段名称以兼容用户熟悉的叫法。

## D-007 Clean-room

Sirocco 静态报告只作为数据路径、数据库键、已观察端点及第三方凭据外传风险的事实来源。不得复制其源码、资源、界面、品牌或文案，也不得运行其程序或访问第三方域名 `cr.schoolsn.com`。

## D-008 测试边界

SQLite 使用临时 fixture 数据库测试；网络默认使用 mock transport/server；任何测试不得读取真实 Cursor 数据库或发送真实 Cursor 请求。覆盖只读 SQLite、Token 边界、Cookie/Bearer 请求头、响应脱敏、域名/路径白名单和凭据清除生命周期。

## D-009 Cockpit Tools 账号导入

用户于 2026-08-28 明确要求增加 Cockpit Tools 账号导入与账号管理，随后明确将文件选择改为粘贴 JSON。导入必须由用户在账号页主动粘贴 JSON 数组并点击导入；一个数组可包含多个账号。不提供文件选择器，不自动扫描 Cockpit Tools 目录。

- 原始 JSON 会短暂存在于输入框与 IPC；提交后前端立即清空。Rust 解析后只向前端返回账号 ID、邮箱、标签、套餐、注册方式、来源和是否选中的固定摘要。
- 完整 Access/Refresh Token、`cursor_auth_raw` 和 `cursor_usage_raw` 不得返回前端、记录日志或写入应用文件。
- 仅保留查询所需的 Access Token；Refresh Token 只判断是否存在后立即随导入临时对象清零，不用于刷新会话。
- `cursor_usage_raw` 是可能过期的缓存，必须忽略；选中账号的额度仍由用户单击“查询额度”后从固定 Cursor 端点实时读取。
- 导入账号只驻留于当前进程内存，关闭、退出或点击清除时全部尽力清零；重复导入替换上一次 Cockpit Tools 导入集合，但保留已主动读取的本机 Cursor 账号。
- 粘贴内容设置 8 MiB、500 个账号、字段长度与 JWT 形态限制；解析错误只报告字段位置和原因，不回显凭据内容。

## D-010 第三套界面方案

用户选择第 3 套“深色数据控制台”设计。主界面采用“概览 / 账号 / 安全”侧边导航；概览用三根独立用量柱对比 Auto、API 与 Grok/Sand，并保留总用量、周期、套餐、Sand 授权和单击查询操作。界面实现保持 Windows 桌面端实用性，不加入装饰性终端、遥测或后台轮询。

## D-011 Cockpit Tools 结构重做与本地持久化

用户于 2026-08-30 要求按 Cockpit Tools Cursor 账号页的信息结构重做界面，并确认采用“完整账号卡片、默认三列、账号较多时页面滚动”的一屏高密度方案。首版包含搜索、套餐与标签筛选、排序、网格/列表切换、多账号粘贴导入、选中/全部刷新和删除本地记录；不实现切号、Token 注入、启动 Cursor、多开、OAuth 或后台自动刷新。

用户在获知 Cockpit Tools 对 Access Token 与 Refresh Token 不加密、直接写入完整账号 JSON 后，明确要求照抄其持久化逻辑。因此采用轻索引、每账号独立明细、临时文件原子替换、`.bak` 回滚和扫描明细重建索引；账号资料、Access Token、Refresh Token 与最后成功额度快照均在应用本地数据目录持久化。启动时只加载本地数据，不自动联网。此项取代 D-004、D-005、D-009 中关于邮箱/凭据不落盘、Token 不持久化和导入账号仅驻留内存的旧限制，详细权衡见 `docs/adr/0001-cockpit-compatible-local-persistence.md`。

整体外壳采用仅服务 Cursor 的 Cockpit 风格单页，不保留旧“概览 / 账号 / 安全”三页结构。主窗口照抄 Cockpit Tools 的 1280×800 默认尺寸、900×600 最小尺寸、居中和可缩放配置；网格照抄 `repeat(auto-fill, minmax(320px, 1fr))`。导入 JSON 中的 `cursor_usage_raw` 立即作为“导入缓存”展示并持久化，用户手动刷新成功后由实时额度快照替换。

完整账号导出同样照抄 Cockpit：导出当前筛选范围内的选中账号（没有选择时导出当前筛选结果），单卡也可导出；内容是包含明文 Token 的 Cockpit 兼容完整账号 JSON，可预览、复制和保存，界面必须明确提示敏感性。用户手动刷新时，若 Access Token 无法解析或五分钟内到期，则使用 Refresh Token 调用 `https://api2.cursor.sh/oauth/token` 续期，成功后持久化新 Token，续期失败则继续尝试旧 Access Token；不得在启动或后台续期。本机 Cursor 当前账号仅在用户主动点击读取后只读识别并标记，启动时不自动打开其数据库。

## D-012 最终界面与 Cursor 刷新真源

用户于 2026-08-30 最终确认采用“深色精简版”：保留已选第 3 套深色设计语言，只复用 Cockpit Cursor 账号页的信息层级与操作结构，独立实现组件和样式。侧栏仅服务 Cursor 与本地数据风险说明；工具栏只保留本项目真实能力，不显示 Cockpit 中用于 OAuth 添加的“+”或包含路径、后台自动刷新等能力的齿轮设置。卡片完整展示 Total、Auto + Composer、API、On-Demand 四组核心额度，并在底部增加一行紧凑的 Grok/Sand 用量、访问状态与重置时间。

用户同轮明确要求“Cockpit 的都要，加上 Sand 额度和现有 Sand 查询相关”，并将其定义为核心需求。因此一次手动刷新按以下固定 Cursor 第一方链路执行；启动和后台均不得执行：

1. Access Token 不可解析或五分钟内到期时，条件性 `POST https://api2.cursor.sh/oauth/token`；失败后继续尝试旧 Access Token。
2. `POST https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta`，用于补充邮箱、注册方式与 Auth ID；失败不阻塞核心额度。
3. `GET https://api2.cursor.sh/auth/full_stripe_profile`，非 200 时 fallback `GET https://api2.cursor.sh/auth/stripe_profile`，用于更新套餐/订阅；失败不阻塞核心额度。
4. `GET https://cursor.com/api/usage-summary`，作为 Total、Auto + Composer、API、On-Demand 与计费周期的唯一实时真源。
5. 继续调用本项目已确认的 `POST https://cursor.com/api/dashboard/get-sand-usage-status` 与 `POST https://cursor.com/api/dashboard/get-sand-access-status`，作为独立、可选的 Grok/Sand 数据源；任一失败不得丢弃核心额度或另一个 Sand 结果。

上述精确路径是生产 Provider 的完整白名单，均禁止重定向、查询参数、片段和任意目标。原 D-005/D-006 中的 `POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage` 不再是生产额度来源，应从白名单与实现中移除；固定 Cockpit 版本的 `usage-summary` 已覆盖四组核心额度，继续每次请求旧端点只会产生重复请求并扩大 Free 账号 HTTP 200 非 JSON 的失败面。

决策依据：Cockpit Tools 固定提交 `a0508ae815e104e931dae515389e680840008367` 的 `cursor_account.rs` 手动刷新链路与 `src/types/cursor.ts` 额度映射；用户对本轮三项封板问题的最终回答。

## D-013 GitHub 开源身份、许可证与首发策略

用户于 2026-08-30 决定将项目在 GitHub 开源，并确认：

- 项目长期只服务 Cursor，不扩展成多 Provider 管理器；
- 仓库属于个人账号，名称为 `cursor-usage-viewer`；产品英文名为 `Cursor Usage Viewer`，中文名/副标题保留“Cursor 额度查看器”；
- 采用 MIT 许可证，使用原创中性图标，不使用 Cursor 官方 Logo，并显著标注非官方、无隶属或背书关系；
- 首版维护简体中文和英文；Issues 与外部 PR 开放，提供贡献指南、模板和私密漏洞报告，首版不开 Discussions；
- 先在本地和 private GitHub 仓库完成清密、三平台构建与验收，再公开仓库并发布 `v0.1.0`；
- 只维护 stable 通道。`v*` 标签创建 Draft Release，所有必需平台和更新资产通过后由用户人工发布，任一平台失败不得发布不完整 stable；
- 以 Cursor 最新稳定版为主要兼容目标，上游变化按 best-effort 补丁修复，不承诺旧版长期兼容。

本决策以三平台首发取代 D-001 的 Windows-only 平台限制；D-001 的 Tauri + React + TypeScript + Rust 技术栈仍有效。

Cockpit Tools 只作为固定提交 `a0508ae815e104e931dae515389e680840008367` 的行为参考。其 README 声明 CC BY-NC-SA 4.0 且仓库缺少标准 LICENSE 文件；本项目不得复制其源码、workflow、CSS、资源、品牌或文案，必须独立实现并在 README 记录 clean-room 参考。

## D-014 三平台桌面生命周期与 Cockpit 同等更新行为

用户确认 Windows、macOS、Linux 同时首发，并要求应用更新行为完整参考 Cockpit Tools 固定提交。目标行为包括：

- 默认开启自动检查，启动后异步检查并每小时轮询；默认关闭自动安装，默认开启更新提醒；支持手动检查、跳过指定版本、稍后提醒、双语更新说明、进度、取消、失败重试、浏览器下载兜底、立即/稍后重启和更新后版本变化说明；
- 侧栏底部进入设置；常规页保存语言、关闭行为和更新选项；关于页显示版本、手动检查和版本历史；更新流程使用全局对话框与完成 Toast；
- 创建系统托盘，关闭窗口默认每次询问“最小化到托盘 / 退出”，并允许保存默认行为。托盘可继续检查应用更新，但不得后台刷新 Cursor 额度；
- Cursor 账号页沿用 Cockpit 的客户端分页：先筛选/分组/排序，默认每页 20，可选 20/50/100并记忆；全选只作用当前页；
- Token/JSON 直接粘贴导入，不增加确认；账号页提供可折叠本地处理说明；导出直接进入默认遮罩预览，可显隐、复制和保存。

发布矩阵参考 Cockpit：Windows x86_64 NSIS/MSI；macOS Apple Silicon、Intel updater assets 与 Universal 手动包；Linux x86_64/aarch64 AppImage、deb、rpm。所有 updater assets 必须使用 Tauri 私钥签名，公钥内嵌；私钥仅存 GitHub Secrets 和离线备份。

首版不购买 Windows 代码签名，也不配置 Apple Developer ID/notarization，接受并说明 SmartScreen/Gatekeeper 提示。Tauri updater 签名不能被操作系统代码签名替代。Linux deb/rpm 更新必须先验证本项目签名，再在用户明确点击安装后调用系统提权安装；未知安装类型不得执行命令。

更新检查访问本项目固定 GitHub Release endpoint，不携带 Cursor 凭据；它是“启动不访问 Cursor”的例外，而不是访问任意网络的授权。详细权衡见 `docs/adr/0002-github-releases-and-signed-updater.md`。

本决策取代 D-011/D-012 中“侧栏不提供设置入口”和“启动绝对不联网”的旧表达：仍然禁止启动或后台访问 Cursor、续期 Token、读取本机数据库或刷新额度；只允许按更新设置访问本项目固定 GitHub updater endpoint。

## D-015 AI 开发与 stable 发布双重人工门禁

用户于 2026-08-31 指出：自动化测试、构建和 Draft 资产通过不等于产品已验收，并要求按严格 AI 开发流程重做发布工作流。此后必须区分以下状态：代码自动化验证通过、候选安装包构建通过、用户人工产品验收通过、stable 获准发布。任何前一状态都不能被表述为后一状态。

采用用户确认的“单人双确认”发布模型：

1. AI/Agent 只能实现、测试、提交 PR、生成 Draft 候选和汇报证据；不得代替仓库 owner 运行产品验收、填写或勾选 Release Acceptance Issue、添加 `release-approved` 标签、关闭验收 Issue、批准 `stable-release` Environment 或发布 stable。
2. `main` 继续强制 PR、批准和必需检查。最终候选 tag 必须对应 `main` 中已通过 CI 与 CodeQL 的精确提交；tag 或代码变化立即使旧验收失效。
3. `v*` 只生成签名 Draft。Draft 的平台资产、Tauri 签名、target manifests、`latest.json`、SHA256 和 provenance attestation 全部齐全后，才可开始针对该精确 tag/SHA 的人工验收。
4. 仓库 owner 必须亲自运行源码和候选包，完成 UI、核心功能、持久化、安全边界、已知问题以及计划 §17.4 的真实隔离 updater E2E，并在专用 Issue 中提供证据、勾完稳定的机器可读验收项、添加 `release-approved` 标签并关闭 Issue。
5. stable workflow 的预检必须确认不存在打开的 `release-blocker`，并再次绑定 Issue、tag、SHA、required checks、Draft 状态、资产/签名/manifest、实际下载字节 SHA256 和 attestation；输入确认词必须精确为 `PUBLISH <tag>`。
6. 即使预检通过，发布 job 仍必须等待受保护的 `stable-release` GitHub Environment 第二次人工批准，且禁止管理员绕过；批准后重新执行全部可变状态检查才允许将 Draft 发布。
7. 未来发布启用 GitHub immutable releases；发布后 tag 和资产不得改写，并由 published smoke 再验证公开更新清单。紧急修复使用新 patch 版本，不覆盖已发布资产。

当前 `v0.1.0` Draft 在用户实际产品验收和本决策落地之前生成，只是历史构建证据，不具备 stable 发布资格。后续界面或功能修改完成后必须使用新候选 tag 重新构建和验收，不得沿用旧 Draft 的自动化结论。

决策依据：用户选择“单人双确认”；GitHub 官方关于 AI 代码需人工审查、受保护 Environment、immutable releases 与 artifact attestations 的文档；NIST SSDF PW.7/PS.3 的人工评审、自动分析和发布完整性原则；Tauri v2 updater 强制签名规范。

## D-016 Cockpit 视觉真源、当前账号置顶与视觉验收门

用户于 2026-08-31 对源码调试版进行人工查看后，明确判定现有“深色精简版”界面不合格，并要求以其提供的 Cockpit Tools Cursor 账号页截图作为 1280×800 桌面端视觉真源，重做整体页面。此决定覆盖 D-012 中“只复用信息层级、继续沿用第 3 套精简视觉”的旧口径，但不改变 clean-room、MIT 与非官方项目边界：本项目独立实现相同的页面结构、空间关系、密度和视觉结果，不复制 Cockpit 源码、CSS、品牌、资源或文案。

固定视觉结构包括：完整高度的深蓝渐变侧栏；顶部展开的蓝色说明面板；单行圆角工具栏；独立的全选条；默认三列高密度纵向账号卡片；卡片中的身份、当前/套餐徽章、Auth ID、标签、Total、Auto + Composer、API、On-Demand、Sand、更新时间和底部操作区。本项目没有的 Cockpit 能力不得用无效按钮伪造，现有读取本机、粘贴导入、刷新、隐私、导出、删除等真实能力映射到相同结构。

用户主动读取本机 Cursor 当前账号后，该账号在全部筛选结果和分页中始终排在第一，其优先级高于邮箱、套餐、最近使用时间及升降序选择；其余账号继续按用户选择的规则排序。启动时仍不得自动读取 Cursor 数据库。

视觉回归使用仓库内固定假账号、固定 Chromium、1280×800 视口、确定字体与禁用动画的 Playwright 截图基线；PR CI 中像素比较失败即阻塞。基线变更必须作为可见代码变更接受审核，不能由失败测试自动覆盖。自动视觉比较只证明基线未漂移，不等于用户人工验收；Release Acceptance Issue 必须记录 owner 对源码调试版和精确候选 tag/SHA 的界面截图人工确认，未确认不得发布 stable。

决策依据：用户本轮提供的当前实现与 Cockpit Tools 参考截图及“整体照抄”“本机当前放第一个”“要加上视觉门验收”的最新明确要求；Cockpit Tools 固定提交 `a0508ae815e104e931dae515389e680840008367` 的 `src/utils/currentAccountSort.ts::compareCurrentAccountFirst` 与 `src/pages/CursorAccountsPage.tsx` 排序调用链；Playwright 官方视觉比较与 CI 文档。
