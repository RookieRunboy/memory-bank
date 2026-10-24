import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
const pg = await ctx.newPage(); const errs = []; pg.on('pageerror', e => errs.push(e.message));
await pg.addInitScript(() => { window.speechSynthesis && (speechSynthesis.speak = u => setTimeout(() => u.onend && u.onend(), 50)); });
const U = 'http://localhost:5173/'; const shot = async n => { await pg.waitForTimeout(500); await pg.screenshot({ path: `screenshots/${n}.png`, fullPage: true }); };
await pg.goto(U); await shot('01-home');
await pg.click('#start'); await shot('02-profile');
await pg.click('#demo'); await shot('03-stage');
await pg.click('[data-s="婚恋"]'); await shot('04-interview');
for (let i = 0; i < 5; i++) { await pg.click('#mic'); await pg.waitForTimeout(800); if (i == 0) await shot('05-recording');
  await pg.click('#demoA'); await pg.click('#mic'); await pg.waitForTimeout(900); }
await pg.waitForURL(/story/); await shot('06-story');
await pg.goto(U + '#/library'); await shot('07-library');
await pg.goto(U); await shot('08-home-returning');
console.log('errors', errs, 'audios', 0); await b.close();
