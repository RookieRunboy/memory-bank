import { chromium } from 'playwright';
import { DEMO_ANSWERS } from './src/questions.js';
const b = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['microphone'] });
const pg = await ctx.newPage();
const errs = []; pg.on('pageerror', e => errs.push(e.message));
pg.setDefaultTimeout(180000);
await pg.addInitScript(() => {
  window.speechSynthesis && (speechSynthesis.speak = u => setTimeout(() => u.onend && u.onend(), 40));
  HTMLMediaElement.prototype.play = function () { return Promise.resolve(); };
});
const U = 'http://localhost:5173/';
const DIR = 'screenshots/ui-review';
const shot = async (n) => { await pg.waitForTimeout(700); await pg.screenshot({ path: `${DIR}/${n}.png`, fullPage: false }); console.log('shot', n); };

async function fillAndSend(text) {
  await pg.evaluate(t => { const m = document.getElementById('manual'); m.classList.remove('hidden'); m.value = t; }, text);
  await pg.click('#mic'); await pg.waitForTimeout(900); await pg.click('#mic');
  await pg.waitForFunction(() => {
    const mic = document.querySelector('#mic');
    return mic && !mic.classList.contains('busy') && !mic.classList.contains('hidden');
  }, null, { timeout: 150000 }).catch(() => {});
}

await pg.goto(U);
await pg.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
await pg.goto(U + '#/profile');
await pg.click('#demo');
await pg.waitForURL(/stage/);
await pg.goto(U); // elder home
await pg.waitForSelector('.home.elder #start');
await shot('01-home');

await pg.click('#start');
await pg.waitForSelector('.tcard');
await pg.waitForTimeout(500);
await shot('02-topic');

await pg.click('.tcard');
await pg.waitForSelector('.interview:not(.choose) .mic, .page.interview .mic:not(.small)');
// wait until chat mic (large) is present
await pg.waitForFunction(() => {
  const mic = document.querySelector('#mic');
  return mic && !mic.classList.contains('small') && document.querySelector('.stage');
}, null, { timeout: 60000 });
await pg.waitForTimeout(800);
await shot('03-interview');

// one short answer then end to get a story (or use existing)
await fillAndSend(DEMO_ANSWERS[0] || '妈妈做过绣花，手很巧。');
if (await pg.$('#end')) {
  await pg.click('#end');
} else {
  // maybe already choosing next — end from there
  const endBtn = await pg.$('[data-a="end"]');
  if (endBtn) await endBtn.click();
  else {
    // open details and end, or force finish via hash to library/story
    await pg.evaluate(() => location.hash = '#/library');
  }
}
try {
  await pg.waitForURL(/story/, { timeout: 120000 });
  await pg.waitForSelector('.story .title, .story article', { timeout: 60000 });
  await shot('04-story');
} catch {
  // fallback: open latest story from API via library
  await pg.goto(U + '#/library');
  await pg.waitForSelector('.card, .empty');
  const href = await pg.$eval('a.card', a => a.getAttribute('href')).catch(() => null);
  if (href) { await pg.goto(U + href); await pg.waitForSelector('.story'); await shot('04-story'); }
  else console.log('no story available');
}

console.log('errors', errs);
await b.close();
