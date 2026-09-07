# Changelog / 更新日志

## 0.1.3 - 2026-09-07

- Added "Copy web token" to the full-export dialog: converts each exported account to a `<user_id>%3A%3A<accessToken>` Cursor web session token, one per line, with in-dialog feedback for skipped accounts.
- 完整导出弹窗新增“复制网页 Token”，把导出的账号逐行转换为 `<user_id>%3A%3A<accessToken>` 网页登录 Token；跳过的账号在弹窗内提示。

## 0.1.2 - 2026-09-03

- Multi-account Cursor usage workspace with local recoverable storage.
- Cockpit-compatible paste import and sensitive full export.
- User-triggered Total, Auto + Composer, API, On-Demand and Sand refresh.
- Refined the Sand quota card and fixed clipped reset-countdown glyphs.
- Added the all-model spend of the current Bot period to the Sand panel; percentages that round to 100 now render as `100%`.
- Web login now refreshes the new account once after saving it, matching Cockpit; local, token and JSON imports still only save.
- Fixed account import failing with `os error 2` when the same identity already existed under another id.
- 多账号本地存盘、粘贴导入、完整导出与用户主动额度查询。
- Sand 面板新增 Bot 周期内全模型消费金额；网页登录后立即刷新一次；修复重复身份导入报“系统找不到指定的文件”。
