# 访谈双边聊天界面 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to implement the independent components and verify their integration. Preserve all existing uncommitted work.

**Goal:** 按用户确认的界面要求，左侧小忆、右侧用户，连续显示原始发言，底部保留语音反馈和通话控制。

**Architecture:** 用独立消息模型管理气泡、原始转写和稳定轮次 ID；页面骨架仅挂载一次，消息和状态局部更新。复用持续录音、提交队列和可取消播放器，真实音量从现有 PCM 回调到圆球，不改变原声存储和主持人行为。

**Tech Stack:** 原生 JavaScript、CSS、Web Audio、Node test、Playwright。

用户在本聊天确认方案并回复“没错”。沿用现有配色。在线服务当前按段返回文字，本次不得用打字动画伪装增量识别；已有浏览器增量结果应在同一用户气泡更新，服务最终结果以 raw 定稿。服务升级不与 UI 改造混为一项未经验证的完成声明。

- [x] 消息模型：新增 `app/src/interview-messages.js`，从已有访谈稿恢复问答，原话优先，重复请求去重，同一句长录音分块合并；GET 访谈补充已有 transcript 字段。定向 Node 测试验证真实顺序和去重。
- [x] 页面集成：修改 `app/src/voice-interview.js`，`InterviewMessages` 负责数据；只首次挂载骨架；历史可滚动，跟随新消息，用户上翻后不强制跳底；键盘焦点和打字内容在响应时保留；选择卡片、重播、暂停、重试、结束继续工作。
- [x] 语音状态：从 `VoiceCapture.onLevel` 将真实音量映射至底部圆球；说话时保留右侧占位，有真实增量结果时替换同一气泡，后台最终原话到达后定稿。
- [x] 样式：修改访谈 CSS，左/右位置与颜色区分角色；桌面和手机都采用可滚动消息区与底部语音区，遵守放大字体和减少动态效果设置。
- [x] 验证：`npm test`、`npm run build`、合成录音浏览器回归；新增多轮气泡、滚动保持、手动输入、恢复、手机布局检查与截图。不得宣称已验证真人外放、实际ASR速度或设备兼容性。
- [x] 文档：记录已确认的产品决定及实际验证结果，不提交或部署混合工作区。
