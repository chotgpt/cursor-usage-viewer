# 安全说明

## 数据流

应用启动时不读取 Cursor 数据，也不联网。

用户点击“读取当前账号”后，Rust 侧以只读方式打开 `%APPDATA%\Cursor\User\globalStorage\state.vscdb`，并只查询 `docs/DECISIONS.md` 列出的五个键。数据库不会被复制或修改。邮箱、套餐和注册类型可进入前端；完整 Access Token、Refresh Token 与 Cookie 不进入前端。

用户单击“查询额度”后，应用才会使用 `cursorAuth/accessToken`：一份作为敏感 Bearer 请求头发送到当前周期用量端点；另一份从 JWT `sub` 提取用户 ID，在 Rust 内存中生成 Cursor Dashboard 所需的表单编码 Cookie。固定生产目标为：

```text
POST https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage
POST https://cursor.com/api/dashboard/get-sand-usage-status
POST https://cursor.com/api/dashboard/get-sand-access-status
```

`api2.cursor.sh` 请求固定携带 `Connect-Protocol-Version: 1`，两个 `cursor.com` 请求固定携带 `Origin: https://cursor.com`。Provider 禁止重定向、非 HTTPS、其他主机、其他路径、查询参数和片段。当前周期 Connect RPC 不是 Cursor 公开承诺的稳定 API，若字段缺失或协议变化，应用明确报错或显示“暂无数据”，不会降级到任意目标。

## 响应脱敏

真实响应在 Rust 侧解析为固定 DTO。前端只收到 Auto/API/总用量的可选百分比、计费周期、已确认的 Grok/Sand 百分比、可用状态、套餐标签、重置时间和访问状态，不收到完整响应体。响应体有大小限制，结果不写入应用文件。

## 凭据生命周期

Access Token 只在 Rust 内存状态中保留；Refresh Token 读取后仅用于判断是否存在，临时对象销毁时清零。点击清除、关闭窗口或退出进程时，应用对所持有的 Rust 字符串执行尽力清零。

Cockpit Tools 导入必须由用户主动粘贴 JSON 数组并提交。原始 JSON 和其中的 Token 会短暂进入 WebView 输入框及 Tauri IPC；应用不可能保证 WebView/V8、IPC 或系统内存中的所有副本都被立即清零。点击导入后输入框立即清空，Rust 侧原始字符串在解析后尽力清零，前端最终只保留脱敏账号摘要。应用忽略导出中的 `cursor_usage_raw` 与嵌套 `cursor_auth_raw`，不信任缓存额度，也不持久化导入账号。只保留本次会话查询所需的 Access Token，关闭或清除时与账号集合一起销毁。

内存清零不是绝对保证：HTTP 库、TLS 实现、系统分配器、WebView2、操作系统分页和崩溃转储可能产生应用无法控制的副本。请求头被标记为敏感，错误消息会移除 URL，应用不记录请求头、邮箱、Token、Cookie 或响应体。生产环境应同时依赖最小数据保留、固定目标、禁重定向和进程退出后的操作系统隔离。

## 明确不做

- 遥测、崩溃上报、远程日志或云同步；
- 持久化账号库、修改 Cockpit Tools 数据、Cursor 注入或补丁；
- 任意 URL 请求或访问第三方账号服务器；
- 启动时后台读取或后台查询。

## 报告安全问题

请勿在公开问题中粘贴 Token、Cookie、真实邮箱、完整数据库或未经脱敏的响应。报告应包含最小复现步骤、受影响版本和已脱敏证据。
