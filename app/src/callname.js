// 称呼规则（2026-10-24 决策）：统一「姓＋先生/女士」，不叫全名、不叫爷爷奶奶；老人主动要求别的叫法就改口并记入档案
export const COMPOUND = ['欧阳', '司马', '诸葛', '上官', '东方', '皇甫', '尉迟', '公孙', '慕容', '令狐', '长孙', '宇文', '司徒', '司空', '夏侯', '轩辕', '端木', '南宫', '西门', '独孤', '万俟', '闻人', '澹台', '公冶', '太史', '申屠', '钟离', '呼延', '百里', '东郭', '赫连', '拓跋', '第五', '亓官', '濮阳', '单于', '左丘', '谷梁'];
export const surname = (name = '') => { const n = String(name).replace(/\s/g, ''); if (!n) return ''; return COMPOUND.find(c => n.startsWith(c) && n.length > c.length) || n[0]; };
export const honorific = g => /^(男|m|male)/i.test(g || '') ? '先生' : /^(女|f|female)/i.test(g || '') ? '女士' : '';
// 默认称呼：姓＋先生/女士；没填性别时返回空（由调用方兜底为“您”）
export const autoCallName = (name, gender) => { const s = surname(name), h = honorific(gender); return s && h ? s + h : ''; };
export const callNameOf = (p = {}) => p.callName || autoCallName(p.name, p.gender) || '您';
// 规则兜底：从老人原话里识别“叫我老王”“你就叫我秀兰吧”“别叫我女士，叫王姨”
export function detectCallName(text = '') {
  const m = String(text).match(/(?<![他她它们人家别不要都也])(?:你|您)?(?:就|以后|往后|还是|直接)?(?:叫|喊|称呼)我(?:一声)?[“"「]?([\u4e00-\u9fa5]{1,5}?)[”"」]?(?:就行|就好|就可以|吧|好了|好不好|行不行|[，,。.！!？?\s]|$)/);
  if (!m) return null; const c = m[1];
  if (!c || /^(什么|啥|怎么|名字|一下|过去|回来|起来|去|来)$/.test(c) || /^[去来回过做吃干说看]/.test(c)) return null;
  return c;
}
// 档案称呼：家人手动改过（callNameManual）或老人要求过（callNameBy=elder）就不再自动覆盖
export const withAutoCallName = (p = {}) => (p.callNameManual || p.callNameBy === 'elder') ? p : { ...p, callName: autoCallName(p.name, p.gender) || p.callName || '' };
