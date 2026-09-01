# 安全说明

## 数据流与用户触发

应用启动时只加载自身应用数据目录中已经落盘的账号索引、账号明细和最后额度快照，不读取 Cursor 数据库、不续期 Token、不访问 Cursor。若用户没有关闭自动更新检查，应用可在界面就绪后独立访问本项目固定 GitHub Release updater endpoint；该请求不携带任何 Cursor 账号凭据。

用户点击“读取本机账号”后，Rust 侧才以只读方式打开当前平台 Cursor 的 `User/globalStorage/state.vscdb`（Windows `%APPDATA%/Cursor`、macOS `~/Library/Application Support/Cursor`、Linux `~/.config/Cursor`），并只查询 `docs/DECISIONS.md` §D-003 列出的五个键。数据库不会被复制或修改。读取结果按账号身份合并进本应用存储；该操作不写回或切换 Cursor。

用户主动粘贴 Cockpit Tools JSON 并提交时，原始 JSON 与 Token 会短暂经过 WebView 和 Tauri IPC；提交后输入框立即清空。Rust 侧按限制解析并持久化账号，不自动扫描 Cockpit Tools 目录，也不提供文件导入。

用户点击单账号、选中账号或全部账号刷新后，应用才按 `docs/DECISIONS.md` §D-012、§D-020 访问固定 Cursor 第一方端点。点击即为本次请求授权，不再二次确认。批量刷新逐账号顺序执行；一个账号或可选数据源失败不影响其他账号。

## 固定网络白名单

生产 Provider 只允许以下 HTTPS 方法与精确路径，禁止重定向、查询参数、片段和任意 URL：

```text
POST https://api2.cursor.sh/oauth/token
POST https://api2.cursor.sh/aiserver.v1.AuthService/GetUserMeta
GET  https://api2.cursor.sh/auth/full_stripe_profile
GET  https://api2.cursor.sh/auth/stripe_profile
GET  https://cursor.com/api/usage-summary
POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetSandUsageStatus
POST https://cursor.com/api/dashboard/get-sand-access-status
```

OAuth Token 端点只在用户手动刷新且 Access Token 不可解析或五分钟内过期时使用；失败后继续尝试旧 Access Token。`usage-summary` 是 Total、Auto + Composer、API、On-Demand 和计费周期的唯一实时真源。Sand 用量端点使用 Access Token 的 Bearer 认证、Connect 协议版本和 `{}` 请求体；Sand 资格端点使用已经确认的 `Origin: https://cursor.com` 与 WorkOS Cookie。两者都是独立可选数据源。

旧的 `DashboardService/GetCurrentPeriodUsage` 已由 D-012 取消，不得继续加入生产白名单或作为 Free 账号 fallback。

## 应用更新网络与签名

应用更新与 Cursor Provider 使用独立的网络边界。更新检查只允许访问本项目 GitHub Releases 下配置的 `latest-{{target}}.json` / `latest.json` 及其指向的本项目 Release assets；不得接受用户输入的任意更新源，不得把 Cursor Token、Cookie、邮箱、账号 JSON 或设备数据库内容放入更新请求。

WebView 的 CSP 保持 `connect-src 'none'`；Cursor Provider 和 updater 网络都由受限 Rust/Tauri 能力执行，前端不得直接 `fetch` 外部地址。浏览器手动下载兜底只可打开本项目固定 GitHub Release 页面。

所有应用内可安装资产都必须通过内嵌 Tauri updater 公钥验证签名。GitHub 上的 SHA256 和 artifact attestation 用于用户与发布流程复核，不能替代应用内签名验证。签名不匹配、目标/版本不一致、清单无效或 URL 不属于本项目发布链路时必须停止，不得提供“仍然安装”选项。

Tauri updater 私钥和密码只允许存于 GitHub Actions Secrets 与离线加密备份；不得提交到仓库、写入应用数据、Actions cache/artifact 或日志。fork PR 不得获得签名 Secrets。

Windows 与 macOS 首版不做操作系统代码签名/公证，因此可能出现 SmartScreen 或 Gatekeeper 提示；文档必须如实说明。Tauri updater 签名和操作系统代码签名用途不同，不能互相替代。

Linux AppImage 使用标准 Tauri updater。deb/rpm 只有在用户明确点击安装、目标包已下载并通过签名验证后，才可调用固定包管理器命令触发系统提权；用户取消提权是正常失败。未知安装类型、未知架构或任意包路径不得执行安装命令。

## 本地持久化与导出

应用按用户确认的 Cockpit 兼容模式，在 Tauri `app_data_dir()` 下保存轻量账号索引及每账号独立 JSON 明细。账号明细和 `.bak` 包含明文 Access Token、Refresh Token、账号资料和最后额度快照；不提供 DPAPI 或额外加密层。能够读取当前 Windows 用户应用数据目录的其他进程也可能读取这些凭据。

普通列表、刷新、筛选和删除命令只返回脱敏 DTO，不含 Access Token、Refresh Token、Cookie 或原始认证对象。只有用户主动点击完整 JSON 导出时，包含明文 Token 的内容才可进入导出预览。预览按 Cockpit 行为默认遮罩全部字符串，并允许用户主动显隐、复制或保存；账号页的可折叠说明和导出弹窗文案必须明确内容敏感，但不增加额外确认步骤。

删除账号时必须删除该账号主 JSON 与账号 `.bak`，并清除可能保留已删除摘要的索引备份；不得让删除后的明文 Token 残留在账号备份文件中。索引仍可由现存账号明细重建。

## 响应脱敏

Cursor 请求头必须标记为敏感。应用不记录 Token、Cookie、邮箱、请求体或响应正文。HTTP/JSON 错误只可返回状态码、Content-Type、响应字节长度和“空体 / HTML / JSON 形态 / 其他”分类等结构化证据，不得包含正文片段。更新错误同样必须脱敏、截断，不得记录 Secrets、环境变量、用户名路径、任意 manifest 正文或包管理器完整输出。

外部字段缺失保持未知，不转换为 0。核心额度请求失败时保留上一次核心快照并记录脱敏错误；Sand 用量或资格失败时保留其独立的上次成功结果，不得丢弃核心额度。

## 测试边界

SQLite 测试使用临时 fixture 数据库；存储测试使用临时目录；Cursor 网络测试只用 mock transport/server 和假 JWT。updater 测试使用隔离清单、测试 keypair 和假安装包，必须覆盖篡改后签名失败。测试、构建与视觉验证不得读取本机真实 Cursor 数据库、应用数据账号、剪贴板或真实 Token，不得发送真实 Cursor 请求，也不得控制用户现有窗口、鼠标或进程。

## 明确不做

- 切换账号、Token 注入、写回 Cursor 数据库、启动 Cursor 或多开；
- OAuth 登录、Cursor 额度后台自动刷新、启动时续期或启动时读取本机 Cursor；
- 文件导入、自动扫描 Cockpit Tools 数据、遥测、崩溃上报、远程日志或云同步；
- 任意 URL 请求或访问第三方账号服务器。

## 报告安全问题

请勿在公开问题中粘贴 Token、Cookie、真实邮箱、完整数据库、账号明细或未经脱敏的响应。报告应包含最小复现步骤、受影响版本和已脱敏证据。
