// 运行：node --test test/
import test from 'node:test'; import assert from 'node:assert/strict';
import { parseStory } from '../src/parseStory.js';
test('空字段不吞下一行', () => {
  const r = parseStory('标题：他说我跟桂花糕一样甜\n正文：我是在纺织厂认识老李的。\n\n他骑车带我。\n关键人物：\n时间地点：江苏扬州，瘦西湖\n原话摘录：“跟我一样甜。”');
  assert.equal(r.people, ''); assert.equal(r.timePlace, '江苏扬州，瘦西湖'); assert.equal(r.body, '我是在纺织厂认识老李的。\n\n他骑车带我。'); assert.equal(r.quotes, '“跟我一样甜。”');
});
test('连续多个空字段 + 字段值另起一行', () => {
  const r = parseStory('标题：\n小院\n正文：\n我小时候\n关键人物：\n时间地点：\n原话摘录：');
  assert.equal(r.title, '小院'); assert.equal(r.body, '我小时候'); assert.equal(r.people, ''); assert.equal(r.timePlace, ''); assert.equal(r.quotes, '');
});
test('“无”视为空、正文里出现字段名不误切、markdown 加粗', () => {
  const r = parseStory('**标题**：桂花糕\n正文：我说的关键人物：就是他。\n关键人物：无\n时间地点：无');
  assert.equal(r.title, '桂花糕'); assert.equal(r.body, '我说的关键人物：就是他。'); assert.equal(r.people, ''); assert.equal(r.timePlace, '');
});
test('无格式时整段作正文', () => { assert.equal(parseStory('就是一段话').body, '就是一段话'); });
