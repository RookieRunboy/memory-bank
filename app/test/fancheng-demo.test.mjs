import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import initSqlJs from 'sql.js';

test('范成采访寒春：完整数据、逐段出处、身份分离和不覆盖已有档案', async () => {
  const moduleUrl = new URL('../server/seed-fancheng.mjs', import.meta.url);
  assert.ok(fs.existsSync(moduleUrl), '需要访谈数据装配模块');
  const { buildFanchengDemo, seedFancheng } = await import(moduleUrl.href);
  const data = buildFanchengDemo();
  assert.equal(data.user.name, '范成');
  assert.equal(data.elder.profile.name, '寒春');
  assert.notEqual(data.user.id, data.elder.id);
  assert.equal(data.interviews.length, 6);
  assert.equal(data.stories.length, 6);
  const turnIds = new Set(data.transcript.map(t => t.id));
  assert.equal(turnIds.size, data.transcript.length);
  for (const i of data.interviews) {
    assert.equal(i.opening.interviewer.name, '范成');
    assert.equal(i.finished, 1);
    assert.ok(i.turns.length >= 12);
    for (const t of i.turns) {
      assert.ok(turnIds.has(t.id));
      assert.equal(t.audio, null);
      assert.equal(t.interviewer, '范成');
      assert.equal(t.speaker, '寒春');
    }
  }
  for (const story of data.stories) {
    const turns = data.transcript.filter(t => t.interview_id === story.interview_id);
    assert.ok(story.data.body.length >= 300 && story.data.body.length <= 650);
    assert.equal(story.data.body, story.data.paras.map(p => p.text).join('\n\n'));
    for (const p of story.data.paras) {
      assert.ok(p.refs.length);
      for (const ref of p.refs) assert.ok(turns.some(t => t.id === ref), `段落出处 ${ref}`);
    }
    for (const [, quote] of story.data.quotes.matchAll(/“([^”]+)”/g))
      assert.ok(turns.some(t => t.data.raw.includes(quote)), `原话必须逐字匹配：${quote}`);
  }
  for (const entity of data.entities) {
    assert.ok(entity.sourceTurns.length);
    for (const ref of entity.sourceTurns) assert.ok(turnIds.has(ref));
  }
  for (const key of ['people', 'places', 'events', 'timeline']) {
    for (const item of data.elder.archive[key]) {
      assert.ok(item.sourceTurns.length);
      for (const ref of item.sourceTurns) assert.ok(turnIds.has(ref));
    }
  }
  const SQL = await initSqlJs(), db = new SQL.Database();
  db.run(`create table elders(id text primary key,profile text,archive text,created int);
    create table interviews(id text primary key,elder_id text,stage text,created int,turns text,opening text,finished int);
    create table stories(id text primary key,elder_id text,interview_id text,created int,data text);
    create table transcript_turns(id text primary key,interview_id text,elder_id text,idx int,data text);
    create table elder_state(elder_id text primary key,nodes text,entities text);`);
  db.run('insert into elders values(?,?,?,?)', ['unrelated', '{"name":"保留"}', '{}', 1]);
  assert.equal(seedFancheng({ db }), true);
  const before = db.exec('select * from transcript_turns order by id');
  db.run('update elders set profile=? where id=?', ['{"name":"用户修改"}', data.elder.id]);
  assert.equal(seedFancheng({ db }), false);
  assert.deepEqual(db.exec('select * from transcript_turns order by id'), before);
  assert.equal(db.exec('select profile from elders where id="unrelated"')[0].values[0][0], '{"name":"保留"}');
  assert.equal(db.exec(`select profile from elders where id='${data.elder.id}'`)[0].values[0][0], '{"name":"用户修改"}');
  db.close();
});
