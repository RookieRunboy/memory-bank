import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import initSqlJs from 'sql.js';
import * as ai from '../server/ai.mjs';
import * as P from '../src/planner.js';
import { DEMO_ANSWERS } from '../src/questions.js';
import { seedFugui, SEED_VERSION } from '../server/seed-fugui.mjs';

test('archive updates retain server-owned seed version in both offline paths', async () => {
  for (const clean of ['这是我今天补充的新故事。', DEMO_ANSWERS[0]]) {
    const archive = await ai.updateArchive({ name: '徐先生' }, { seedVersion: SEED_VERSION }, [{ clean }], '自由聊聊', { offline: true });
    assert.equal(archive.seedVersion, SEED_VERSION);
  }
});

test('model archive updates cannot erase or replace the stored seed version', async t => {
  const before = { OPENAI_API_KEY: process.env.OPENAI_API_KEY, LLM_PROVIDER: process.env.LLM_PROVIDER };
  process.env.OPENAI_API_KEY = 'seed-persistence-fixture'; process.env.LLM_PROVIDER = 'openai';
  t.after(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ people: [], seedVersion: 999 }) } }] })));
  const archive = await ai.updateArchive({ name: '徐先生' }, { seedVersion: SEED_VERSION }, [{ clean: '今天补充的故事。' }], '自由聊聊');
  assert.equal(archive.source, 'gemini');
  assert.equal(archive.seedVersion, SEED_VERSION);
});

test('startup preserves existing demo interviews and edits with old or missing seed metadata', { timeout: 15000 }, async t => {
  const SQL = await initSqlJs();
  for (const version of [1, undefined]) await t.test(version === undefined ? 'missing version' : 'old version', async t => {
    const data = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-seed-persistence-'));
    const file = path.join(data, 'mb.sqlite'), db = new SQL.Database();
    const tables = ['elders', 'interviews', 'stories', 'transcript_turns', 'edits', 'elder_state'];
    db.run(`create table elders(id text primary key,profile text,archive text,created int);
      create table interviews(id text primary key,elder_id text,stage text,created int,turns text,opening text,finished int);
      create table stories(id text primary key,elder_id text,interview_id text,created int,data text);
      create table transcript_turns(id text primary key,interview_id text,elder_id text,idx int,data text);
      create table edits(id text primary key,elder_id text,target text,target_id text,field text,before text,after text,by text,at int);
      create table elder_state(elder_id text primary key,nodes text,entities text);`);
    await seedFugui({ db, ai, P });
    const archive = JSON.parse(db.exec("select archive from elders where id='demo-fugui'")[0].values[0][0]);
    if (version === undefined) delete archive.seedVersion; else archive.seedVersion = version;
    archive.events.push({ title: '用户新增的记忆', detail: '必须保留' });
    db.run('update elders set archive=? where id=?', [JSON.stringify(archive), 'demo-fugui']);
    db.run('insert into interviews values(?,?,?,?,?,?,?)', ['user-interview', 'demo-fugui', '新故事', 1, '[]', '{}', 1]);
    db.run('insert into stories values(?,?,?,?,?)', ['user-story', 'demo-fugui', 'user-interview', 1, '{"title":"家人改过的标题"}']);
    db.run('insert into transcript_turns values(?,?,?,?,?)', ['user-turn', 'user-interview', 'demo-fugui', 1, '{"raw":"用户原话"}']);
    db.run('insert into edits values(?,?,?,?,?,?,?,?,?)', ['user-edit', 'demo-fugui', 'story', 'user-story', 'title', '旧标题', '家人改过的标题', '家人', 1]);
    const snapshot = database => tables.map(table => database.exec(`select * from ${table} where ${table === 'elders' ? 'id' : 'elder_id'}='demo-fugui' order by rowid`));
    const before = snapshot(db);
    fs.writeFileSync(file, Buffer.from(db.export())); db.close();
    const preload = path.join(data, 'offline.mjs');
    fs.writeFileSync(preload, 'globalThis.fetch = async () => { throw Error("offline seed fixture"); };');
    const child = spawn(process.execPath, ['--import', preload, 'server/index.mjs'], { cwd: new URL('..', import.meta.url), env: { ...process.env, DATA_DIR: data, PORT: '0', HOST: '127.0.0.1', GEMINI_TTS_WARM: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = ''; child.stdout.on('data', b => output += b); child.stderr.on('data', () => {});
    t.after(async () => { if (child.exitCode == null && child.signalCode == null) { child.kill(); await once(child, 'exit'); } fs.rmSync(data, { recursive: true, force: true }); });
    for (let i = 0; i < 200 && !/memory-bank on 127\.0\.0\.1:\d+/.test(output); i++) {
      if (child.exitCode != null) throw Error('server exited before startup');
      await delay(20);
    }
    assert.match(output, /memory-bank on 127\.0\.0\.1:\d+/, 'server starts successfully');
    child.kill(); await once(child, 'exit');
    const saved = new SQL.Database(fs.readFileSync(file));
    try { const after = snapshot(saved); tables.forEach((table, i) => assert.ok(isDeepStrictEqual(after[i], before[i]), `startup must preserve existing demo-fugui rows in ${table}`)); }
    finally { saved.close(); }
  });
});
