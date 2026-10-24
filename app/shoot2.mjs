import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.setDefaultTimeout(240000);
await pg.addInitScript(() => { window.speechSynthesis && (speechSynthesis.speak = u => setTimeout(() => u.onend && u.onend(), 30)); });
const U = 'http://localhost:5173/'; const shot = async (n, full = true) => { await pg.waitForTimeout(600); await pg.screenshot({ path: `screenshots/v2/${n}.png`, fullPage: full }); console.log('shot', n); };
const MAX = +(process.env.TURNS || 5);
async function talk(prefix) { for (let i = 0; i < MAX; i++) {
  if (i === 1) await shot(prefix + '-turn2', false);
  await pg.click('#mic'); await pg.waitForTimeout(1500); await pg.click('#demoA'); await pg.click('#mic');
  if (prefix.startsWith('11') && i === 2) { await pg.waitForTimeout(2800); await shot('15-thinking', false); }
  await pg.waitForFunction(() => !document.querySelector('#mic') || !document.querySelector('#mic.busy'), null, { timeout: 120000 });
  if (!(await pg.$('#mic'))) return; }
  await pg.click('#end'); }
await pg.goto(U); await pg.evaluate(() => localStorage.clear()); await pg.goto(U); await pg.waitForTimeout(3000); await shot('01-home');
await pg.click('#start'); await shot('02-profile');
await pg.click('#demo'); await pg.waitForURL(/stage/); await shot('03-stage');
await pg.click('[data-s="婚恋"]'); await pg.waitForSelector('#mic'); await shot('04-interview1-opening', false);
await talk('05-interview1'); await pg.waitForSelector('#storyThinking', { timeout: 5000 }).then(() => shot('16-story-thinking', false)).catch(() => console.log('missed story thinking')); await pg.waitForURL(/story/); await shot('06-story1');
await pg.goto(U + '#/archive'); await pg.waitForSelector('.archive'); await shot('07-archive');
await pg.goto(U); await shot('08-home-returning');
await pg.click('#start'); await pg.waitForURL(/stage/); await shot('09-stage-lasttopic');
await pg.click('[data-s="婚恋"]'); await pg.waitForSelector('#mic'); await shot('10-interview2-continue-opening', false);
await talk('11-interview2'); await pg.waitForURL(/story/); await shot('12-story2');
await pg.goto(U + '#/library'); await shot('13-library');
await pg.goto(U + '#/archive'); await pg.waitForSelector('.archive'); await pg.waitForFunction(() => !document.querySelector('#archPending'), null, { timeout: 200000 }); await pg.$$eval('details', d => d.forEach(x => x.open = true)); await shot('14-archive-after2');
console.log('errors', errs); await b.close();
