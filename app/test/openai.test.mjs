import test from 'node:test'; import assert from 'node:assert/strict';
process.env.OPENAI_API_KEY = 'sk-test-secret'; process.env.OPENAI_BASE_URL = 'https://relay.example/v1/'; process.env.OPENAI_MODEL = 'm-test';
const { openaiChat, openaiEnabled } = await import('../server/openai.mjs');
const realFetch = globalThis.fetch;
const mock = (status, body, seen = {}) => { globalThis.fetch = async (url, init) => { seen.url = url; seen.init = init; return { ok: status < 400, status, json: async () => body }; }; return seen; };
test.afterEach(() => { globalThis.fetch = realFetch; });

test('有 key 即启用；LLM_PROVIDER=gemini 可强制关闭', () => {
  assert.equal(openaiEnabled(), true);
  process.env.LLM_PROVIDER = 'gemini'; assert.equal(openaiEnabled(), false); delete process.env.LLM_PROVIDER;
});
test('请求格式：chat/completions、Bearer、system+user、json 模式', async () => {
  const seen = mock(200, { choices: [{ message: { content: '```json\n{"say":"好"}\n```' } }] });
  const r = await openaiChat([{ text: '甲' }, { text: '乙' }], { system: 'SYS', json: true });
  assert.deepEqual(r, { say: '好' });
  assert.equal(seen.url, 'https://relay.example/v1/chat/completions');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test-secret');
  const b = JSON.parse(seen.init.body);
  assert.equal(b.model, 'm-test'); assert.deepEqual(b.response_format, { type: 'json_object' });
  assert.deepEqual(b.messages, [{ role: 'system', content: 'SYS' }, { role: 'user', content: '甲\n乙' }]);
});
test('纯文本模式返回 trim 后的字符串', async () => {
  mock(200, { choices: [{ message: { content: '  你好  ' } }] });
  assert.equal(await openaiChat([{ text: 'x' }]), '你好');
});
test('错误信息里不泄露 key', async () => {
  mock(401, { error: { code: 'bad_key', message: 'invalid key sk-test-secret' } });
  await assert.rejects(openaiChat([{ text: 'x' }]), e => e.message.includes('401') && !e.message.includes('sk-test-secret'));
});
test('空回复抛错，交给上层回退', async () => {
  mock(200, { choices: [{ message: { content: '' } }] });
  await assert.rejects(openaiChat([{ text: 'x' }]), /空回复/);
});

const { openaiTranscribe, asrViaOpenai } = await import('../server/openai.mjs');
test('转写：multipart 到 /audio/transcriptions，带 model/language/file', async () => {
  const seen = mock(200, { text: ' 我是在纺织厂认识老李的 ' });
  const t = await openaiTranscribe(Buffer.from('xx'), 'audio/webm;codecs=opus');
  assert.equal(t, '我是在纺织厂认识老李的');
  assert.equal(seen.url, 'https://relay.example/v1/audio/transcriptions');
  assert.equal(seen.init.headers.Authorization, 'Bearer sk-test-secret');
  const fd = seen.init.body; assert.equal(fd.get('model'), 'whisper-1'); assert.equal(fd.get('language'), 'zh'); assert.equal(fd.get('file').name, 'a.webm');
});
test('转写：错误不泄露 key；ASR_PROVIDER=gemini 可关闭', async () => {
  mock(500, { error: { message: 'boom sk-test-secret' } });
  await assert.rejects(openaiTranscribe(Buffer.from('x'), 'audio/mp4'), e => !e.message.includes('sk-test-secret'));
  assert.equal(asrViaOpenai(), true); process.env.ASR_PROVIDER = 'gemini'; assert.equal(asrViaOpenai(), false); delete process.env.ASR_PROVIDER;
});
