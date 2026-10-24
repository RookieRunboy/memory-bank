# Gemini API 连通性实测（2026-10-24 18:45 UTC+8，box 本机）

结论：**网络通，但 key 不可用（403 API_KEY_SERVICE_BLOCKED）**。

| 调用 | HTTP | 延迟 | 结果 |
|---|---|---|---|
| GET v1beta/models（列模型） | 403 | 161 ms | PERMISSION_DENIED |
| gemini-2.5-flash:generateContent | 403 | 38 ms | PERMISSION_DENIED |
| gemini-2.0-flash:generateContent | 403 | 36 ms | PERMISSION_DENIED |
| gemini-flash-latest:generateContent | 403 | 40 ms | PERMISSION_DENIED |

报错（已去 key）：
`Requests to this API generativelanguage.googleapis.com method google.ai.generativelanguage.v1beta.GenerativeService.GenerateContent are blocked.` reason=`API_KEY_SERVICE_BLOCKED`，consumer=`projects/196386881832`

含义：请求已到达 Google 并完成鉴权，但这个 key 在 Google Cloud 控制台被设置了「API 限制」，没有允许 Generative Language API（或所在项目禁用了该 API）。可用模型名无法列出。

修复：Google Cloud Console → API 和服务 → 凭据 → 该 key → API 限制，加入「Generative Language API」（或改为不限制）；或去 https://aistudio.google.com/apikey 新建一个 key，替换 .env.local。修复后运行 `node gemini-probe.mjs` 复测（脚本只从 .env.local 读 key，输出会把 key 替换掉）。

安全：key 只在 server/ 与 gemini-probe.mjs 中读取；前端不含；.gitignore 规则 `.env*` 已覆盖 .env.local。

---
## 更正：改用 Vertex AI express 接口（2026-10-24 18:46 UTC+8 实测）

AI Studio 接口（generativelanguage.googleapis.com）对该 key 403，**不再使用**。后端改为：

`POST https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-3-flash-preview:generateContent?key=$GEMINI_API_KEY`

| 模型 | HTTP | 延迟 | 结果 |
|---|---|---|---|
| gemini-3-flash-preview（默认思考） | 200 | 6890 ms | 通，返回中文问候 |
| gemini-3-flash-preview（thinkingLevel=low，JSON 输出） | 200 | ~1000 ms | 通，`{"say":"你好，祝你今天愉快！"}` |
| gemini-2.5-flash | 404 | 250 ms | `Publisher model ... gemini-2.5-flash was not found or your project does not have access to it`（项目 196386881832，us-central1） |

结论：**只用 gemini-3-flash-preview**（其他模型 404）。后端 `server/gemini.mjs` 已固定此模型、`thinkingLevel: low`（降低访谈轮次延迟），音频以 `inlineData {mimeType, data(base64)}` 传入。复测：`node gemini-probe.mjs`。

---
## 模型分工（2026-10-24 18:50 UTC+8 实测，同一 Vertex express 接口）

| 用途 | 配置项（env） | 默认模型 | 实测 |
|---|---|---|---|
| 语音转写整理 + 访谈实时对话 | `GEMINI_MODEL_FAST` | gemini-3.5-flash | 200，约 3.1 s（JSON，thinkingLevel=low） |
| 记忆故事生成 + 记忆档案更新 | `GEMINI_MODEL_PRO` | gemini-3.1-pro-preview | 200，约 5.5 s |
| 任一调用失败时回退 | `GEMINI_MODEL_FALLBACK` | gemini-3-flash-preview | 200，约 1 s |

回退已验证：把 FAST 设成 gemini-4-flash（404）时，自动改用 gemini-3-flash-preview 并成功。Gemini 4 系列全部 404，不用。回退也失败时，走规则兜底（固定问题库 + 演示故事/档案）。

---
## 模型分工更新（2026-10-24 18:52 UTC+8）

| 用途 | 模型链（依次回退） | 配置项 | 实测 |
|---|---|---|---|
| 语音转写整理 + 实时访谈 | gemini-3.8-flash → gemini-3.5-flash → gemini-3-flash-preview | `GEMINI_MODEL_FAST`、`GEMINI_MODEL_FAST_FALLBACKS`（逗号分隔） | 3.8-flash 200，但延迟波动大：6.5 s / 7.3 s / 26 s（首次） |
| 记忆故事 + 记忆档案更新 | gemini-3.1-pro-preview → gemini-3-flash-preview | `GEMINI_MODEL_PRO`、`GEMINI_MODEL_PRO_FALLBACKS` | 200，约 5.5 s |

- 为保证现场流畅，实时链每个模型 8 s 超时（`GEMINI_FAST_TIMEOUT_MS`），超时或报错就换下一个；pro 链 60 s。
- 截图实跑时 3.5-flash 出现过 429 RESOURCE_EXHAUSTED，自动回退成功。
- 已知风险：fake 麦克风的蜂鸣音偶尔被听写出“嗯，那会儿”一类短句（prompt 已要求无人声返回空、temperature=0，大部分情况返回空）。

---
## 实时链调整（2026-10-24 19:05 UTC+8，v2 验收后）

- 实时链（转写整理 + 实时访谈）默认改为：**gemini-3-flash-preview → gemini-3.5-flash**；**gemini-3.8-flash 不进实时链**（延迟 6–26 s，常超时）。
- 故事 / 记忆档案仍用 gemini-3.1-pro-preview → gemini-3-flash-preview。
- 单轮延迟见下方「复测」。

### 复测（2026-10-24，实时链 3-flash 优先 → 3.5-flash，每模型 8 s 超时）
脚本 `shoot2.mjs` 全流程两次访谈，回答为手动填入（asr=0，只计访谈 Agent）：
- 第 1 次访谈单轮：3714 / 3503 / 1241 / 1348 / 1778 ms
- 第 2 次访谈单轮：1137 / 1489 / 1250 / 4188 / 9307 ms（最后一轮 3-flash 8 s 超时回退 3.5-flash）
- 中位数约 1.6 s，10 轮中有 1 轮回退；另有开场 1 次 3-flash 超时回退。
- 结束生成（故事 + 档案并行，3.1-pro-preview）：16.5 s / 20.9 s。
- 同日早些时候 3.1-pro 出现 HTTP 429 和长时间无响应，pro 链最坏 60+60 s，截图脚本等待已放宽到 240 s。
- 页面错误 0。

### 结束页拆分（2026-10-24）：故事走 story 链（GEMINI_MODEL_STORY，默认 3-flash → 3.5-flash，20 s/模型），档案后台走 pro 链（3.1-pro，GEMINI_PRO_TIMEOUT_MS=30 s 后回退 3-flash）
- 故事出现耗时（从点结束到返回）：9759 ms / 12615 ms；更早一次 13452 ms
- 档案后台完成耗时（自结束起）：9241 ms / 13553 ms；更早一次 8463 ms
- 第二次开场若档案未完成：最多等 3 s，仍未完成则用上次访谈原话兜底（日志 `[opening] 档案未更新完，用上次访谈记录兜底`，已实测触发一次）
