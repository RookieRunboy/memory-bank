import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.setDefaultTimeout(240000);
await pg.addInitScript(() => { window.__said = []; window.speechSynthesis && (speechSynthesis.speak = u => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 30); }); });
const U = 'http://localhost:5173/'; const shot = async (n, full = true) => { await pg.waitForTimeout(600); await pg.screenshot({ path: `screenshots/v3/${n}.png`, fullPage: full }); console.log('shot', n); };
const MAX = +(process.env.TURNS || 5);
async function talk(prefix) { for (let i = 0; i < MAX; i++) {
  if (i === 1) await shot(prefix + '-turn2', false);
  await pg.click('#mic'); await pg.waitForTimeout(1500); await pg.click('#demoA'); await pg.click('#mic');
  await pg.waitForFunction(() => !document.querySelector('#mic') || !document.querySelector('#mic.busy'), null, { timeout: 120000 });
  if (!(await pg.$('#mic'))) return; }
  await pg.click('#end'); }
await pg.goto(U); await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); }); await pg.goto(U); await pg.waitForTimeout(2000);
await pg.click('#start'); await pg.click('#demo'); await pg.waitForURL(/stage/); await pg.waitForSelector('.plancard'); await shot('01-plan-auto');
await pg.goto(U + '#/map'); await pg.waitForSelector('.map'); await shot('02-lifemap-empty');
await pg.click('[data-n="youth-meet"]'); await pg.waitForURL(/stage/); await pg.waitForSelector('#clr'); await shot('03-plan-family-pick');
await pg.click('#go'); await pg.waitForSelector('#mic'); await shot('04-interview1-opening', false);
await talk('05-interview1'); await pg.waitForURL(/story/); await shot('06-story1');
await pg.goto(U + '#/archive'); await pg.waitForSelector('.archive'); await pg.waitForFunction(() => !document.querySelector('#archPending'), null, { timeout: 200000 }).catch(() => {}); await shot('07-archive-entities');
await pg.goto(U + '#/map'); await pg.waitForSelector('.map'); await shot('08-lifemap-after1');
await pg.goto(U + '#/stage'); await pg.waitForSelector('.plancard'); await shot('09-plan-session2-follow');
await pg.click('#go'); await pg.waitForSelector('#mic'); await shot('10-interview2-continue-opening', false);
await talk('11-interview2'); await pg.waitForURL(/story/); await shot('12-story2');
await pg.goto(U + '#/archive'); await pg.waitForSelector('.archive'); await pg.waitForFunction(() => !document.querySelector('#archPending'), null, { timeout: 200000 }).catch(() => {}); await shot('13-archive-entities-after2');
await pg.goto(U + '#/map'); await pg.waitForSelector('.map'); await shot('14-lifemap-after2');
const said = await pg.evaluate(() => window.__said); const bad = said.filter(t => /\{[\u4e00-\u9fa5A-Za-z_]{1,12}\}/.test(t));
console.log('spoken', said.length, 'withVars', bad); console.log('errors', errs); await b.close();
