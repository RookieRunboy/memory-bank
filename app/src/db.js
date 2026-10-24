// IndexedDB 保存故事（含录音 Blob）
const open = () => new Promise((res, rej) => { const r = indexedDB.open('memory-bank', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('stories', { keyPath: 'id' });
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const tx = async (mode, fn) => { const db = await open(); return new Promise((res, rej) => {
  const t = db.transaction('stories', mode); const q = fn(t.objectStore('stories')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
export const saveStory = s => tx('readwrite', st => st.put(s));
export const listStories = async () => (await tx('readonly', st => st.getAll()) || []).sort((a, b) => b.createdAt - a.createdAt);
export const getStory = id => tx('readonly', st => st.get(id));
export const getProfile = () => JSON.parse(localStorage.getItem('mb_profile') || 'null');
export const setProfile = p => localStorage.setItem('mb_profile', JSON.stringify(p));
