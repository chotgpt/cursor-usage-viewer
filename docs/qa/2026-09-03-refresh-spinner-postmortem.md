# 刷新旋转反馈连续验收失败复盘

日期：2026-09-03

范围：Cursor 账号页刷新按钮、加载动画与视觉验收流程

权威依据：`docs/DECISIONS.md` §D-017、§D-022；Cockpit Tools 固定提交 `a0508ae815e104e931dae515389e680840008367`

## 用户可见故障

用户连续反馈点击刷新后只看到按钮置灰，看不到 Cockpit 中清晰的旋转反馈。前两轮修复均过早宣布完成，实际没有达到肉眼可辨的产品验收标准。

## 连续失败与错误判断

1. **第一次失败：只有状态 class，没有动画样式。** 页面已给刷新图标添加 `loading-spinner`，但仓库没有对应 keyframes。检查只验证了 DOM class，没有验证计算样式或真实渲染，导致把“代码路径存在”误报为“动画完成”。
2. **第二次失败：机器在转，不等于用户看得见。** 补充 keyframes 后，14px 的 Lucide 箭头确实发生 transform，但按钮禁用态将整体透明度降到 `0.42`。当时用矩阵变化证明动画运行，却错误地把实现级证据当成了视觉完成证据。
3. **第三次失败：修正透明度后仍未对齐上游视觉实现。** 虽然忙碌态透明度恢复为 `1`，但仍只是旋转小箭头。没有在修改前读取固定上游的 `src/styles/pages/loading.css`，遗漏 Cockpit 实际使用的 20px、2px 边框、顶部高亮的不对称圆环，也遗漏了上游对关键 loading spinner 的 reduced-motion 例外。这违反了仓库 Cockpit 对齐门要求的“先读实际来源实现”和四方交叉核对原则。

## 最终根因

- 上游读取范围不完整：只核对了 `CursorAccountsPage.tsx` 中 class 的使用，没有继续追踪 class 的 CSS 定义。
- 测试契约过浅：只断言 `.loading-spinner` 存在，没有断言 `animation-name`、20px 尺寸、2px 边框、忙碌态不降透明度，以及 reduced-motion 下关键进度反馈仍存在。
- 验收证据错误：DOM、计算矩阵和测试绿灯不能替代真实窗口中的肉眼可辨视频。

## 修正方案

- 按固定上游 `src/styles/pages/loading.css` 恢复 20px、2px 边框、顶部主色高亮、0.8 秒旋转的 loading ring。
- 通过 `aria-busy="true"` 标记真实忙碌控件；只让这些控件在禁用期间保持全透明度和 progress 光标，不改变普通 disabled 控件。
- 在 reduced-motion 环境中继续保留这一关键进度反馈，与上游 `src/styles/base.css` 的语义一致。
- 账号卡片、列表、刷新全部、刷新选中及异步导入共用同一 loading spinner 规则。

## 防复发门禁

以后涉及上游样式行为时，完成声明前必须同时具备：

1. 固定提交中的 JSX 使用点和最终 CSS 定义；
2. 修复前失败、修复后通过的计算样式契约测试；
3. 真实 Tauri WebView 中拦截网络后的持续忙碌态录屏；
4. 人工查看录屏，确认变化肉眼可辨，而不是只引用 DOM、矩阵或快照数字；
5. 完整前端测试、构建和视觉回归结果。

任何一项缺失，都只能报告“实现进行中”，不得再次要求用户验收。

## 最终证据与验证结果

真实 Tauri WebView 录制时在页面内存中拦截 `refresh_cursor_account`，只保持忙碌态，不调用原始命令，因此没有使用真实凭据或发出 Cursor 网络请求。录制区域只包含刷新按钮及相邻无敏感信息的图标。

- 视频：`docs/qa/evidence/refresh-spinner-tauri-proof.mp4`
  - 2 秒、24 帧、12 FPS、480×480 放大视图
  - SHA256：`7048F58B139668E391F47CC1ED6D65873B60FD8CC9C97AAD08ACCE266F9DCF795`
- 四帧对照：`docs/qa/evidence/refresh-spinner-tauri-frames.png`
  - SHA256：`3C42E89C5F755683DEF1DD40A01FADAB76E555B034E43FF66E37D4D8282A3588`
  - 四个源帧 SHA256 均不同，蓝色高亮段依次位于不同方向。
- 真实 WebView 计算样式：`aria-busy=true`、按钮 `opacity=1`、尺寸 `20×20px`、`border-top-width=2px`、`animation-name=loading-spin`、`animation-duration=0.8s`。
- 修复前契约测试先捕获两类失败：忙碌按钮透明度为 `0.42`；reduced-motion 环境中 `animation-name` 为 `none`，图标仍为 14px 且没有 Cockpit 圆环。
- 修复后：前端 66/66、视觉/行为 36/36、Rust 55/55、发布脚本 28/28；生产构建、Rust fmt、Clippy、版本同步检查全部通过。
- 凭据扫描：203 个 tracked files 通过。
