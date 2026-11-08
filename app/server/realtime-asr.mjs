// Local browser -> provider bridge. Provider credentials never leave this module.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { env } from './openai.mjs';
import { ttsPython } from './dashscope.mjs';

const SCRIPT = fileURLToPath(new URL('./py/asr_ds.py', import.meta.url));
const transcripts = new Map(), CACHE_TTL_MS = 120000, CACHE_MAX = 128;
function pruneTranscripts(now = Date.now()) {
  for (const [id, value] of transcripts) if (value.expiresAt <= now) transcripts.delete(id);
  while (transcripts.size >= CACHE_MAX) transcripts.delete(transcripts.keys().next().value);
}
export function getRealtimeTranscript(sessionId, { interviewId, utteranceId } = {}) {
  const entry = transcripts.get(sessionId);
  if (!entry || entry.expiresAt <= Date.now()) { if (entry) transcripts.delete(sessionId); return null; }
  return entry.interviewId === interviewId && entry.utteranceId === utteranceId ? entry.text : null;
}
export const ASR_LIMITS = Object.freeze({ sampleRate: 16000, maxFrameBytes: 32000, maxAudioBytes: 16000 * 2 * 180,
  maxQueuedBytes: 16000 * 2 * 12, maxTextChars: 24000, connectMs: 12000, idleMs: 15000, finishMs: 15000, lifetimeMs: 200000 });
export const realtimeASRConfig = () => {
  const key = env('DASHSCOPE_API_KEY'), url = env('DASHSCOPE_ASR_WS_URL') || env('DASHSCOPE_WS_URL');
  return { enabled: !!(key && url) && env('REALTIME_ASR_ENABLED') !== '0', key, url,
    model: env('DASHSCOPE_ASR_MODEL') || 'qwen-audio-3.1-asr-flash-streaming', python: env('DASHSCOPE_ASR_PYTHON') || ttsPython() };
};

