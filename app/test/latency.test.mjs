import test from 'node:test'; import assert from 'node:assert/strict';
import { ACKS, pickAck, splitSentences } from '../src/split.js';
import { oneQuestion, soothe, keepAck } from '../server/ai.mjs';
test('短回应：6–8 句、轮换不连续重复、都能单句合成', () => { assert.ok(ACKS.length >= 6 && ACKS.length <= 8);
  let prev = null; for (let i = 0; i < 200; i++) { const a = pickAck(prev); assert.ok(ACKS.includes(a)); assert.notEqual(a, prev); prev = a; }
  for (const a of ACKS) assert.equal(splitSentences(a).length, 1); });
test('一次只问一个问题：第二个问号之后截掉', () => {
  assert.equal(oneQuestion('原来是筒子楼啊。冬天冷不冷？那时候您踏实吗？'), '原来是筒子楼啊。冬天冷不冷？'); assert.equal(oneQuestion('真好。'), '真好。'); });
test('记不清：补固定安抚话术，已安抚就不重复', () => {
  assert.equal(soothe('那屋里冬天冷不冷呀？', '记不太清了。'), '没关系，想不起来就不想了。那屋里冬天冷不冷呀？');
  assert.equal(soothe('想不起来没关系。那时候您觉得日子过得怎么样？', '记不太清了。', '屋里最显眼的是什么家具呀？'), '想不起来没关系。屋里最显眼的是什么家具呀？');
  assert.match(soothe('没关系。', '忘了'), /[？?]$/);
  assert.equal(soothe('没关系，慢慢想。屋里冷吗？', '忘了'), '没关系，慢慢想。屋里冷吗？'); assert.equal(soothe('好的。', '挺好的'), '好的。'); });
test('换话题：只留接住部分，模型自己列的候选和提问去掉', () => {
  assert.equal(keepAck('李先生还总给您拎水，真暖和。接下来咱们聊聊哪个？第一个，手艺；第二个，房子。'), '李先生还总给您拎水，真暖和。');
  assert.equal(keepAck('这段我都记下了。您还想说点什么吗？'), '这段我都记下了。'); });
test('第一句短：典型回复首句 ≤10 字可先合成', () => { assert.ok(splitSentences('原来是筒子楼啊。那冬天屋里冷不冷呀？')[0].length <= 10); });
import { plausible } from '../server/ai.mjs';
test('合并转写可信度：1.5 秒录音出来几十个字就不信', () => { assert.ok(plausible('嗯，挺好的。', 1500)); assert.ok(!plausible('嗯，挺好吧。那时候虽然穷，但是真的挺热闹的，挺开心的。想让孩子们知道那时候家里的感觉。', 1500)); assert.ok(plausible('随便多长', 0)); });
import { sim, echoes, VAGUE_RE, concreteQ, swapQuestion, CONCRETE } from '../server/ai.mjs';
import { is429, retry429, makeTTS, TTS } from '../server/tts.mjs';
import fs from 'fs'; import os from 'os'; import path from 'path';
test('复述检测：和计划问题高度相同算复述，换说法不算', () => {
  const plan = '您想让孩子们知道，那时候的家是什么样吗？';
  assert.ok(echoes('王女士记得真清楚。您想让孩子们知道，那时候的家是什么样吗？', [plan]));
  assert.ok(!echoes('真热闹。那时候家里做饭用的是煤炉还是灶台？', [plan])); assert.ok(sim('abc', 'abc') === 1); });
test('泛问检测与具体小问题兜底', () => { assert.ok(VAGUE_RE.test('您觉得日子过得怎么样？')); assert.ok(VAGUE_RE.test('那时候日子过得怎么样？')); assert.ok(!VAGUE_RE.test('那时候家里用的是煤炉还是灶台？'));
  for (let i = 0; i < 10; i++) { const q = concreteQ(i); assert.ok(CONCRETE.includes(q) && !VAGUE_RE.test(q)); }
  assert.equal(swapQuestion('真好。日子过得怎么样？', '屋里有什么家具？'), '真好。屋里有什么家具？'); });
test('429 退避重试：重试到成功；非 429 直接抛', async () => { let n = 0;
  assert.equal(await retry429(async () => { if (n++ < 2) throw new Error('HTTP 429 RESOURCE_EXHAUSTED'); return 'ok'; }, [1, 1, 1]), 'ok'); assert.equal(n, 3);
  await assert.rejects(retry429(async () => { throw new Error('HTTP 500'); }, [1])); assert.ok(is429(new Error('HTTP 429'))); });
test('预热串行且有实时请求时暂停', async () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-')); let cur = 0, max = 0, order = [];
  const call = async (m, t) => { cur++; max = Math.max(max, cur); order.push(t); await new Promise(r => setTimeout(r, 15)); cur--; return { pcm: Buffer.alloc(4), mime: '' }; };
  const tts = makeTTS(dir, { ...TTS, fallback: '' }, call);
  await tts.get('实时一句'); assert.ok(tts.busy()); // 实时请求刚结束 3 秒内视为忙
  const t0 = Date.now(); await tts.warm(['甲句。', '乙句。']); assert.ok(Date.now() - t0 >= 2500, '等实时请求空闲后才预热'); assert.equal(max, 1); });
test('流式：缓存命中直接给 PCM，未命中边下边写缓存', async () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  async function* st() { yield Buffer.alloc(4, 1); yield Buffer.alloc(6, 2); }
  const tts = makeTTS(dir, TTS, null, st); const got = []; for await (const c of tts.streamPCM('一句')) got.push(c);
  assert.equal(Buffer.concat(got).length, 10); assert.ok(tts.has('一句')); const again = []; for await (const c of tts.streamPCM('一句')) again.push(c); assert.equal(again.length, 1); assert.equal(again[0].length, 10); });
