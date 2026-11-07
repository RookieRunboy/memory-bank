// 记忆册视图回归：老人可见页面不出现内部标签、演示入口、选题理由、emoji；只说当前话题
import test from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as V from '../src/views.js';
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;
const BANNED = /第\s*\d+\s*轮|第\d+层|事实|场景|感受层|节点|演示|demo|reason|note|补一补|还有妈妈|AI 在线|离线|nodeId/i;
const visible = h => h.replace(/<[^>]+>/g, ' ');
const cards = [{ text: '聊聊您年轻时第一份工作', nodeId: 'youth-firstjob', kind: 'fresh', reasonText: '还没聊过这边' }, { text: '那时候过年吃什么', nodeId: 'x', kind: 'light' }, { text: '您和老伴怎么认识的', nodeId: 'y', kind: 'follow' }];
const elderPages = {
  home: V.elderHome({ name: '王女士' }),
  choose: V.choosePage({ heading: '今天想聊哪个？', say: '王女士，今天想聊哪个？', cards, after: false }),
  chooseAfter: V.choosePage({ heading: '接下来想聊什么', say: '好。', cards, after: true }),
  talk: V.talkPage({ heading: '今天聊第一份工作', said: '在纺织厂', say: '纺织厂啊，那时候车间里热不热？' }),
  story: V.storyPage({ id: 's1', date: '2026/11/7', teller: '王秀兰', stage: '', title: '第一份工作', paras: [{ text: '我十八岁进了纺织厂。', refs: ['t1'] }], quotes: '', people: '', timePlace: '', fullAudio: '', turns: [{ id: 't1', question: '您第一份工作？', clean: '纺织厂', raw: '纺织厂', audio: '/api/audio/a.webm', nodeId: 'youth-firstjob', depth: 2, emotion: '怀念' }], editable: true, edits: [] }),
};
for (const [k, h] of Object.entries(elderPages)) test(`老人可见「${k}」无内部标签/演示/emoji`, () => {
  const t = visible(h); assert.ok(!EMOJI.test(h), 'emoji'); const m = t.match(BANNED); assert.equal(m, null, m?.[0]); });
test('选题页：恰好三张大卡，换几个/随便聊收进折叠', () => {
  const h = elderPages.choose; assert.equal((h.match(/class="print tcard"/g) || []).length, 3);
  assert.match(h, /<details class="more">[\s\S]*换几个[\s\S]*您想聊什么都行[\s\S]*<\/details>/); assert.match(h, /也可以直接说/); });
test('首页：一个大按钮 + 角落入口', () => { const h = elderPages.home; assert.equal((h.match(/<button/g) || []).length, 1); assert.match(h, /class="corner"/); });
test('故事页：保留原声按钮与逐段音频，访谈稿不露层级/情绪', () => { const h = elderPages.story;
  assert.match(h, /class="play"/); assert.match(h, /<audio controls[^>]*src="\/api\/audio\/a.webm"/); assert.ok(!/怀念|第2层/.test(h)); });
test('家人规划页：只写当前话题，不出现 reason/note 文案', () => {
  const h = V.planPage({ name: '王女士', topic: '第一份工作', first: '第一份工作', ask: '您第一份工作在哪儿？', triggers: [['photo', '老照片']], req: null });
  assert.ok(!/还有|补一补|聊得最少/.test(visible(h))); assert.ok(!EMOJI.test(h)); });
test('前端源码不含 emoji 图标', () => { for (const f of ['main.js', 'views.js', 'audio.js']) assert.ok(!EMOJI.test(fs.readFileSync(new URL('../src/' + f, import.meta.url), 'utf8')), f); });
test('音频逻辑仍在：Kore 流式、ACK、浏览器兜底、MediaRecorder', () => { const a = fs.readFileSync(new URL('../src/audio.js', import.meta.url), 'utf8'), m = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const k of ['/api/tts/stream', 'prefetchAcks', 'speechSynthesis', 'u.rate = 1.0']) assert.ok(a.includes(k), k);
  for (const k of ['new MediaRecorder', '/full', '/choose', 'export.zip'].slice(0, 3)) assert.ok(m.includes(k), k); });
test('回归：停止录音后移除录音态并停止浏览器识别（旧代码被行尾注释吞掉）', () => {
  const m = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const i = m.indexOf("recording = false; busy = true;"); assert.ok(i > 0);
  const lines = m.slice(i).split('\n'); assert.ok(!/\/\/.*classList\.remove\('rec'\)/.test(lines[0]), '不能在注释里');
  assert.match(lines[1], /^\s*mic\.classList\.remove\('rec'\); sr\?\.stop\(\);/); });