export function attachRealtimeASR(app, server, { config = realtimeASRConfig, spawnImpl = spawn, script = SCRIPT, limits = {} } = {}) {
  const cap = { ...ASR_LIMITS, ...limits };
  app.get('/api/asr/config', (_req, res) => res.json({ enabled: config().enabled, sampleRate: cap.sampleRate, maxUtteranceMs: cap.maxAudioBytes / 32 }));
  const wss = new WebSocketServer({ noServer: true, maxPayload: cap.maxFrameBytes, perMessageDeflate: false });
  const upgrade = (req, socket, head) => {
    let pathname;
    try { pathname = new URL(req.url, 'http://localhost').pathname; } catch { return; }
    if (pathname !== '/api/asr/stream') return;
    if (!config().enabled) { socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); socket.destroy(); return; }
    // The browser endpoint is same-origin. Avoid cross-site microphone uploads
    // to a local demo service whose existing API does not have accounts yet.
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) { socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return; } }
      catch { socket.destroy(); return; }
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  };
  server.on('upgrade', upgrade);
  wss.on('connection', ws => {
    let child = null, started = false, ready = false, finished = false, closed = false, utteranceId = '', interviewId = '', sessionId = '', finalText = null, audioBytes = 0, buffered = '', timer, hardTimer;
    const decoder = new StringDecoder('utf8');
    const send = event => {
      if (ws.readyState !== WebSocket.OPEN || closed) return;
      if (ws.bufferedAmount > cap.maxQueuedBytes) { shutdown(); return; }
      ws.send(JSON.stringify({ ...event, ...(utteranceId && { utteranceId }), ...(sessionId && { sessionId }) }));
    };
    const stopChild = () => {
      if (!child || child.exitCode != null) return;
      child.stdin.destroy(); child.kill('SIGTERM');
      const force = setTimeout(() => { if (child.exitCode == null) child.kill('SIGKILL'); }, 250); force.unref();
    };
    const shutdown = () => {
      if (closed) return;
      closed = true; clearTimeout(timer); clearTimeout(hardTimer); stopChild();
      if (ws.readyState === WebSocket.OPEN) ws.close(1000);
      const force = setTimeout(() => ws.terminate(), 500); force.unref();
    };
    const fail = code => { if (closed) return; send({ type: 'error', code }); shutdown(); };
    const arm = (ms, code = 'asr-timeout') => { clearTimeout(timer); timer = setTimeout(() => fail(code), ms); timer.unref(); };
    arm(cap.connectMs);
    hardTimer = setTimeout(() => fail('asr-session-limit'), cap.lifetimeMs); hardTimer.unref();
    const write = message => {
      if (!child?.stdin.writable || child.stdin.destroyed) { fail('asr-unavailable'); return; }
      if (child.stdin.writableLength > cap.maxQueuedBytes) { fail('asr-backpressure'); return; }
      child.stdin.write(JSON.stringify(message) + '\n');
    };
    const onProvider = event => {
      if (closed || !event || typeof event !== 'object') return;
      if (event.type === 'ready' && !ready) { ready = true; arm(cap.idleMs); send({ type: 'ready' }); }
      else if (event.type === 'transcript') {
        if (typeof event.text !== 'string' || event.text.length > cap.maxTextChars || typeof event.final !== 'boolean') return fail('asr-invalid-response');
        if (event.final) finalText = event.text;
        send({ type: 'transcript', text: event.text, final: event.final });
      } else if (event.type === 'done') {
        if (finished && finalText?.trim()) { pruneTranscripts(); transcripts.set(sessionId, { interviewId, utteranceId, text: finalText, expiresAt: Date.now() + CACHE_TTL_MS }); }
        send({ type: 'done' }); shutdown();
      }
      else if (event.type === 'error') fail(event.code === 'asr-access-denied' ? event.code : 'asr-unavailable');
    };
    ws.on('message', (bytes, binary) => {
      if (closed) return;
      if (binary) {
        if (!started || !ready || finished || !bytes.length || bytes.length % 2 || bytes.length > cap.maxFrameBytes) return fail('asr-invalid-audio');
        audioBytes += bytes.length;
        if (audioBytes > cap.maxAudioBytes) return fail('asr-session-limit');
        arm(cap.idleMs); write({ type: 'audio', data: bytes.toString('base64') }); return;
      }
      let message;
      try { if (bytes.length > 4096) throw Error(); message = JSON.parse(bytes.toString()); } catch { return fail('asr-invalid-message'); }
      if (message?.type === 'cancel') return shutdown();
      if (message?.type === 'finish' && started && ready && !finished) { finished = true; arm(cap.finishMs); write({ type: 'finish' }); return; }
      if (message?.type !== 'start' || started || message.sampleRate !== cap.sampleRate || ![message.utteranceId,message.interviewId].every(value => typeof value === 'string' && /^[a-zA-Z0-9:_-]{1,160}$/.test(value))) return fail('asr-invalid-message');
      started = true; utteranceId = message.utteranceId; interviewId = message.interviewId; sessionId = randomUUID();
      const cfg = config();
      try { child = spawnImpl(cfg.python, [script], { env: { ...process.env, DASHSCOPE_API_KEY: cfg.key, DASHSCOPE_ASR_WS_URL: cfg.url, PYTHONWARNINGS: 'ignore' }, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch { return fail('asr-unavailable'); }
      child.stdin.on('error', () => fail('asr-unavailable'));
      child.on('error', () => fail('asr-unavailable'));
      child.stderr.on('data', () => {}); // Never forward raw SDK/account errors.
      child.stdout.on('data', data => {
        buffered += decoder.write(data);
        if (buffered.length > cap.maxTextChars * 8) return fail('asr-invalid-response');
        let newline;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, newline); buffered = buffered.slice(newline + 1);
          try { onProvider(JSON.parse(line)); } catch { fail('asr-invalid-response'); }
        }
      });
      child.on('close', () => { if (!closed) fail('asr-unavailable'); });
      write({ type: 'start', model: cfg.model, sampleRate: cap.sampleRate });
    });
    ws.on('close', shutdown); ws.on('error', shutdown);
  });
  const close = () => { server.off('upgrade', upgrade); for (const ws of wss.clients) ws.terminate(); wss.close(); };
  server.once('close', close);
  return { close, wss };
}
