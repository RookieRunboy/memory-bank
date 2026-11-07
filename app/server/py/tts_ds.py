# 阿里百炼 qwen-audio-3.1-tts 合成：读 stdin 的 JSON {model, voice, text}，把 24kHz 单声道 16bit PCM 边收边写到 stdout。
# 为什么用 Python：同一个 key 下，官方 dashscope SDK 能连上工作区端点，Node 的 ws 客户端被 403（Endpoint.AccessDenied），原因未查清。
# key 与 ws 地址从环境变量读取（DASHSCOPE_API_KEY / DASHSCOPE_WS_URL），错误信息写 stderr 且不含 key。
import sys, os, json, threading
import dashscope
from dashscope.audio.tts_v2 import SpeechSynthesizer, ResultCallback, AudioFormat

req = json.load(sys.stdin)
key = os.environ['DASHSCOPE_API_KEY']
dashscope.api_key = key
dashscope.base_websocket_api_url = os.environ['DASHSCOPE_WS_URL']
out = sys.stdout.buffer
state = {'err': None}
done = threading.Event()

class CB(ResultCallback):
    def on_data(self, data): out.write(data); out.flush()
    def on_complete(self): done.set()
    def on_error(self, message): state['err'] = str(message); done.set()
    def on_close(self): done.set()

try:
    s = SpeechSynthesizer(model=req['model'], voice=req['voice'], format=AudioFormat.PCM_24000HZ_MONO_16BIT, callback=CB())
    s.call(req['text'])
    done.wait(30)
except BaseException as e:
    state['err'] = state['err'] or str(e)
if state['err']:
    sys.stderr.write(state['err'].replace(key, '<KEY>')[:300]); sys.exit(2)
