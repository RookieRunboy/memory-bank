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
  assert.equal(soothe('没关系，慢慢想。屋里冷吗？', '忘了'), '没关系，慢慢想。屋里冷吗？'); assert.equal(soothe('好的。', '挺好的'), '好的。'); });
test('换话题：只留接住部分，模型自己列的候选和提问去掉', () => {
  assert.equal(keepAck('李先生还总给您拎水，真暖和。接下来咱们聊聊哪个？第一个，手艺；第二个，房子。'), '李先生还总给您拎水，真暖和。');
  assert.equal(keepAck('这段我都记下了。您还想说点什么吗？'), '这段我都记下了。'); });
test('第一句短：典型回复首句 ≤10 字可先合成', () => { assert.ok(splitSentences('原来是筒子楼啊。那冬天屋里冷不冷呀？')[0].length <= 10); });
import { plausible } from '../server/ai.mjs';
test('合并转写可信度：1.5 秒录音出来几十个字就不信', () => { assert.ok(plausible('嗯，挺好的。', 1500)); assert.ok(!plausible('嗯，挺好吧。那时候虽然穷，但是真的挺热闹的，挺开心的。想让孩子们知道那时候家里的感觉。', 1500)); assert.ok(plausible('随便多长', 0)); });
