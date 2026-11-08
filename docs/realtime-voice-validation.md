# 实时语音对话交付与验证

日期：2026-11-08（Asia/Shanghai）。在现有未提交工作区继续实现，未提交、未部署。

## 交互与数据流

- 现有共享麦克风同时供原声保存、分轮与在线识别使用；人声确认后带句头前缓冲发送16kHz PCM，静音期间不创建识别话语。
- 右侧同一气泡显示真实中间转写，允许识别服务修正文字；正式轮次以最终原始转写定稿。长段分块的后台归档不覆盖仍在增长的在线预览。
- 识别流使用当前百炼工作区的 qwen-audio-3.1-asr-flash-streaming。final结果由服务端随机sessionId绑定访谈/utterance保存2分钟，正式POST可复用。token在发出前写入原有本机待提交记录，重试保持同一请求指纹。失败、过期或长录音分段仍走原来的录音识别。
- 主持人POST使用SSE；reply-draft仅把真实生成的say文字送到左气泡，reply表示已校验且可播的稳定句子。稳定句子追加到同一个TTS任务，后句可以预取，结束时刷新尾句。
- 只对实时主持人去掉造成中转整包缓冲的response_format，仍要求JSON并最终严格解析；DeepSeek实时请求使用非思考模式，其他调用不变。
- 插话停止旧音频且屏蔽迟到草稿/稳定句；稳定回复携带ask/phase，按responseId同步实际问题归属。静音不关闭识别。暂停前的请求不能在暂停后突然启动新播报。
- 每次实际显示的回复前缀会保存在本机；流中刷新可恢复该前缀，重播只读屏幕上的文字，不读尚未显示的尾巴。
- 圆球旁和当前用户气泡底部的细线均由实际PCM能量驱动，安静时回到平线；圆球继续随音量缩放。

## 最终自动化验证

- `npm test`：163项通过，0失败；含PCM前缓冲和重采样、ASR final token确认、SSE字节边界、草稿与稳定句分离、取消、幂等及断连原声保存。
- `npm run build`、`git diff --check`：通过。
- 原持续语音浏览器五场景通过，0页面异常。
- 新实时浏览器13项检查通过：8次唯一轮次、1次中途刷新缓存重试、7个识别WebSocket；页面和模拟服务错误均为0。[最终报告](../app/screenshots/realtime-voice/synthetic-results.json)
- 覆盖停说前右侧出字、同气泡纠错、未成句草稿先显示且不进TTS、稳定首句在HTTP结束前开始播报、插话后迟到文字/音频不复活、话题与阶段对齐、静音、ASR断线回退、暂停/离页释放、PCM波形、真正中途刷新与重播不读隐藏尾巴。
- 这些浏览器检查使用合成麦克风及真实本地HTTP分块和WebSocket传输，供应商由可控服务替代，不等同真人声学验收。
- 另有3项定向浏览器检查通过，验证插话后切到打字时，问题原文、ID、话题与阶段来自同一条可见消息。[状态回归报告](../app/screenshots/realtime-voice/ui-state-results.json)
- 本机只读核验：ASR配置接口HTTP200且enabled为true，前端HTTP200并提供reply-draft集成代码。

## 真实服务探测与限制

所有探测均使用合成中文和隔离数据库，没有使用真人或老人录音，未输出密钥或完整工作区地址。

- ASR直接SDK和完整Node桥均确认停说前持续产生中间文字。一次Node桥冷启动首字约4.31秒（开始发送音频后约2.86秒），finish后约440ms收齐。[安全报告](../app/screenshots/realtime-voice/asr-service-probe.json)
- 首次真实ASR→主持人→TTS整链确认缓存复用（ASR阶段1ms）和音频流。首稳定句出现即请求TTS，比完整result早269ms，但TTS首网络数据仍等4508ms；合成音频结束到首音频网络数据约9081ms，不含真人端点和硬件播放。该探测发生在新增字符草稿前，因当时只有一个稳定句事件，hostMultipleReplyUpdates未通过，保留原报告pass:false。[原始整链报告](../app/screenshots/realtime-voice/service-results.json)
- 根据该结果新增reply-draft后，真实主持人15字小样收到10次真实文字更新，约3.13秒开始，完整JSON约3.58秒。短句的更新几乎同一网络批到达，不能把更新次数当成肉眼可见的十次刷新，也不是稳定延迟分布。[草稿实测摘要](../app/screenshots/realtime-voice/host-draft-probe.json)
- 已接上真实增量链路，实际首字和首声速度仍受服务、网络及输出分块影响。尚未达到或证明达到ChatGPT实时通话的延迟；真人麦克风、外放回声与手机真机听感继续待验收。

## 复测与配置

在app目录运行 npm test、npm run build；浏览器完整持续语音回归为 node test/voice-browser.mjs，新的真实HTTP分块SSE/WebSocket合成回归为 node test/voice-realtime-browser.mjs。后者不调用付费服务，截图与报告位于 screenshots/realtime-voice/。

真实单次探测用 node scripts/probe-realtime-voice.mjs /绝对路径/合成16k单声道.wav /tmp/realtime-results.json；它会调用现有供应商，不是模拟测试。最终脚本单独统计draft与稳定句。

依赖安装与可选开关见 [Python语音环境](../app/server/py/README.md)。本机已配置的凭据可直接复用；REALTIME_ASR_ENABLED=0 可关闭在线识别预览。前端与后端都已提供新接口，刷新现有访谈页面即可使用。

协议依据：[阿里云流式ASR客户端事件](https://help.aliyun.com/zh/model-studio/qwen-audio-asr-streaming-client-events)、[DeepSeek思考模式控制](https://api-docs.deepseek.com/guides/thinking_mode/)、[Chat Completions流式接口](https://api-docs.deepseek.com/api/create-chat-completion/)。
