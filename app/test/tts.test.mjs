import test from 'node:test'; import assert from 'node:assert/strict'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { wavHeader, splitSentences, cacheKey, withTimeout, makeTTS, TTS } from '../server/tts.mjs';
test('WAV 头：44 字节、24kHz 单声道 16bit、长度正确', () => { const pcm = Buffer.alloc(4800), w = wavHeader(pcm);
  assert.equal(w.length, 44 + 4800); assert.equal(w.toString('ascii', 0, 4), 'RIFF'); assert.equal(w.toString('ascii', 8, 12), 'WAVE');
  assert.equal(w.readUInt32LE(4), 36 + 4800); assert.equal(w.readUInt16LE(20), 1); assert.equal(w.readUInt16LE(22), 1); assert.equal(w.readUInt32LE(24), 24000);
  assert.equal(w.readUInt32LE(28), 48000); assert.equal(w.readUInt16LE(34), 16); assert.equal(w.toString('ascii', 36, 40), 'data'); assert.equal(w.readUInt32LE(40), 4800); });
test('分句：按。！？；切、短尾并入、长句在逗号处再切', () => {
  assert.deepEqual(splitSentences('王女士，您好呀。今天想聊哪个？第一个，结婚那天；第二个，家乡的味道。'), ['王女士，您好呀。', '今天想聊哪个？', '第一个，结婚那天；', '第二个，家乡的味道。']);
  assert.deepEqual(splitSentences('真好。嗯。'), ['真好。嗯。']); assert.deepEqual(splitSentences(''), []);
  for (const s of splitSentences('这是一个很长很长的句子，里面有好几个分句，说的是那年在纺织厂里头的事情，还有瘦西湖边上的柳树，春天一到全都绿了。')) assert.ok(s.length <= 40); });
test('缓存键：模型/声音/语气前缀/文本任一变化都换键', () => { const k = cacheKey('你好', TTS);
  assert.equal(k, cacheKey('你好', { ...TTS })); for (const d of [{ model: 'x' }, { voice: 'Puck' }, { prefix: '慢点说：' }]) assert.notEqual(k, cacheKey('你好', { ...TTS, ...d }));
  assert.notEqual(k, cacheKey('你好呀', TTS)); });
test('超时回退：单句超时 reject（前端退回浏览器朗读），后台完成后仍写缓存', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tts-')); let calls = 0;
  const slow = (m, t) => new Promise(r => { calls++; setTimeout(() => r({ pcm: Buffer.alloc(10), mime: 'audio/L16;rate=24000' }), 80); });
  const tts = makeTTS(dir, { ...TTS, fallback: '' }, slow);
  await assert.rejects(tts.get('慢句', { timeout: 20 }), /超时/);
  await new Promise(r => setTimeout(r, 120)); assert.ok(tts.has('慢句')); const r = await tts.get('慢句'); assert.equal(r.cached, true); assert.equal(calls, 1);
  const bad = makeTTS(dir, { ...TTS, fallback: '' }, () => Promise.reject(new Error('HTTP 500'))); await assert.rejects(bad.get('坏句'));
  let used = []; const fb = makeTTS(dir, { ...TTS, model: 'a', fallback: 'b' }, m => { used.push(m); return m === 'a' ? Promise.reject(new Error('x')) : Promise.resolve({ pcm: Buffer.alloc(2), mime: '' }); });
  await fb.get('回退句'); assert.deepEqual(used, ['a', 'b']);
  assert.equal(await withTimeout(Promise.resolve(1), 10), 1); });
