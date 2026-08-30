# Cursor 额度查看器

一个 clean-room 开发的 Windows x64 本地桌面应用。它只在用户主动操作后读取当前 Cursor 账号，并只向 Cursor 第一方固定端点查询额度。

## 当前能力

- 启动时不读取 Cursor 数据、不联网。
- 点击“读取当前账号”后，以 SQLite 只读连接查询五个已确认的 `cursorAuth/*` 键。
- 读取当前 Cursor 账号时，完整 Token、Refresh Token 与 Cookie 不进入前端；粘贴导入的例外与内存边界见下文和 `SECURITY.md`。
- 单击“查询额度”后直接发起本次查询，不再二次确认。
- 展示当前周期 Auto、API、总用量百分比，以及已确认的 Grok/Sand 用量和访问状态。
- 采用深色数据控制台布局，提供“概览 / 账号 / 安全”三页导航。
- 可由用户主动粘贴 Cockpit Tools 导出的 JSON 数组，一次导入多个账号并切换当前查询账号；无需选择文件，导入集合仅驻留 Rust 内存。
- 生产 Provider 仅允许三个精确 HTTPS 端点：`api2.cursor.sh` 当前周期用量，以及 `cursor.com` 的 Sand 用量和访问状态；禁止重定向和任意 URL。
- 响应只返回 Rust 侧固定脱敏 DTO；缺失字段显示“暂无数据”，不会猜测为 0。Free 账号没有 Grok/Sand allowance 时不会影响 Auto、API 与总用量查询。

Cockpit Tools 粘贴导入只读取 `id`、`email`、`tags`、`access_token`、`refresh_token` 是否存在、`membership_type` 与 `sign_up_type`。提交后输入框立即清空，`cursor_auth_raw` 与可能过期的 `cursor_usage_raw` 均被忽略；关闭应用或点击清除后，导入账号不会保留。原始 JSON 和 Token 会短暂经过 WebView 与 Tauri IPC，具体边界见 `SECURITY.md`。

## 开发

要求：Node.js、Rust stable、Windows WebView2，以及 Tauri 2 的 Windows 构建依赖。

```powershell
npm install
npm run build
npm run tauri dev
```

Rust 测试全部使用临时 SQLite 数据库或本地 mock server，不读取真实 Cursor 数据，不发送真实 Cursor 请求：

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

## 决策与安全

- 产品和协议决策：[docs/DECISIONS.md](docs/DECISIONS.md)
- 安全边界与报告方式：[SECURITY.md](SECURITY.md)

本项目不隶属于 Cursor。项目未使用 Sirocco 的源码、资源、界面、品牌或文案。
