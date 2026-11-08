import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { buildFanchengDemo } from '../server/seed-fancheng.mjs';

const base = process.env.DEMO_URL || 'http://127.0.0.1:8788';
const out = new URL('../screenshots/fancheng-demo/', import.meta.url);
fs.mkdirSync(out, { recursive: true });
const expected = buildFanchengDemo();
const read = async p => { const r = await fetch(base + p); assert.equal(r.status, 200, p); return r.json(); };
const elder = await read('/api/elders/demo-hanchun');
assert.equal(elder.profile.name, '寒春'); assert.equal(elder.profile.demoInterviewer.name, '范成');
assert.equal(elder.interviews.length, 6); assert.equal(elder.stories.length, 6);
for (const story of expected.stories) {
  const actual = await read('/api/stories/' + story.id);
  assert.equal(actual.body, story.data.body); assert.equal(actual.quotes, story.data.quotes);
  assert.deepEqual(actual.paras, story.data.paras);
  assert.equal(actual.fullAudio, null);
  const originals = expected.transcript.filter(t => t.interview_id === story.interview_id);
  assert.equal(actual.transcript.length, originals.length);
  actual.transcript.forEach((t, i) => { assert.equal(t.raw, originals[i].data.raw); assert.equal(t.question, originals[i].data.question); assert.equal(t.interviewer, '范成'); });
}
const response = await fetch(base + '/api/elders/demo-hanchun/export.zip'); assert.equal(response.status, 200);
const zip = await JSZip.loadAsync(await response.arrayBuffer());
assert.ok(zip.file('演示说明.txt')); assert.ok(zip.file('采访者.json'));
const transcriptFiles = Object.keys(zip.files).filter(n => n.startsWith('2-访谈稿/') && n.endsWith('.txt'));
assert.equal(transcriptFiles.length, 6);
for (const file of transcriptFiles) { const txt = await zip.file(file).async('string'); assert.match(txt, /范成：/); assert.match(txt, /寒春（原始对话稿）/); assert.ok(!txt.includes('小忆：')); }

const executablePath = process.env.BROWSER_PATH || process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell';
const browser = await chromium.launch({ executablePath, args: ['--no-proxy-server'] });
const errors = [], screenshots = [];
try {
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, timezoneId: 'Asia/Shanghai' });
    const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
    const tag = viewport.width < 600 ? 'mobile' : 'desktop';
    const shot = async name => { const file = `${tag}-${name}.png`; await page.screenshot({ path: new URL(file, out).pathname, fullPage: false }); screenshots.push(file); };
    await page.goto(base + '/#/account');
    await page.getByRole('button', { name: '范成采访 · 寒春' }).waitFor();
    await shot('account');
    await page.getByRole('button', { name: '范成采访 · 寒春' }).click();
    await page.waitForFunction(() => document.querySelector('.hello')?.textContent.includes('范成'));
    await shot('home');
    assert.match(await page.locator('#demo-notice').innerText(), /范成采访.*寒春讲述/);
    await page.goto(base + '/#/library'); await page.locator('.history .hrow').first().waitFor();
    assert.equal(await page.locator('.history .hrow').count(), 6);
    assert.equal(await page.locator('.history .hrow').filter({ hasText: '段原声' }).count(), 0);
    await shot('history');
    await page.goto(base + '/#/story/s-fancheng-1'); await page.locator('.story .title').waitFor();
    assert.equal(await page.getByRole('button', { name: '听原声', exact: true }).count(), 0);
    await shot('story');
    await page.getByRole('button', { name: '查看出处', exact: true }).first().click();
    await page.waitForFunction(() => document.querySelector('#tx')?.open);
    assert.match(await page.locator('#tx .cq').first().innerText(), /^范成：/);
    assert.match(await page.locator('#tx .ca').first().innerText(), /^寒春：/);
    await page.locator('#tx').scrollIntoViewIfNeeded(); await shot('transcript');
    await page.goto(base + '/#/archive'); await page.locator('.archive').waitFor();
    assert.ok((await page.locator('.archive .ent').count()) >= 30);
    await shot('archive');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), '横向溢出');
    await context.close();
  }
} finally { await browser.close(); }
assert.deepEqual(errors, []);
const result = { checkedAt: new Date().toISOString(), base, interviews: 6, turns: expected.transcript.length, stories: 6, entities: expected.entities.length, checks: ['fresh-browser-selector', 'interviewer-narrator-identity', 'api-vs-source', 'paragraph-provenance', 'no-false-audio-label', 'zip-speaker-labels', 'desktop-mobile-render'], errors, screenshots };
fs.writeFileSync(new URL('verification.json', out), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
