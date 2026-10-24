import { chromium } from 'playwright'; import fs from 'node:fs'; import JSZip from 'jszip';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'], acceptDownloads: true });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.setDefaultTimeout(240000);
await pg.addInitScript(() => { window.speechSynthesis && (speechSynthesis.speak = u => setTimeout(() => u.onend && u.onend(), 30)); HTMLMediaElement.prototype.play = function () { return Promise.resolve(); }; });
const U = 'http://localhost:5173/'; const shot = async (n, full = true) => { await pg.waitForTimeout(600); await pg.screenshot({ path: `screenshots/v4/${n}.png`, fullPage: full }); console.log('shot', n); };
const MAX = +(process.env.TURNS || 4);
await pg.goto(U); await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await pg.goto(U + '#/profile'); await pg.click('#demo'); await pg.waitForURL(/stage/);
await pg.goto(U); await pg.waitForSelector('.home.elder'); await shot('01-elder-home', false);
await pg.click('#start'); await pg.waitForSelector('#mic'); await shot('02-interview-opening', false);
for (let i = 0; i < MAX; i++) { await pg.click('#mic'); await pg.waitForTimeout(1500); await pg.click('#demoA'); await pg.click('#mic');
  await pg.waitForFunction(() => !document.querySelector('#mic') || !document.querySelector('#mic.busy'), null, { timeout: 120000 }); if (!(await pg.$('#mic'))) break; }
if (await pg.$('#end')) await pg.click('#end');
await pg.waitForURL(/story/); await pg.waitForSelector('.para'); await shot('03-story-paras-play');
const btn = await pg.$('.play'); if (btn) { await btn.click(); await pg.waitForTimeout(400); }
await shot('04-story-transcript-expanded');
await pg.click('#edit'); await pg.fill('[name=title]', (await pg.inputValue('[name=title]')) + '（小梅改）'); await pg.click('#ef button'); await pg.waitForSelector('.edits');
await pg.$$eval('details.edits', d => d.forEach(x => x.open = true)); await shot('05-story-edited-trace');
await pg.goto(U); await pg.waitForSelector('#more'); await pg.click('#more'); await pg.waitForSelector('#zip'); await shot('06-family-home-from-corner');
const [dl] = await Promise.all([pg.waitForEvent('download'), pg.click('#zip')]); const fp = '/tmp/mb-export.zip'; await dl.saveAs(fp);
const z = await JSZip.loadAsync(fs.readFileSync(fp)); console.log('zip', dl.suggestedFilename(), Object.keys(z.files).join(' | '));
await pg.goto(U + '#/archive'); await pg.waitForSelector('.archive'); await pg.waitForFunction(() => !document.querySelector('#archPending'), null, { timeout: 200000 }).catch(() => {}); await shot('07-archive-entities-sources');
console.log('errors', errs); await b.close();
