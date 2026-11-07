import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as P from '../src/planner.js';

const framework = JSON.parse(fs.readFileSync(new URL('../src/framework.json', import.meta.url)));
const guide = fs.readFileSync(new URL('../../docs/interview-framework.md', import.meta.url), 'utf8');
const legacyIds = `child-home child-mother child-father-bike child-siblings child-play child-newyear child-food child-river teen-school teen-teacher teen-chores teen-friend teen-song teen-times teen-dream youth-firstjob youth-master youth-meet youth-date youth-wedding youth-newhome youth-firstchild youth-coworkers youth-pride youth-times midlife-kids midlife-naughty midlife-work midlife-craft midlife-siblings midlife-move midlife-hard midlife-travel midlife-parents-old elder-grandkids elder-hometown-food elder-festivals elder-songs elder-friends elder-hobby elder-oldthing elder-wishes`.split(' ');

test('研究版问题库保留全部历史话题 ID，并可解析旧档案', () => {
  assert.ok(framework.nodes.length > legacyIds.length);
  assert.equal(new Set(framework.nodes.map(n => n.id)).size, framework.nodes.length);
  for (const id of legacyIds) {
    assert.ok(P.nodeById(framework, id), id);
    assert.ok(P.st({ [id]: { depth: 4, status: 'done', notes: [] } }, id).enough);
  }
});

test('每个题组有可追溯来源、适用前提和低负担问法', () => {
  assert.ok(framework.sources?.length >= 5);
  const sources = new Set(framework.sources.map(s => s.id));
  for (const source of framework.sources) {
    assert.ok(source.title && source.supports && source.accessed);
    assert.equal(new URL(source.url).protocol, 'https:');
    assert.ok(guide.includes(source.url), source.id);
  }
  for (const node of framework.nodes) {
    assert.ok(node.entry_condition && node.gentle_question, node.id);
    assert.ok(node.source_refs?.length, node.id);
    assert.ok(node.source_refs.every(id => sources.has(id)), node.id);
    assert.deepEqual(node.layers.map(l => l.depth), [1, 2, 3, 4], node.id);
    for (const question of [...node.layers.map(l => l.question), node.gentle_question, ...Object.values(node.trigger_openers)]) {
      assert.equal((question.match(/[？?]/g) || []).length, 1, `${node.id} ${question}`);
      assert.ok(guide.includes(question), `${node.id} 文档未同步 ${question}`);
      assert.ok(!/心里(怎么样|什么滋味)|被他夸|穿上新衣服|您真了不起/.test(question), question);
    }
  }
});

test('模型题组使用实际问题库，替换变量，并兼容缺少新增字段的旧题组', () => {
  assert.equal(typeof P.questionGuide, 'function');
  for (const profile of [{}, { name: '王秀兰', callName: '王女士', people: '老伴李建国（已故）' }]) {
    for (const node of framework.nodes) {
      const result = P.questionGuide(framework, node.id, profile);
      assert.deepEqual(P.leftoverVars(JSON.stringify(result)), [], node.id);
      assert.equal(result.questions[0], P.questionFor(framework, node.id, 1, profile));
      assert.equal(result.gentleQuestion, P.fillAll(node.gentle_question, profile));
      assert.equal(result.entryCondition, node.entry_condition);
    }
  }
  const old = { ...framework.nodes[0] };
  delete old.gentle_question;
  delete old.entry_condition;
  assert.doesNotThrow(() => P.questionGuide({ nodes: [old] }, old.id, {}));
  assert.equal(P.questionGuide(framework, 'missing-node', {}), null);
});
