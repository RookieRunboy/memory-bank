// Targeted browser-module regression for switching from interrupted speech to
// typed input. No microphone, provider, API server, or personal data is used.
// Run: node test/voice-ui-state-browser.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({ root, configFile: false, server: { host: '127.0.0.1', port: 0, hmr: false }, logLevel: 'error', plugins: [{
  name: 'voice-state-probe',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url !== '/__voice_state_probe') return next();
      res.setHeader('content-type', 'text/html');
      res.end('<!doctype html><html><title>Voice state regression</title><body>Local browser module test</body></html>');
    });
  },
}] });
await vite.listen();
const base = `http://127.0.0.1:${vite.httpServer.address().port}`;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || path.join(os.homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell');
let browser;
try {
  browser = await chromium.launch({ ...(fs.existsSync(executablePath) ? { executablePath } : {}), args: ['--no-proxy-server'] });
  const context = await browser.newContext();
  const unexpectedNetwork = [], pageErrors = [];
  await context.route('**/*', route => {
    const url = route.request().url();
    if (url.startsWith(base + '/') && !url.startsWith(base + '/api/')) return route.continue();
    unexpectedNetwork.push(url); return route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base + '/__voice_state_probe', { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const { VoiceInterview } = await import('/src/voice-interview.js');
    const old = { say: '旧问题：您的家在哪里？', responseId: 'old-response', ask: { nodeId: 'old-home', depth: 1 }, phase: 'chat' };
    const heard = { question: '新问题已经听到的部分。', questionId: 'new-response', ask: { nodeId: 'heard-topic', depth: 3 }, phase: 'choose', interrupted: true };
    const visible = { id: 'assistant:new-response', role: 'assistant', text: '新问题屏幕实际显示的前半句。', status: 'interrupted', ask: { nodeId: 'visible-topic', depth: 4 }, phase: 'choose' };
    function submit(message, heardState = heard, snapshotState = old) {
      let queued, pending, stopReason, paints = 0;
      const target = {
        ending: false, disposed: false, outputEpoch: 7,
        s: snapshotState, heard: heardState, capture: { speaking: false },
        messages: { items: [{ id: 'assistant:old-response', role: 'assistant', text: old.say }, message, { role: 'user', text: '语音插话' }] },
        turns: { accepting: true, pending: 0, enqueue(turn) { queued = turn; return true; } },
        playback: { stop(reason) { stopReason = reason; } },
        snapshot() { return { ...heardState, outputEpoch: 6 }; },
        record(kind, turn) { return { ...turn, kind, clientTurnId: 'manual-regression' }; },
        pendingMessage(turn) { pending = turn; }, paint() { paints++; },
      };
      const accepted = VoiceInterview.prototype.manual.call(target, { manual: '我改用打字补充。' });
      return { accepted, queued, pendingMatches: pending === queued, stopReason, paints };
    }
    const withoutMetadata = { ...visible }; delete withoutMetadata.ask; delete withoutMetadata.phase;
    return {
      visible, heard, old,
      explicit: submit(visible),
      heardFallback: submit(withoutMetadata),
      snapshotFallback: submit({ ...withoutMetadata, id: 'assistant:old-response', text: old.say }, heard),
    };
  });
  for (const [name, expected] of [
    ['explicit', { question: result.visible.text, questionId: 'new-response', ask: result.visible.ask, phase: result.visible.phase }],
    ['heardFallback', { question: result.visible.text, questionId: 'new-response', ask: result.heard.ask, phase: result.heard.phase }],
    ['snapshotFallback', { question: result.old.say, questionId: result.old.responseId, ask: result.old.ask, phase: result.old.phase }],
  ]) {
    const entry = result[name];
    assert.equal(entry.accepted, true, name);
    assert.equal(entry.pendingMatches, true, name);
    assert.equal(entry.stopReason, 'manual', name);
    for (const key of ['question', 'questionId', 'ask', 'phase']) assert.deepEqual(entry.queued[key], expected[key], `${name}: ${key} must belong to the visible response`);
    assert.equal(entry.queued.interrupted, true, name);
    assert.equal(entry.queued.manual, '我改用打字补充。', name);
    assert.equal(entry.queued.outputEpoch, 7, name);
  }
  assert.deepEqual(pageErrors, []);
  assert.deepEqual(unexpectedNetwork, []);
  const report = { pass: true, testedAt: new Date().toISOString(), checks: { visibleMessageMetadata: true, exactHeardFallback: true, currentSnapshotFallback: true }, pageErrors, unexpectedNetwork };
  const output = path.join(root, 'screenshots/realtime-voice'); fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, 'ui-state-results.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close(); await vite.close();
}
