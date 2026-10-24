import test from 'node:test'; import assert from 'node:assert/strict';
import { surname, autoCallName, callNameOf, detectCallName, withAutoCallName } from '../src/callname.js';
import { fill } from '../src/questions.js';
test('称呼生成：姓＋先生/女士，含复姓', () => {
  assert.equal(autoCallName('王秀兰', '女'), '王女士'); assert.equal(autoCallName('李建国', '男'), '李先生');
  assert.equal(autoCallName('欧阳修文', '男'), '欧阳先生'); assert.equal(autoCallName('司马燕', '女'), '司马女士');
  assert.equal(autoCallName('诸葛明', '男'), '诸葛先生'); assert.equal(autoCallName('上官婉', '女'), '上官女士');
  assert.equal(surname('欧阳'), '欧'); assert.equal(autoCallName('王秀兰', ''), '');
  assert.equal(callNameOf({ name: '王秀兰', gender: '女' }), '王女士'); assert.equal(callNameOf({}), '您');
  assert.equal(fill('{称呼}，您好', { name: '张桂芳', gender: '女' }), '张女士，您好');
});
test('手动改过/老人要求过的称呼不被自动覆盖', () => {
  assert.equal(withAutoCallName({ name: '王秀兰', gender: '女', callName: '王奶奶' }).callName, '王女士');
  assert.equal(withAutoCallName({ name: '王秀兰', gender: '女', callName: '秀兰姐', callNameManual: true }).callName, '秀兰姐');
  assert.equal(withAutoCallName({ name: '王秀兰', gender: '女', callName: '老王', callNameBy: 'elder' }).callName, '老王');
});
test('改口识别', () => {
  assert.equal(detectCallName('别叫我女士了，叫我老王就行。'), '老王'); assert.equal(detectCallName('你就叫我秀兰吧'), '秀兰');
  assert.equal(detectCallName('您喊我王姨吧。'), '王姨'); assert.equal(detectCallName('他们都喊我王姨。'), null); assert.equal(detectCallName('那是在厂里，纺织厂。'), null);
  assert.equal(detectCallName('他叫我去食堂'), null);
});
test('nextTurn 兜底：老人改口后当轮就用新称呼', async () => {
  delete process.env.GEMINI_API_KEY; const ai = await import('../server/ai.mjs'); const P = await import('../src/planner.js');
  const p = { name: '王秀兰', gender: '女', callName: '王女士' }, plan = P.planSession(ai.FW, { profile: p });
  const n = await ai.nextTurn(p, { archive: {}, states: {}, entities: [], plan }, [{ q: 'x', clean: '叫我老王就行，我们那时候在纺织厂上班。' }], 's1');
  assert.equal(n.callName, '老王');
});
