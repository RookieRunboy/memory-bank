# 开发上下文（给一起开发的小伙伴）

> 第一次进项目先读这一份，15 分钟能跑起来、知道改哪里、知道哪些线不能碰。
> 更新于 2026-11-08。串题修复见 [voice-topic-validation.md](voice-topic-validation.md)。最新实时语音验收见 [realtime-voice-validation.md](realtime-voice-validation.md)，早期持续收音记录见 [continuous-voice-validation.md](continuous-voice-validation.md)。

## 1. 这是什么

**记忆银行**：替一个家庭存住老人一生里爱过的人、走过的地方、一路攒下的回忆，用老人自己的声音留给后代。

- 讲述者：确诊早期的阿尔茨海默症患者、高龄老人。纯语音，不用看屏幕、不用打字。
- 产品只面向老人本人（2026-11-07 定）。其他人经老人同意、用邀请码绑定后，才能看到老人愿意分享的内容；这个模块还没做。
- AI 主持人叫**小忆**，像一位老练的电台主持人陪老人聊天，聊完把原声和转写整理成"记忆故事"。

为什么做、坚持什么，全在 [vision.md](vision.md)。**改 vision 要 Tammy 确认。**

## 2. 先读这几份

| 文档 | 讲什么 | 什么时候读 |
|---|---|---|
| [vision.md](vision.md) | 产品理念和不变原则 | 第一天 |
| [requirements-tiers.md](requirements-tiers.md) | 需求分级 T0–T2，每条有验收标准 | 挑活之前 |
| [decisions.md](decisions.md) | 所有决策，按时间追加 | 想知道"为什么这样" |
| [interview.md](interview.md) | 主持人系统提示词、故事提示词（**程序直接读这个文件**） | 改小忆说话 |
| [host-style.md](host-style.md) | 简短追问示例（**程序也直接读**） | 改小忆说话 |
| [interview-framework.md](interview-framework.md) | 问题库：52 个话题 × 四层深度（不是人生清单） | 改选题 |
| [ia-and-storage.md](ia-and-storage.md) | 页面结构、三层存储 | 改数据或页面 |
| [../tasks.md](../tasks.md) | 任务清单 | 随时 |

## 3. 跑起来

```bash
cd app
npm install
# 可选：没有 key 也能跑，小忆会走规则兜底回复
echo 'GEMINI_API_KEY=你的key' > .env.local
npm run dev:all        # 后端 :8787 + 前端 :5173
npm test # 访谈、语音、数据及界面回归
```

打开 <http://localhost:5173>。启动时会自动灌入演示老人**王女士**（elder id `demo-wang`）。

- 老人端：`#/`，只有"开始聊天"大按钮。
- “我的”区域：老人首页右上角“看看我的故事”，进去是对话式首页、历史、我的故事、资料、设置。**没有登录。**
- 建档页有"填入演示档案（王女士）"按钮。

手机录音必须 HTTPS 或 localhost，局域网 IP 访问时麦克风会被浏览器拒绝。

开发后端现在使用 `node --watch`，模块改动会自动重启。如果之前已经用旧命令启动过后端，需要先重启一次；仅刷新 Vite 页面不会更新旧 Node 进程。前后端版本不一致时，新增录音事件接口会返回 404，不代表电脑断网。待提交录音可在后端恢复后重试。

## 4. 代码地图

```
app/
  server/
    index.mjs     所有 /api 路由 + SQLite 表结构（sql.js）
    ai.mjs        小忆：开场、每轮回复、转写整理、故事、档案。读 docs/interview.md 和 docs/host-style.md
    gemini.mjs    Gemini 调用、超时、模型回退
    tts.mjs       Gemini / 百炼 TTS（流式 + 预热缓存）
    realtime-asr.mjs / py/asr_ds.py  在线流式识别与短期最终结果缓存
    interview-stream.mjs / streaming-json.mjs  主持人 SSE 与结构化文本增量解析
    seed.mjs      演示数据
  src/
    main.js       前端路由和老人端、访谈、故事、记忆库等页面
    voice-interview.js  持续语音会话、双边聊天视图、问题快照、结束与恢复
    interview-messages.js  原话气泡、分段合并、稳定消息 ID 与历史恢复
    realtime-transcription.js / stream-events.js  实时识别客户端、重采样和 SSE 消费
    voice-capture.js / voice-vad.js / voice-worklet.js  共享麦克风、PCM、分轮与完整 WAV
    voice-playback.js  流式/整句/浏览器朗读统一取消与计时
    voice-session.js / voice-outbox.js  串行提交、迟到结果屏蔽、本机待提交录音
    shell.js      “我的”区域框架：侧边栏、对话式首页、历史、资料、设置
    planner.js    选题算法（问题库、候选卡片、变量替换）
    framework.json 问题库数据
    style.css     全部样式（记忆册风格）
  test/    node --test；fixtures/host-cases.json 是主持人评测用例
  screenshots/    实时语音截图/报告在 realtime-voice/；聊天布局见 interview-chat/，其他页面见 v6/
  shoot*.mjs      Playwright 截图脚本
```

