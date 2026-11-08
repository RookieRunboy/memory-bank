// 阿里百炼 DashScope 语音合成（qwen-audio-3.1-tts）：与 gemini.mjs 的 ttsCall / ttsStream 同签名，产出 24kHz 单声道 16bit PCM，
// 所以 tts.mjs 的 WAV 头、缓存、流式播放全部复用。key 与 ws 地址只在后端读取，绝不下发前端/打印。
// 实现是调用 server/py/tts_ds.py（官方 dashscope SDK）：同一个 key 下，Node 直连工作区 WebSocket 被 403，原因未查清，所以走 Python 子进程。
// 配置（环境变量或 .env.local）：DASHSCOPE_API_KEY、DASHSCOPE_WS_URL（工作区专属地址）、DASHSCOPE_TTS_MODEL、DASHSCOPE_TTS_VOICE、DASHSCOPE_PYTHON；TTS_PROVIDER=gemini 可强制关闭
import { spawn } from 'child_process'; import fs from 'fs'; import path from 'path'; import { fileURLToPath } from 'url';
import { env } from './openai.mjs';
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'py/tts_ds.py');
const cfg = () => ({ key: env('DASHSCOPE_API_KEY'), url: env('DASHSCOPE_WS_URL') });
export const dsEnabled = () => { const c = cfg(); return !!(c.key && c.url) && env('TTS_PROVIDER') !== 'gemini'; };
export const DS_DEFAULTS = { model: env('DASHSCOPE_TTS_MODEL') || 'qwen-audio-3.1-tts-flash', voice: env('DASHSCOPE_TTS_VOICE') || 'wenhuaizhi_v3.1' };
const RATE = 24000;
const LOCAL_PYTHON = path.resolve(path.dirname(SCRIPT), '../../.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
// An explicit deployment setting wins; local demos use their isolated SDK.
export const ttsPython = ({ configured = env('DASHSCOPE_PYTHON'), local = LOCAL_PYTHON, exists = fs.existsSync } = {}) => configured || (exists(local) ? local : 'python3');

// 流式：子进程边收边写 stdout，这里边读边 yield（块长保证是 2 字节的整数倍）。首块前超过 firstTimeout、之后块间隔超过 15 秒都算超时
export async function* dsStream(model, text, voice, { firstTimeout = 8000, signal, script = SCRIPT, python = ttsPython() } = {}) {
  if (signal?.aborted) throw new Error('已取消');
  const { key, url } = cfg(); if (!key || !url) throw new Error('未配置 DASHSCOPE_API_KEY / DASHSCOPE_WS_URL');
  const redact = s => String(s).split(key).join('<KEY>');
  const p = spawn(python, [script], { env: { ...process.env, DASHSCOPE_API_KEY: key, DASHSCOPE_WS_URL: url, PYTHONWARNINGS: 'ignore' }, stdio: ['pipe', 'pipe', 'pipe'] });
  const q = []; let wake = null, done = false, err = null, timer = null, carry = null, stderr = '';
  const poke = () => { const w = wake; wake = null; w?.(); };
  const fail = e => { if (!err && !done) err = new Error(redact(e?.message || e)); poke(); };
  const arm = ms => { clearTimeout(timer); timer = setTimeout(() => fail(new Error('TTS 超时')), ms); };
  const cancel = () => fail(new Error('已取消'));
  arm(firstTimeout); signal?.addEventListener('abort', cancel, { once: true });
  p.on('error', e => fail(new Error(`无法启动 ${python}：${e.message}`)));
  p.stdin.on('error', () => {}); p.stdin.end(JSON.stringify({ model, voice, text }));
  p.stderr.on('data', d => { stderr = (stderr + d).slice(-400); });
  p.stdout.on('data', d => { let b = carry ? Buffer.concat([carry, d]) : d; carry = null; if (b.length % 2) { carry = b.subarray(b.length - 1); b = b.subarray(0, b.length - 1); }
    if (b.length) { q.push(b); arm(15000); poke(); } });
  p.on('close', code => { if (code === 0) { done = true; poke(); } else fail(new Error(`TTS 失败 ${stderr.replace(/\s+/g, ' ').trim().slice(0, 150) || '退出码 ' + code}`)); });
  try {
    while (true) {
      if (err) throw err;
      while (q.length) { if (err) throw err; yield q.shift(); }
      if (err) throw err; if (done) return;
      await new Promise(r => { wake = r; });
    }
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', cancel); if (p.exitCode === null) p.kill(); }
}
// 整句：收齐所有 PCM 再返回（和 ttsCall 同形：{ pcm, mime }）
export async function dsCall(model, text, voice, timeout = 8000, opts = {}) {
  const parts = []; for await (const c of dsStream(model, text, voice, { firstTimeout: timeout, ...opts })) parts.push(c);
  if (!parts.length) throw new Error('TTS 无音频');
  return { pcm: Buffer.concat(parts), mime: `audio/L16;rate=${RATE}` };
}
