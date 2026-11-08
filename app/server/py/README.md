# 百炼 TTS 的本地 Python 环境

Node 后端通过 `tts_ds.py` 使用当前百炼声音配置。SDK 安装在 `app/.venv/`，不修改系统 Python，也不提交虚拟环境或密钥。

在仓库根目录执行：

```bash
python3 -m venv app/.venv
app/.venv/bin/python -m pip install -r app/server/py/requirements.txt
cd app
npm run dev:api
```

也可以使用 uv：

```bash
uv venv app/.venv --python python3.12
uv pip install --python app/.venv/bin/python -r app/server/py/requirements.txt
```

后端依次使用 `DASHSCOPE_PYTHON`、`app/.venv/bin/python`、系统 `python3`。Windows 的本地路径是 `app/.venv/Scripts/python.exe`。`DASHSCOPE_PYTHON` 可以写在已忽略的 `app/.env.local`，部署时也可用环境变量指定。`DASHSCOPE_API_KEY`、`DASHSCOPE_WS_URL` 以及现有模型/声音配置继续只在服务端读取。

`requirements.txt` 固定使用 [DashScope 官方 SDK](https://pypi.org/project/dashscope/) 的 1.x 版本，与当前 `dashscope.audio.tts_v2.SpeechSynthesizer` 适配器一致。升级 SDK 后应先使用合成文本做语音探测。

如果启动后回退到浏览器朗读，先用以下命令检查 SDK，再检查账号、服务额度和网络。不要在诊断输出里打印密钥或工作区地址。

```bash
app/.venv/bin/python -c "from dashscope.audio.tts_v2 import SpeechSynthesizer; print('TTS SDK ready')"
```

## 合成素材联调与计时

在 macOS 上可先离线生成测试音频（不会通过扬声器播放），再从仓库根目录跑隔离服务探测：

```bash
say -v Tingting -o /tmp/mb-synthetic.aiff '我小时候住在扬州，院子里有一棵桂花树。'
afconvert -f WAVE -d LEI16@16000 -c 1 /tmp/mb-synthetic.aiff /tmp/mb-synthetic.wav
node app/scripts/probe-voice-services.mjs /tmp/mb-synthetic.wav 3 /tmp/mb-service-metrics.json
```

脚本只创建临时数据目录和临时端口，使用已有服务配置进行至多三轮真实 ASR、主持人、TTS 调用；不打开本机保存的访谈库，也不输出转写或密钥。它记录 ASR/主持人处理耗时、后端往返和 TTS 首段网络数据的到达时间。报告中的 `endToFirstNetworkMs` 是这些实测值加上配置的 2200 ms 端点等待，**不包含真实扬声器的输出延迟，也不是实测老人说完到听见回复**。设备、外放回声和轻声插话需要另做真机测试。

## 实时转写

`asr_ds.py` 复用同一个 DashScope SDK 和服务器凭据。默认模型为 `qwen-audio-3.1-asr-flash-streaming`，默认沿用 `DASHSCOPE_WS_URL`。可用服务端变量 `DASHSCOPE_ASR_MODEL`、`DASHSCOPE_ASR_WS_URL`、`DASHSCOPE_ASR_PYTHON` 覆盖；`REALTIME_ASR_ENABLED=0` 可关闭在线预览并保留原按段识别。

浏览器访问同源 `/api/asr/stream`，传16kHz单声道PCM；Vite代理已启用WebSocket。服务端负责上游鉴权、连接释放、缓存最终文字和有限缓冲。前端不持有供应商密钥。

单次真实整链探测（合成中文，使用现有服务额度；数据库隔离）：

```bash
cd app
node scripts/probe-realtime-voice.mjs /tmp/mb-synthetic.wav /tmp/mb-realtime-probe.json
```

记录只包含技术计时与通过项，不输出原话或凭据；真实结果与合成浏览器回归分开保存在 `screenshots/realtime-voice/`。原始首轮探测在加入字符草稿前执行，`hostMultipleReplyUpdates` 未通过，不能当成最终版全部通过报告；后续字符草稿实测见实时语音验证文档。
