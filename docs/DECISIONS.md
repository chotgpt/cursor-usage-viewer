# Cursor 额度查看器决策记录

更新时间：2026-08-28

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
