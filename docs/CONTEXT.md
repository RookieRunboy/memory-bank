# 开发上下文（给一起开发的小伙伴）

> 第一次进项目先读这一份，15 分钟能跑起来、知道改哪里、知道哪些线不能碰。
> 更新于 2026-11-07。项目变化快，以 `docs/decisions.md` 最新几条为准。

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
| [host-style.md](host-style.md) | 主持人风格层（**程序也直接读**） | 改小忆说话 |
| [interview-framework.md](interview-framework.md) | 话题网：42 个节点 × 四层深度 | 改选题 |
| [ia-and-storage.md](ia-and-storage.md) | 页面结构、三层存储 | 改数据或页面 |
| [../tasks.md](../tasks.md) | 任务清单 | 随时 |

## 3. 跑起来

```bash
cd app
npm install
# 可选：没有 key 也能跑，小忆会走规则兜底回复
echo 'GEMINI_API_KEY=你的key' > .env.local
npm run dev:all        # 后端 :8787 + 前端 :5173
npm test # 43 个测试，应该全过
```

打开 <http://localhost:5173>。启动时会自动灌入演示老人**王女士**（elder id `demo-wang`）。

- 老人端：`#/`，只有"开始聊天"大按钮。
- “我的”区域：老人首页右上角“看看我的故事”，进去是对话式首页、历史、我的故事、资料、设置。**没有登录。**
- 建档页有"填入演示档案（王女士）"按钮。

手机录音必须 HTTPS 或 localhost，局域网 IP 访问时麦克风会被浏览器拒绝。

## 4. 代码地图

```
app/
  server/
    index.mjs     所有 /api 路由 + SQLite 表结构（sql.js）
    ai.mjs        小忆：开场、每轮回复、转写整理、故事、档案。读 docs/interview.md 和 docs/host-style.md
    gemini.mjs    Gemini 调用、超时、模型回退
    tts.mjs       Gemini TTS（流式 + 预热缓存）
    seed.mjs      演示数据
  src/
    main.js       前端路由和老人端、访谈、故事、记忆库等页面
    shell.js      “我的”区域框架：侧边栏、对话式首页、历史、资料、设置
    planner.js    选题算法（话题网、候选卡片、变量替换）
    framework.json 话题网数据
    style.css     全部样式（记忆册风格）
  test/    node --test；fixtures/host-cases.json 是主持人评测用例
  screenshots/    各版本截图，最新是 v6/
  shoot*.mjs      Playwright 截图脚本
```

一轮访谈的数据流：

```
老人说话 → 前端 MediaRecorder 录音 → POST /api/interviews/:id/turn
  → Gemini 一次调用同时出：转写(raw/clean) + 分析 + 小忆回复（失败回退两步流程）
  → 写入 transcript_turns（只增不改）、更新话题状态和实体表
  → 前端先播预热好的短回应，再流式播 TTS 正式回复
访谈结束 → POST /finish → 生成记忆故事 + 后台整理记忆档案
```

## 5. 数据：三层存储，下层永远不动

1. **原声**：整场录音 + 每句片段（`DATA_DIR/audio`）。
2. **访谈稿**：`transcript_turns` 表，逐句原始转写和整理文本。**只插入，永不修改。**
3. **加工成果**：故事（`stories`）、实体表（`elder_state`）、档案。可以重新生成。

老人（以及将来经授权的人）改故事只改第 3 层，旧值写进 `edits` 表留痕，不碰老人原话。

本地数据在 `app/server/data/`（已 gitignore）。想清空重来就删这个目录。

## 6. 不能碰的线（来自 vision）

改小忆的提示词或回复逻辑之前，先确认不违反这些：

- **不编造**：只复述老人说过的。小忆没有自己的经历，不讲"我那时候也……"。
- **不替老人说感受**，只用"应该""肯定"轻推。
- **不纠正、不考老人**，不提病情和"阿尔茨海默症""记忆力不好"。
- 老人谈起遗忘的恐惧：只接住，**不说"不会的"，不给虚假安慰。**
- 称呼一律"姓＋先生/女士"。
- 每句不超 20 字、最多三句、一次一问。
- 老人看到的永远是自然的话，**不显示标签、选题理由、调试信息。**
- 视觉像记忆册，不像 AI 工具。“我的”区域借了对话式的结构，配色仍是暖黄纸感（2026-11-07 定）。

## 7. 现在做到哪

已完成：建档、语音访谈（话题网选题、老人自己选话题、先接住再提问）、Gemini 转写和回复、流式 TTS、记忆故事、记忆档案、人生地图、打包导出、“我的”区域侧边栏框架、主持人风格层、两位演示老人（王女士、徐先生，可在“我的资料”页切换）。

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
- **延迟**：目标是老人说完 4 秒内听到第一声。瓶颈是转写加回复的合并调用（2–7 秒不稳），不在 TTS。改每轮逻辑时别再加一次模型调用，实测会拖到 10 秒以上。
- `src/main.v1.js` 是早期纯前端版本，保留做离线兜底参考，新功能不要往里写。

## 9. 协作约定

- 提交信息：`<type>: <描述>`，type 用 feat / fix / refactor / docs / test / chore / perf。
- 做了产品层面的决定，就在 `decisions.md` 末尾追加一条，写日期和谁定的。
- 动了提示词：跑一遍 `npm test`，再拿 `test/fixtures/host-cases.json` 里的用例实际聊一下。
- 改了界面：用 `shoot-v6.mjs` 重新截图，放进 `app/screenshots/`，提交时一起带上。
- key 只放 `app/.env.local`，已 gitignore，不要贴进聊天或提交。
