import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: process.env.HOME + '/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell', args: ['--no-proxy-server'] });
const U = 'http://localhost:5173/', DIR = 'screenshots/v6', errs = [];
async function run(ui, vp, tag) {
  const ctx = await b.newContext({ viewport: vp, deviceScaleFactor: 2, isMobile: vp.width < 600, hasTouch: vp.width < 600 });
  const pg = await ctx.newPage(); pg.on('pageerror', e => errs.push(tag + ' ' + e.message));
  const shot = async n => { await pg.waitForTimeout(500); await pg.screenshot({ path: `${DIR}/${ui}-${tag}-${n}.png` }); };
  await pg.goto(U); await pg.evaluate(ui => { localStorage.clear(); localStorage.setItem('mb_ui', JSON.stringify(ui)); localStorage.setItem('mb_elder', 'demo-wang'); localStorage.setItem('mb_profile', JSON.stringify({ name: '王秀兰', gender: '女', callName: '王女士', birthYear: '1948', hometown: '江苏扬州', people: '老伴李建国、女儿小梅' })); }, ui);
  await pg.goto(U + '#/family'); await pg.reload(); await pg.waitForTimeout(600); await shot('0-login');
  await pg.click('#demo'); await pg.waitForTimeout(900); await shot('1-home');
  if (vp.width < 600) { await pg.click('#menu'); await pg.waitForTimeout(400); await shot('2-drawer'); await pg.click('#scrim', { position: { x: 380, y: 400 } }); }
  await pg.goto(U + '#/history'); await shot('3-history');
  await pg.goto(U + '#/settings'); await shot('4-settings');
  await pg.goto(U + '#/account'); await shot('5-account');
  await ctx.close();
}
for (const ui of ['a']) { await run(ui, { width: 390, height: 844 }, 'm'); await run(ui, { width: 1200, height: 800 }, 'd'); }
// 老人端不应出现框架
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const pg = await ctx.newPage();
await pg.goto(U); await pg.evaluate(() => { localStorage.clear(); localStorage.setItem('mb_elder', 'demo-wang'); localStorage.setItem('mb_profile', JSON.stringify({ name: '王秀兰', gender: '女', callName: '王女士' })); });
await pg.goto(U + '#/'); await pg.waitForTimeout(600);
console.log('elder home has-shell:', await pg.evaluate(() => document.body.classList.contains('has-shell')), 'topbar visible:', await pg.evaluate(() => getComputedStyle(document.querySelector('.topbar')).display));
await pg.screenshot({ path: `${DIR}/elder-home.png` });
await pg.click('#more'); await pg.waitForTimeout(800);
console.log('after corner entry hash:', await pg.evaluate(() => location.hash), 'has-shell:', await pg.evaluate(() => document.body.classList.contains('has-shell')));
await pg.goto(U + '#/library'); await pg.waitForTimeout(500);
console.log('direct visit w/o login -> ', await pg.evaluate(() => location.hash));
await b.close(); console.log('errors:', errs.length ? errs : 'none');