一轮访谈的数据流：

```
一次开麦 → 共享 PCM 持续收音 → 人声确认后在线 ASR 边收边转写
  → 停顿分轮 / 完整 WAV → /choose 或 /turn（可复用服务端 ASR final）
  → 主持人 SSE：真实文字草稿立即显示，稳定句子逐句启动流式 TTS
  → 写入 transcript_turns（只增不改）、更新话题状态和实体表
  → 插话取消旧播放并屏蔽迟到文字，录音继续；流失败回退原按段流程
访谈结束 → 停轨/刷尾段 → 等待轮次和整场分段保存 → /finish → 故事 + 后台档案
```

## 5. 数据：三层存储，下层永远不动

1. **原声**：整场录音 + 每句片段（`DATA_DIR/audio`）。
2. **访谈稿**：`transcript_turns` 表，逐句原始转写和整理文本。**只插入，永不修改。**
3. **加工成果**：故事（`stories`）、实体表（`elder_state`）、档案。可以重新生成。

新语音片段是独立 PCM WAV；整场按完整 WAV 分段保存，暂停/恢复和播放打断事件单独记录。派生 `*-full.wav` 兼容原有回放。`interview_requests` 持久保存幂等结果；当前单进程按访谈串行写入。网络失败的待提交原声存入浏览器 IndexedDB，再点首页入口可恢复未结束访谈。

老人（以及将来经授权的人）改故事只改第 3 层，旧值写进 `edits` 表留痕，不碰老人原话。

本地数据在 `app/server/data/`（已 gitignore）。想清空重来就删这个目录。

## 6. 不能碰的线（来自 vision）

改小忆的提示词或回复逻辑之前，先确认不违反这些：

- **不编造**：只复述老人说过的。小忆没有自己的经历，不讲"我那时候也……"。
- **不替老人说感受**，回应老人明确表达的感受，不推测、不下结论。
- **不纠正、不考老人**，不提病情和"阿尔茨海默症""记忆力不好"。
- 老人谈起遗忘的恐惧：只接住，**不说"不会的"，不给虚假安慰。**
- 称呼一律"姓＋先生/女士"。
- 通常一两句，每句不超 20 字、最多三句、一次一问。可以直接追问，不强制先复述。
- 老人看到的永远是自然的话，**不显示标签、选题理由、调试信息。**
- 视觉像记忆册，不像 AI 工具。“我的”区域借了对话式的结构，配色仍是暖黄纸感（2026-11-07 定）。

访谈界面采用左侧小忆、右侧用户的连续聊天流，底部保留语音控制、真实音量圆球和波形。已接入百炼在线实时转写、主持人真实文字增量和逐句播报，用户上翻时保持阅读位置。当前实际供应商仍有数秒首字/首声等待，不能宣称已达到 ChatGPT 通话延迟。最新交付见 [realtime-voice-validation.md](realtime-voice-validation.md)，布局改造记录见 [interview-chat-validation.md](interview-chat-validation.md)。

## 7. 现在做到哪

已完成：建档、语音访谈（问题库选题、老人自己选话题、先接住再提问）、Gemini 转写和回复、流式 TTS、记忆故事、记忆档案、打包导出、“我的”区域侧边栏框架、主持人风格层、两位演示老人（王女士、徐先生，可在“我的资料”页切换）。

下一步（详见 requirements-tiers.md）：

