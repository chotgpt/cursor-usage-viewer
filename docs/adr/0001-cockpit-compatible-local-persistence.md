# ADR-0001：采用 Cockpit Tools 兼容的本地持久化结构

- 状态：已接受
- 日期：2026-08-30

## 背景

项目原有决策仅允许账号凭据驻留 Rust 内存，应用关闭后账号和额度均丢失。用户现明确要求账号与额度数据存盘，并要求持久化逻辑照抄 Cockpit Tools。

Cockpit Tools 的源码实现使用轻量索引 `cursor_accounts.json`、每账号独立 JSON 明细、同目录临时文件原子替换、`.bak` 回滚以及扫描明细重建索引。其完整账号结构直接序列化 `access_token` 与 `refresh_token`，没有 DPAPI、系统凭据库或字段加密层。

## 决策

本项目采用相同的核心持久化逻辑：

1. 在应用本地数据目录保存轻量账号索引和每账号独立明细文件。
2. 明细文件包含账号资料、Access Token、Refresh Token 和最后一次成功查询形成的额度快照。
3. Token 以明文 JSON 保存，不新增加密层。
4. 覆盖写入前保留 `.bak`，通过同目录临时文件替换目标文件。
5. 索引缺失或损坏时，通过扫描账号明细去重并重建。
6. 启动时只加载本地数据，不自动联网；实时额度仍由用户手动刷新。
7. 完整账号导出沿用 Cockpit 兼容 JSON，包含明文 Token；手动刷新产生的新 Token 也覆盖保存到账号明细。

本决策取代 `docs/DECISIONS.md` 中 D-004、D-005、D-009 关于“凭据不写入应用文件”“不持久化 Token”“导入账号仅驻留当前进程”的旧限制。

## 后果

- 优点：应用重启后账号、凭据和最后额度仍可用；能够支持多账号管理和手动批量刷新；单文件损坏时可局部恢复。
- 代价：能够读取当前 Windows 用户应用数据目录的其他进程，也能读取明文 Token；`.bak` 会额外保留一份明文凭据。
- 约束：不得把 Token 写入日志、返回普通前端 DTO、云同步或发送给非 Cursor 白名单端点；用户主动执行完整账号导出时除外，导出界面必须明确提示内容包含明文 Token。

## 决策依据

- 用户于 2026-08-30 明确要求数据存盘，并在获知 Cockpit Tools 明文保存 Access/Refresh Token 后要求照抄其持久化逻辑。
- Cockpit Tools `crates/cockpit-core/src/modules/cursor_account.rs`：账号文件序列化、索引和恢复逻辑。
- Cockpit Tools `crates/cockpit-core/src/modules/atomic_write.rs`：原子写与 `.bak` 回滚。
- Cockpit Tools `crates/cockpit-core/src/models/cursor.rs`：完整账号及凭据字段。
