import test from 'node:test';
import assert from 'node:assert/strict';
import { ttsPython } from '../server/dashscope.mjs';

test('TTS Python selection keeps explicit setting, otherwise uses isolated local environment', () => {
  assert.equal(ttsPython({ configured: '/custom/python', local: '/app/.venv/bin/python', exists: () => true }), '/custom/python');
  assert.equal(ttsPython({ configured: '', local: '/app/.venv/bin/python', exists: () => true }), '/app/.venv/bin/python');
  assert.equal(ttsPython({ configured: '', local: '/app/.venv/bin/python', exists: () => false }), 'python3');
});

import { dsCall } from '../server/dashscope.mjs';
import { getEventListeners } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('already cancelled TTS does not launch a subprocess', async () => {
  process.env.DASHSCOPE_API_KEY = 'synthetic-test'; process.env.DASHSCOPE_WS_URL = 'wss://example.invalid';
  await assert.rejects(dsCall('m', '合成样本', 'v', 500, { signal: AbortSignal.abort(), python: '/does-not-exist' }), /已取消/);
});

test('completed and cancelled TTS release their abort listeners', async () => {
  process.env.DASHSCOPE_API_KEY = 'synthetic-test'; process.env.DASHSCOPE_WS_URL = 'wss://example.invalid';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-tts-cancel-')), script = path.join(dir, 'fake.py');
  fs.writeFileSync(script, "import sys\nsys.stdin.read()\nsys.stdout.buffer.write(b'\\x01\\x02')\n");
  const ctl = new AbortController();
  try {
    await dsCall('m', '合成样本', 'v', 2000, { signal: ctl.signal, script }); assert.equal(getEventListeners(ctl.signal, 'abort').length, 0);
    fs.writeFileSync(script, "import time\ntime.sleep(10)\n");
    const cancelled = dsCall('m', '合成样本', 'v', 2000, { signal: ctl.signal, script });
    ctl.abort(); await assert.rejects(cancelled, /已取消/); assert.equal(getEventListeners(ctl.signal, 'abort').length, 0);
  }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