- **片段（moment）存储层**：把故事拆成能回溯原声的片段，做人物页、时间线、"听他怎么说"。还没写进需求文档。
- **T1-3 转写存档层**：SenseVoice / Qwen3-ASR，等阿里云 key。
- **亲友绑定（邀请码）模块**：老人逐条授权分享，见 T2-1，依赖真账号体系。
- **T0-1 评分**：用真实 key 跑 10 条主持人用例做人工评分。
- 暂不做：上线部署、真账号体系、Postgres、合规方案（当前只做本地演示）。

## 8. 踩过的坑

- **现在没有任何登录和鉴权**：后端接口谁都能调，数据按 elder id 区分。只能用于本地演示，不能放真实老人数据。亲友绑定要做真账号体系，见 requirements-tiers.md T2-1。
- **Render 免费档没有持久盘**：`render.yaml` 里 `DATA_DIR=/tmp/...`，重启就清空。现在不上线，所以没管。
- **改了 interview.md 或 host-style.md 要重启后端**，提示词在启动时读一次。
- **提示词里的花括号是变量**，替换后有残留会直接报错（`assertNoVars`）。新增变量要同步改 `planner.js`，`test/vars.test.mjs` 会兜底检查。
- **本机开了网络代理时**，`curl localhost` 可能返回 502，用 `curl --noproxy '*'`。Playwright 截图脚本也要加 `--no-proxy-server`。
- **Playwright 浏览器版本**：`playwright@1.64` 要的浏览器不一定装了，跑截图前先 `npx playwright install chromium`，或者在 `executablePath` 指向本机已有的版本（见 `shoot-v6.mjs`）。
- **延迟**：目标仍是老人说完 4 秒内听到正式回复。2026-11-08 合成素材的真实服务探测显示 ASR、主持人和 TTS 都有较大等待，尚未达标；具体分段计时见验收报告。自动分轮默认等 2.2 秒，优先保留慢速叙述；不要额外增加每轮模型调用。
- **百炼本机依赖**：使用 `app/.venv` 的官方 SDK，安装见 [server/py/README.md](../app/server/py/README.md)。配置只在服务端，浏览器未配置密钥。
- `src/main.v1.js` 是早期纯前端版本，保留做离线兜底参考，新功能不要往里写。

## 9. 协作约定

- 提交信息：`<type>: <描述>`，type 用 feat / fix / refactor / docs / test / chore / perf。
- 做了产品层面的决定，就在 `decisions.md` 末尾追加一条，写日期和谁定的。
- 动了提示词：跑一遍 `npm test`，再拿 `test/fixtures/host-cases.json` 里的用例实际聊一下。
- 改了界面：用 `shoot-v6.mjs` 重新截图，放进 `app/screenshots/`，提交时一起带上。
- key 只放 `app/.env.local`，已 gitignore，不要贴进聊天或提交。

## 10. 范成采访寒春的演示数据（2026-11-08）

`demo-data/fancheng-hanchun/` 提供范成（采访者）与寒春（受访者）的 6 场虚构访谈、81 轮问答、6 篇记忆故事，以及出处明确的人物、地点、事件和时间线。数据包入口见该目录 `README.md`；它保留原始问答 TXT/JSON、整理稿、故事、资料和录屏提纲。

账号模型尚未实现：范成保存在 `user.json` 与讲述者 `profile.demoInterviewer` 中，寒春使用 `elders.id = demo-hanchun`，不把范成的姓名和寒春的生平混成同一个人。`seed-fancheng.mjs` 只在此演示讲述者不存在时插入，不自动重灌。访谈 ID 为 `i-fancheng-1` 到 `i-fancheng-6`。新增演示入口在「我的资料」；首次访问也可直接进 `#/account` 选择。

此套故事和档案是预写 mock 加工成果，不是运行时模型生成记录。对白与生活细节为创作；2026 年时间为演示排期，轮次时长为估算。历史来源和边界见 `research/`。没有历史录音；页面显示「轮访谈文本」「查看出处」。故事修改按范成署名，原稿不改。

在 `app` 目录运行 `node scripts/export-fancheng-demo.mjs` 重生成数据包，运行 `node --test test/fancheng-demo.test.mjs` 检查引用、身份和不覆盖行为。新独立数据库的后端默认设为端口 8788 后，可运行 `node scripts/verify-fancheng-demo.mjs` 验证 API、ZIP、桌面和手机页面；也可用 `DEMO_URL` 指定地址。截图与结果在 `app/screenshots/fancheng-demo/`。
