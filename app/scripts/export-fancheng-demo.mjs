// 从同一份原始脚本生成可读访谈、加工成果、实际表结构快照和便携压缩包。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildFanchengDemo } from '../server/seed-fancheng.mjs';

const root = fileURLToPath(new URL('../../demo-data/fancheng-hanchun/', import.meta.url));
const data = buildFanchengDemo();
const write = (name, content) => { const target = path.join(root, name); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, content); };
const json = (name, value) => write(name, JSON.stringify(value, null, 2) + '\n');
const stamp = ms => { const s = Math.round(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

for (const [index, session] of data.sessions.entries()) {
  const interview = data.interviews[index], story = data.stories[index];
  const name = `${String(index + 1).padStart(2, '0')}-${session.slug}`;
  const header = `${session.title}\n${session.fictionNotice}\n采访者：范成｜受访者：寒春\n模拟排期：${session.recordedAt}（非真实采访日期）\n讲述年代：${session.historicalPeriod}\n时间码为台词排练估算，尚无音频。\n`;
  write(`raw/${name}.txt`, header + '\n' + interview.turns.map((t, i) => `[${stamp(t.at - interview.created)}] 第 ${i + 1} 轮 · ${t.id}\n范成：${t.q}\n寒春：${t.raw}`).join('\n\n') + `\n\n范成：${session.closing}\n`);
  json(`raw/${name}.json`, { interviewId: interview.id, interviewer: session.interviewer, narrator: session.narrator, fictional: true, disclosure: session.fictionNotice, audio: null, timingSource: 'estimated-script-timing', turns: data.transcript.filter(t => t.interview_id === interview.id).map(t => t.data) });
  write(`processed/transcripts/${name}.txt`, header + '\n' + interview.turns.map(t => `${t.id}\n范成：${t.q}\n寒春：${t.clean}`).join('\n\n') + `\n\n范成：${session.closing}\n`);
  write(`processed/stories/${name}.txt`, `${session.fictionNotice}\n加工方式：预写并审核的 mock 故事，未调用运行时模型生成。\n\n标题：${story.data.title}\n正文：${story.data.body}\n关键人物：${story.data.people}\n时间地点：${story.data.timePlace}\n原话摘录：${story.data.quotes}\n\n段落出处：\n${story.data.paras.map((p, i) => `第${i + 1}段 → ${p.refs.join('、')}`).join('\n')}\n`);
  json(`processed/stories/${name}.json`, story);
}
json('processed/interview-history.json', data.history);
json('processed/archive.json', data.elder.archive);
json('processed/entities.json', data.entities);
json('processed/topic-state.json', data.states);
json('processed/app-snapshot.json', { schemaVersion: data.schemaVersion, user: data.user, elders: [data.elder], interviews: data.interviews, transcript_turns: data.transcript, stories: data.stories, elder_state: [{ elder_id: data.elder.id, nodes: data.states, entities: data.entities }], source: data.source, disclosure: data.disclosure });
const stats = { interviews: data.interviews.length, turns: data.transcript.length, stories: data.stories.length, entities: data.entities.length, rawCharacters: data.transcript.reduce((n, t) => n + t.data.raw.length, 0), storyCharacters: data.stories.reduce((n, s) => n + s.data.body.length, 0) };
json('manifest.json', { name: '范成采访寒春 · 记忆银行演示数据', version: 1, createdFor: '2026-11-08', fictional: true, historicalPersonLifespan: '1921—2010', interviewerId: data.user.id, narratorId: data.elder.id, stats,
  processing: data.processing, audioIncluded: false, timestampMeaning: '2026 年日期为演示排期，轮次时间是根据台词长度估算，非历史采访时间', sourceDirectory: 'sessions/', regenerate: 'cd app && node scripts/export-fancheng-demo.mjs', appSeed: 'server/seed-fancheng.mjs', disclosure: data.disclosure });

const zip = new JSZip();
const addDir = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) addDir(full); else if (!entry.name.endsWith('.zip') && entry.name !== '.DS_Store') zip.file(path.relative(root, full).split(path.sep).join('/'), fs.readFileSync(full), { date: new Date('2026-11-08T00:00:00+08:00') }); } };
addDir(root);
write('fancheng-hanchun-demo.zip', await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
console.log(JSON.stringify({ ...stats, output: root, zip: path.join(root, 'fancheng-hanchun-demo.zip') }, null, 2));
