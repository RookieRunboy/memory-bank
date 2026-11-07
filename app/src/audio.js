// 小忆的声音：从 main.js 原样搬出（Kore TTS 流式/整句、ACK 短回应、浏览器朗读兜底、手机自动播放解锁），逻辑未改
import * as P from './planner.js';
import { splitSentences, firstShort, ACKS, pickAck } from './split.js';
const player = new Audio(); let speakGen = 0, ttsOn = null;
let ttsStreamOn = false, actx = null;
const ttsReady = () => ttsOn ??= fetch('/api/tts/config').then(r => r.json()).then(c => { ttsStreamOn = !!c.stream && !!(window.AudioContext || window.webkitAudioContext); return !!c.enabled; }).catch(() => false);
// 流式播放：Web Audio 按块排队播放 24kHz PCM，边下边播
const AC = () => actx ??= new (window.AudioContext || window.webkitAudioContext)();
let srcs = [];
function openStream(t) { const c = new AbortController(), tm = setTimeout(() => c.abort(), 9000); // 首块 8 秒内没到就退回浏览器朗读
  const q = { chunks: [], done: false, ok: null, wake: null, c, next: null };
  fetch('/api/tts/stream?t=' + encodeURIComponent(t), { signal: c.signal }).then(async r => { if (!r.ok) throw 0; const rd = r.body.getReader();
    for (;;) { const { done, value } = await rd.read(); if (done) break; if (q.ok === null) { q.ok = true; clearTimeout(tm); } q.chunks.push(value); q.wake?.(); } })
    .catch(() => {}).finally(() => { clearTimeout(tm); if (q.ok === null) q.ok = false; q.done = true; q.wake?.(); q.next?.(); });
  return q; }
async function playStream(q, g) { const ctx = AC(); if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
  let t = Math.max(ctx.currentTime + 0.05, 0), rest = null, any = false;
  for (;;) { if (g !== speakGen) return true;
    if (!q.chunks.length) { if (q.done) break; await new Promise(r => q.wake = r); q.wake = null; continue; }
    let b = q.chunks.shift(); if (rest) { const m = new Uint8Array(rest.length + b.length); m.set(rest); m.set(b, rest.length); b = m; rest = null; }
    if (b.length % 2) { rest = b.slice(-1); b = b.slice(0, -1); } if (!b.length) continue;
    const n = b.length / 2, dv = new DataView(b.buffer, b.byteOffset, b.length), buf = ctx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
    const s = ctx.createBufferSource(); s.buffer = buf; s.connect(ctx.destination); t = Math.max(t, ctx.currentTime); s.start(t); t += buf.duration; srcs.push(s); any = true; }
  if (!any) return false;
  await new Promise(r => setTimeout(r, Math.max(0, (t - ctx.currentTime) * 1000))); return true; }
function unlockAudio() { // 手机浏览器：首次用户点击时解锁自动播放
  try { player.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA='; player.play().catch(() => {});
    if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(''); u.volume = 0; speechSynthesis.speak(u); } } catch {} ttsReady(); prefetchAcks(); try { AC().resume(); } catch {} }
function browserSay(text) { return new Promise(res => { if (!('speechSynthesis' in window)) return res();
  const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-CN'; u.rate = 1.0;
  const zh = speechSynthesis.getVoices().find(v => /zh|Chinese/i.test(v.lang)); if (zh) u.voice = zh;
  u.onend = u.onerror = res; speechSynthesis.speak(u); setTimeout(res, 15000); }); }
const fetchTTS = t => { const c = new AbortController(), tm = setTimeout(() => c.abort(), 9000); // 服务端单句 8 秒超时，这里多留 1 秒网络
  return fetch('/api/tts?t=' + encodeURIComponent(t), { signal: c.signal }).then(r => r.ok ? r.blob() : null).catch(() => null).finally(() => clearTimeout(tm)); };
const playBlob = b => new Promise(res => { const u = URL.createObjectURL(b); player.onended = player.onerror = () => { URL.revokeObjectURL(u); res(true); }; player.src = u; player.play().catch(() => { URL.revokeObjectURL(u); res(false); }); });
// 老人一说完立刻播一句缓存好的短回应（不等后端），正式回复接在它后面
const ackPlayer = new Audio(), ackBlobs = {}; let ackDone = Promise.resolve(), lastAck = null;
function prefetchAcks() { ttsReady().then(on => on && ACKS.forEach(a => ackBlobs[a] ??= fetchTTS(a))); }
function playAck() { const a = lastAck = pickAck(lastAck); const t0 = performance.now();
  ackDone = (async () => { const b = await Promise.race([ackBlobs[a] || fetchTTS(a), new Promise(r => setTimeout(() => r(null), 600))]);
    window.__ackMs = performance.now() - t0;
    if (b) await new Promise(res => { const u = URL.createObjectURL(b); ackPlayer.onended = ackPlayer.onerror = res; ackPlayer.src = u; ackPlayer.play().catch(res); }); else await browserSay(a); })();
  return ackDone; }
function setSpeaking(on) { document.body.classList.toggle('speaking', on); const el = document.getElementById('speakInd'); if (el) el.classList.toggle('hidden', !on);
  const live = document.getElementById('live'); if (live && !on && live.dataset.after) live.textContent = live.dataset.after; }
function stopSpeak() { speakGen++; player.pause(); srcs.forEach(x => { try { x.stop(); } catch {} }); srcs = []; try { speechSynthesis.cancel(); } catch {} setSpeaking(false); }
async function speak(text) { text = P.speakable(text || ''); stopSpeak(); const g = speakGen; const parts = firstShort(splitSentences(text)); if (!parts.length) return;
  setSpeaking(true); const on = await ttsReady();
  if (on && ttsStreamOn) { // 第一句立刻开流；后面的句子在前一句下载完后依次开流（低并发，避免 429）
    const qs = []; const open = i => { if (i >= parts.length || g !== speakGen) return; const q = qs[i] = openStream(parts[i]); q.next = () => open(i + 1); if (q.done) open(i + 1); };
    const ready = i => qs[i] ? Promise.resolve() : new Promise(r => { const iv = setInterval(() => { if (qs[i] || g !== speakGen) { clearInterval(iv); r(); } }, 30); });
    open(0); await ackDone;
    for (let i = 0; i < parts.length && g === speakGen; i++) { await ready(i); if (g !== speakGen) break; if (!(await playStream(qs[i], g)) && g === speakGen) await browserSay(parts[i]); }
    qs.forEach(q => { if (q && !q.done) q.c.abort(); }); if (g === speakGen) setSpeaking(false); return; }
  const jobs = on ? parts.map(fetchTTS) : parts.map(() => Promise.resolve(null));
  await ackDone; // 短回应还在播就等它说完再接上
  for (let i = 0; i < parts.length && g === speakGen; i++) { const b = await jobs[i]; if (g !== speakGen) break;
    if (!(b && await playBlob(b))) await browserSay(parts[i]); }
  if (g === speakGen) setSpeaking(false); }
export { speak, stopSpeak, unlockAudio, playAck, ackPlayer, browserSay };
