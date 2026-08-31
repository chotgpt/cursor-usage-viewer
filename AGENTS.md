# Cursor 额度查看器仓库规则

## 适用范围

本文件适用于整个仓库。产品语义与安全边界以 `docs/DECISIONS.md` 为准。

## Clean-room 与隐私

- 不复制或改写 Sirocco 的源码、资源、界面、品牌或文案；只可使用项目决策记录中列出的行为事实。
- Cockpit Tools UI 按 `docs/DECISIONS.md` §D-017 作为 CC BY-NC-SA 4.0 派生代码定向移植：只复用固定提交中 Cursor 页面、共享账号组件、经典侧栏、深浅主题与相关 CSS；必须记录来源、固定提交、原文件路径和修改，不得引入其他 Provider、sidecar、无关权限或品牌资源。
- 不自动读取 Cursor 数据，不在启动时联网。读取账号和查询额度都必须由用户在界面中主动触发。
- 按用户确认的 Cockpit 兼容持久化方案，Access Token 与 Refresh Token 可写入应用数据目录的账号明细及 `.bak`；普通列表/刷新 DTO、日志和错误不得包含 Token。只有用户主动粘贴导入或主动预览/复制/保存完整导出时，完整凭据才可进入前端。
- 生产网络请求只能访问 `docs/DECISIONS.md` §D-012 列出的 Cursor 第一方精确 HTTPS 端点；禁止重定向、任意 URL、遥测和远程日志。
- 未经用户明确授权，开发与测试不得读取本机真实 `state.vscdb`，不得使用真实凭据联网。

## 实现与验证

- SQLite 只读打开原数据库；不得复制数据库或用读写连接规避锁。
- 外部响应字段、单位、周期或认证细节没有权威证据时必须保持“未知”，不得通过端点名猜测。
- 网络测试使用 mock；fixture 必须脱敏且不得来自未经检查的真实响应。
- 新增敏感数据流、端点或权限前，先更新 `docs/DECISIONS.md` 并取得用户确认。
- 影响 Cursor 账号页布局或样式的改动必须运行 `npm run test:visual`；不得用 `--update-snapshots` 消除未知差异。基线更新必须与可解释的界面变更一起审核，并保留用户对候选版本的独立人工视觉验收。

## AI 开发与发布边界

- 自动化测试、CI、CodeQL、构建、签名、Draft、attestation 通过只证明对应技术门禁通过，不得声称用户已经验收产品或 stable 已具备发布资格。
- Agent 不得代替仓库 owner 创建、填写、修改、勾选、加标签或关闭 Release Acceptance Issue；不得批准或绕过 `stable-release` Environment；不得直接在 GitHub UI/API/CLI 发布 stable。
- 稳定版只能经 `.github/workflows/publish-stable.yml` 发布。必须满足 `docs/DECISIONS.md` §D-015 和 `docs/RELEASING.md` 的精确 tag/SHA、人工验收、required checks、Draft 完整性、SHA256、attestation 与双重人工确认门禁。
- 用户说“构建通过”“转公开”“生成 Draft”或“看起来没问题”均不等于授权发布 stable。stable 授权只对 Release Acceptance Issue 中记录的精确 tag/SHA 有效；任何代码、tag 或资产变化都会使授权失效。
- 人工验收未完成时，只能报告未完成项和提供测试方法；禁止用 mock、单测、截图、打包成功或 Agent 自测冒充用户产品验收和计划 §17.4 的真实多平台安装/更新 E2E。
