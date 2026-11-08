# 持续语音访谈实施记录（2026-11-08）

按用户确定的路线实施，保留当前主持人、视觉和供应商配置。工作目录为 `/Users/runbo/life/dream/memory-bank`，基于已有未提交改动工作。

- 会话层持有一个麦克风流。AudioWorklet 提取 PCM，本地人声确认、起始缓存、宽松停顿判定；逐轮和整场分段均编码完整 WAV。暂停释放音轨，恢复新建流，档案记录边界。
- 全部声音出口收敛到可取消播放器，取消请求、排队节点、朗读和等待；会话/输入版本拦截迟到结果。自动分轮不立即播放缓存短回应。
- 轮次在采集时快照实际听到的问题。前端持续收音、后台串行提交；服务端以访谈串行队列及持久请求 ID 防重。插话抑制旧回复，不撤销已接受原声。
- 本地 IndexedDB 暂存待提交原声，失败保持待重试；结束先关入口、刷尾段、等已接受轮次和原声保存，然后一次生成故事。
- 定向测试覆盖分轮、播放取消、迟到回复、重复写入、结束竞态。运行 app 的全部测试与构建；隔离演示数据做浏览器五轮流程和计时。真机声学、手机 HTTPS 不具备条件时明确列出待测。

采用 PCM/WAV 避免将 MediaRecorder 的单个 timeslice 误当可独立播放文件。规范依据：[MediaStream Recording 数据处理](https://www.w3.org/TR/mediastream-recording/#data-handling)、[Media Capture and Streams](https://www.w3.org/TR/mediacapture-streams/)。
