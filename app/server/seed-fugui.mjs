// 徐先生演示数据（虚构，路演用）：人物原型取自余华《活着》里的福贵，内容为自编的口述片段，不引用原书文字。
// 三次已完成的访谈：童年家境、成家、中年和老年。每次有逐句访谈稿、实体、故事，供“记忆库/档案/人生地图/历史记录”展示。
export const FUGUI_ID = 'demo-fugui';
const PROFILE = { name: '徐福贵', gender: '男', callName: '徐先生', birthYear: '1936', hometown: '南方农村', people: '老伴家珍（已故）、儿子有庆（已故）、女儿凤霞（已故）、外孙苦根', stage: '' };
const P0 = (type, name, o = {}) => ({ type, name, ...o });
const SESSIONS = [
  { id: 'i-fugui-1', daysAgo: 9, node: 'child-home', title: '少爷的日子，我只剩下一点印象了',
    turns: [
      { ask: ['child-home', 1], node: 'child-home', depth: 1, emotion: '开心', note: '家里有田，小时候不愁吃穿',
        a: '我们家那会儿有一百来亩地，村里人见了我爸都要点头。我小时候是不愁吃穿的，起得晚，也没人管。',
        ent: [P0('place', '徐家老宅', { note: '家里有一百来亩地' })] },
      { ask: ['child-home', 2], node: 'child-home', depth: 2, emotion: '平静', note: '爹每天坐在院里晒太阳，我骑在长工肩上',
        a: '我爹爱坐在院子里晒太阳，我就骑在长工的脖子上，让他驮着我去镇上。回来的路上，一路都是稻子的味道。',
        ent: [P0('person', '爹', { relation: 'parents', deceased: true, note: '爱坐院子里晒太阳' }), P0('place', '镇上', { note: '骑长工脖子去的地方' })] },
      { ask: ['child-newyear', 1], node: 'child-newyear', depth: 2, emotion: '开心', note: '过年家里杀猪，有糯米团子',
        a: '过年最热闹。杀了猪，满院子都是肉香，我娘蒸糯米团子，我一次能吃四五个，撑得走不动路。',
        ent: [P0('person', '娘', { relation: 'parents', note: '过年蒸糯米团子' }), P0('thing', '糯米团子', { trigger: 'food', note: '一次能吃四五个' })] },
      { ask: ['child-newyear', 3], node: 'child-newyear', depth: 3, emotion: '难过', note: '年轻时荒唐，后来把家业败了，说起来不是滋味',
        a: '后来……我那些年荒唐，家里的东西一样一样都没了。说起来，心里不是滋味。不说这个了，不说这个了。',
        ent: [] }] },
  { id: 'i-fugui-2', daysAgo: 5, node: 'youth-meet', title: '家珍是我这辈子最大的福气',
    turns: [
      { ask: ['youth-meet', 1], node: 'youth-meet', depth: 1, emotion: '开心', note: '家珍是米店老板的女儿，嫁过来',
        a: '家珍是城里米店老板的闺女，识字，说话轻声细语的。她嫁给我的时候，我们家还算体面。',
        ent: [P0('person', '家珍', { aliases: ['老伴'], relation: 'spouse', deceased: true, note: '米店老板的女儿，识字，说话轻声细语' }), P0('place', '米店', { note: '家珍娘家' })] },
      { ask: ['youth-wedding', 2], node: 'youth-wedding', depth: 2, emotion: '平静', note: '家境败了以后，家珍回娘家又自己回来了',
        a: '后来家里穷了，她回了娘家一阵子。可是没多久，她自己又回来了，还带着肚子里的孩子。我一辈子都记得她推开门的样子。',
        ent: [P0('person', '家珍', { note: '穷了以后回娘家，又自己回来' })] },
      { ask: ['youth-firstchild', 1], node: 'youth-firstchild', depth: 2, emotion: '开心', note: '头一个孩子是凤霞，扎两根小辫子',
        a: '头一个是凤霞，爱笑，扎两根小辫子，我抱着她在田埂上走，她一点都不怕。',
        ent: [P0('person', '凤霞', { relation: 'children', deceased: true, note: '头一个孩子，爱笑，两根小辫子' })] },
      { ask: ['youth-firstchild', 3], node: 'youth-firstchild', depth: 3, emotion: '平静', note: '家珍夜里织布，我在旁边看着灯',
        a: '那时候夜里家珍织布，我就坐在旁边看着那盏油灯。灯芯噼啪响一下，她就抬头冲我笑一下。那是我最踏实的日子。',
        ent: [P0('thing', '油灯', { trigger: 'object', note: '家珍夜里织布时点的灯' })] }] },
  { id: 'i-fugui-3', daysAgo: 2, node: 'midlife-kids', title: '有庆跑起来，像一阵风',
    turns: [
      { ask: ['midlife-kids', 1], node: 'midlife-kids', depth: 1, emotion: '开心', note: '儿子有庆爱跑步，在学校跑第一',
        a: '有庆是我儿子，那孩子爱跑，在学校里跑起来谁也追不上。每回拿了第一，隔着老远就喊爹。',
        ent: [P0('person', '有庆', { relation: 'children', deceased: true, note: '爱跑步，学校里跑第一' }), P0('place', '学校', { note: '有庆读书跑步的地方' })] },
      { ask: ['midlife-kids', 2], node: 'midlife-kids', depth: 2, emotion: '开心', note: '背着有庆上学路上，夏天他在背上睡着了',
        a: '夏天我背着他走去学校，走到半道，他在我背上睡着了，口水都流到我脖子上。我也舍不得叫醒他。',
        ent: [] },
      { ask: ['elder-oldthing', 1], node: 'elder-oldthing', depth: 2, emotion: '平静', note: '老牛，我给它取名叫福贵，它陪我种了好些年地',
        a: '后来我买了一头老牛，舍不得它干重活，就管它叫福贵，和我一个名。我对它说话，它也像是听得懂，耳朵一动一动的。',
        ent: [P0('thing', '老牛', { aliases: ['福贵（牛）'], trigger: 'object', note: '陪着种了好些年地，和我同名' })] },
      { ask: ['elder-grandkids', 1], node: 'elder-grandkids', depth: 3, emotion: '开心', note: '外孙苦根跟着我，爱吃煮豆子',
        a: '外孙苦根跟着我过。我给他煮豆子，他吃得满嘴都是，还问我，外公，明天还有吗。我说，有，明天还有。',
        ent: [P0('person', '苦根', { relation: 'children', note: '外孙，爱吃煮豆子' }), P0('thing', '煮豆子', { trigger: 'food', note: '外孙最爱吃' })] }] },
];
const STORIES = {
  'i-fugui-1': { title: '少爷的日子，我只剩下一点印象了', body: '我们家那会儿有一百来亩地，村里人见了我爸都要点头。我小时候是不愁吃穿的，起得晚，也没人管。\n\n我爹爱坐在院子里晒太阳，我就骑在长工的脖子上，让他驮着我去镇上。回来的路上，一路都是稻子的味道。\n\n过年最热闹。杀了猪，满院子都是肉香，我娘蒸糯米团子，我一次能吃四五个，撑得走不动路。\n\n后来……我那些年荒唐，家里的东西一样一样都没了。说起来，心里不是滋味。不说这个了。', people: '爹；娘', timePlace: '南方农村，徐家老宅、镇上', quotes: '“回来的路上，一路都是稻子的味道。”' },
  'i-fugui-2': { title: '家珍是我这辈子最大的福气', body: '家珍是城里米店老板的闺女，识字，说话轻声细语的。她嫁给我的时候，我们家还算体面。\n\n后来家里穷了，她回了娘家一阵子。可是没多久，她自己又回来了，还带着肚子里的孩子。我一辈子都记得她推开门的样子。\n\n头一个是凤霞，爱笑，扎两根小辫子，我抱着她在田埂上走，她一点都不怕。\n\n那时候夜里家珍织布，我就坐在旁边看着那盏油灯。灯芯噼啪响一下，她就抬头冲我笑一下。那是我最踏实的日子。', people: '家珍（老伴）；凤霞（女儿）', timePlace: '米店、田埂', quotes: '“我一辈子都记得她推开门的样子。”' },
  'i-fugui-3': { title: '有庆跑起来，像一阵风', body: '有庆是我儿子，那孩子爱跑，在学校里跑起来谁也追不上。每回拿了第一，隔着老远就喊爹。\n\n夏天我背着他走去学校，走到半道，他在我背上睡着了，口水都流到我脖子上。我也舍不得叫醒他。\n\n后来我买了一头老牛，舍不得它干重活，就管它叫福贵，和我一个名。我对它说话，它也像是听得懂，耳朵一动一动的。\n\n外孙苦根跟着我过。我给他煮豆子，他吃得满嘴都是，还问我，外公，明天还有吗。我说，有，明天还有。', people: '有庆（儿子）；苦根（外孙）', timePlace: '学校、田里', quotes: '“我说，有，明天还有。”' },
};
const ARCHIVE = {
  people: [{ name: '家珍', relation: '老伴（已故）', note: '米店老板的女儿，识字，说话轻声细语；穷了以后回娘家，又自己回来' }, { name: '凤霞', relation: '女儿（已故）', note: '头一个孩子，爱笑，两根小辫子' }, { name: '有庆', relation: '儿子（已故）', note: '爱跑步，学校里跑第一，夏天在背上睡着过' }, { name: '苦根', relation: '外孙', note: '爱吃煮豆子，问外公明天还有吗' }, { name: '爹', relation: '父亲（已故）', note: '爱坐在院子里晒太阳' }, { name: '娘', relation: '母亲', note: '过年蒸糯米团子' }],
  places: [{ name: '徐家老宅', note: '家里有一百来亩地' }, { name: '米店', note: '家珍娘家' }, { name: '学校', note: '有庆读书跑步的地方' }],
  events: [{ title: '骑在长工脖子上去镇上', when: '小时候', detail: '回来的路上一路都是稻子味' }, { title: '家珍自己回来', when: '穷了以后', detail: '带着肚子里的孩子推开门' }, { title: '背有庆去学校', when: '夏天', detail: '他在背上睡着了' }, { title: '买下老牛，取名福贵', when: '后来', detail: '舍不得它干重活' }],
  timeline: [{ when: '1936', what: '出生在南方农村，家里有田' }, { when: '成家后', what: '家珍嫁过来，后来生下凤霞' }, { when: '中年', what: '有庆在学校跑第一；买了老牛' }, { when: '晚年', what: '外孙苦根跟着我过' }],
  conflicts: [],
  lastTopic: '您的外孙苦根爱吃煮豆子，还问您明天还有吗',
};
export async function seedFugui({ db, ai, P }) {
  const FW = ai.FW, p = { ...PROFILE }, now = Date.now(); let states = {}, entities = [], prev = null, k0 = 0;
  const bg = x => { const c = x.replace(/[\s，。,.！!？?…、“”"]/g, ''), r = new Set(); for (let i = 0; i < c.length - 1; i++) r.add(c.slice(i, i + 2)); return r; };
  db.run('insert into elders values(?,?,?,?)', [FUGUI_ID, JSON.stringify(p), JSON.stringify({ ...ARCHIVE, interviews: SESSIONS.map(s => s.id), asked: [], updatedAt: now, source: 'demo' }), now - 10 * 864e5]);
  SESSIONS.forEach((S, si) => {
    const t0 = now - S.daysAgo * 864e5, plan = { ...P.planSession(FW, { profile: p, request: { nodeId: S.node } }), sessionId: S.id, lastSessionId: prev };
    const opening = P.openingText(FW, plan, { profile: p }, si > 0);
    const turns = S.turns.map((a, k) => { const id = `${S.id}-t${k + 1}`, q = k ? P.questionFor(FW, a.ask[0], a.ask[1], p) : opening;
      states = P.applyAnswer(FW, states, { nodeId: a.node, depth: a.depth, note: a.note, short: false, emotion: a.emotion }, S.id).states;
      entities = P.mergeEntities(entities, a.ent, a.node, S.id);
      const names = new Set(a.ent.map(x => x.name)); for (const x of entities) if (names.has(x.name)) x.sourceTurns = [...new Set([...(x.sourceTurns || []), id])];
      return { id, q, qid: a.ask.join(':'), ask: { nodeId: a.ask[0], depth: a.ask[1] }, raw: a.a, clean: a.a, audio: null, at: t0 + k * 70000, asrSource: 'demo',
        analysis: { nodeId: a.node, depth: a.depth, note: a.note, entities: a.ent }, agent: { emotion: a.emotion, action: '追问细节', source: 'demo' } }; });
    plan.ask = { nodeId: S.turns.at(-1).ask[0], depth: 4 }; plan.done = true;
    db.run('insert into interviews values(?,?,?,?,?,?,1)', [S.id, FUGUI_ID, P.nodeTitle(FW, S.node, p), t0, JSON.stringify(turns), JSON.stringify({ say: opening, source: 'demo', plan, closing: P.closingText(FW, plan, { profile: p }) })]);
    turns.forEach((t, k) => db.run('insert into transcript_turns values(?,?,?,?,?)', [t.id, S.id, FUGUI_ID, k + 1, JSON.stringify({ id: t.id, idx: k + 1, at: t.at, question: t.q, raw: t.raw, clean: t.clean, audio: null, asrSource: 'demo', nodeId: t.analysis.nodeId, depth: t.analysis.depth, emotion: t.agent.emotion, note: t.analysis.note, askedNode: t.ask.nodeId, askedDepth: t.ask.depth })]));
    const s = STORIES[S.id], paras = s.body.split(/\n+/).filter(Boolean).map(text => { const b = bg(text);
      return { text, refs: turns.map(t => ({ id: t.id, n: [...b].filter(x => bg(t.clean).has(x)).length / Math.max(1, Math.min(b.size, bg(t.clean).size)) })).filter(x => x.n >= 0.25).sort((a, c) => c.n - a.n).slice(0, 2).map(x => x.id) }; });
    db.run('insert into stories values(?,?,?,?,?)', [`s-fugui-${si + 1}`, FUGUI_ID, S.id, t0 + 500000, JSON.stringify({ ...s, source: 'demo', stage: P.nodeTitle(FW, S.node, p), paras, clips: turns.map(t => ({ id: t.id, q: t.q, text: t.clean, audio: null })) })]);
    prev = S.id; k0++; });
  db.run('insert or replace into elder_state values(?,?,?)', [FUGUI_ID, JSON.stringify(states), JSON.stringify(entities)]);
}
export const FUGUI_PROFILE = PROFILE;
