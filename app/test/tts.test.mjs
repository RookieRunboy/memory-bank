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

// 阿里 DashScope 子进程客户端：用假脚本代替真实 Python，不联网
import { dsStream, dsCall } from '../server/dashscope.mjs';
const fakePy = (dir, body) => { const f = path.join(dir, 'fake.py'); fs.writeFileSync(f, body); return f; };
test('dashscope：子进程 PCM 流式透传，奇数字节对齐成 2 字节整数倍', async () => {
  process.env.DASHSCOPE_API_KEY = 'sk-ws-test-secret'; process.env.DASHSCOPE_WS_URL = 'wss://x.example/api-ws/v1/inference';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
  const ok = fakePy(dir, "import sys,json,time\nreq=json.load(sys.stdin)\nsys.stdout.buffer.write(b'\\x01\\x02\\x03'); sys.stdout.flush(); time.sleep(0.05); sys.stdout.buffer.write(b'\\x04\\x05\\x06'); sys.stdout.flush()\n");
  const chunks = []; for await (const c of dsStream('m', '你好', 'v', { script: ok })) chunks.push(c);
  assert.ok(chunks.every(c => c.length % 2 === 0)); assert.deepEqual([...Buffer.concat(chunks)], [1, 2, 3, 4, 5, 6]);
  const r = await dsCall('m', '你好', 'v', 5000, { script: ok }); assert.equal(r.pcm.length, 6); assert.equal(r.mime, 'audio/L16;rate=24000');
});
test('dashscope：子进程失败 → 抛错且不泄露 key；无音频 → 抛错', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-'));
  const bad = fakePy(dir, "import sys\nsys.stderr.write('TaskFailed sk-ws-test-secret boom'); sys.exit(2)\n");
  await assert.rejects(dsCall('m', 'x', 'v', 5000, { script: bad }), e => /TaskFailed/.test(e.message) && !e.message.includes('sk-ws-test-secret'));
  const empty = fakePy(dir, "import sys\nsys.stdin.read()\n");
  await assert.rejects(dsCall('m', 'x', 'v', 5000, { script: empty }), /无音频/);
  const slow = fakePy(dir, "import time\ntime.sleep(5)\n");
  await assert.rejects(dsCall('m', 'x', 'v', 300, { script: slow }), /超时/);
});
