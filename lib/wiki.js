// AI 키가 없어도 "○○가 뭐야" 에 대답하기: 한국어 위키백과 요약 (무료, 키 필요 없음).
// PC(main.js)와 폰(mobile/web/backend.js)이 같이 쓴다. 보내는 건 물어본 낱말뿐.
const API = 'https://ko.wikipedia.org';
const IS_NODE = typeof window === 'undefined';
// 위키백과는 프로그램 이름을 밝혀 달라고 한다 (브라우저에서는 이 머리글을 못 바꾼다)
const HEADERS = IS_NODE ? { 'User-Agent': 'AIBiseo/0.1 (personal desk assistant)' } : {};

async function getJSON(url) {
  let res;
  try {
    res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  } catch {
    throw new Error('인터넷 연결을 확인해 줘.');
  }
  if (res.status === 429) throw new Error('위키백과가 잠깐 바쁘대. 조금 있다가 다시 물어봐 줘.');
  if (!res.ok) throw new Error(`위키백과에서 못 가져왔어 (${res.status})`);
  return res.json();
}

const cache = new Map(); // 같은 걸 또 물어보면 다시 안 묻는다

// 첫 두세 문장만 (말풍선에 맞게)
function shorten(text, max = 230) {
  const clean = String(text || '')
    .replace(/\s*\([^()]*\)/g, '') // 괄호 속 한자·영문 풀이는 빼고
    .replace(/\s+/g, ' ')
    .trim();
  const sentences = clean.match(/[^.!?。]+[.!?。]+/g) || [clean];
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > max && out) break;
    out += s;
    if (out.length >= 90) break; // 한두 문장이면 충분
  }
  return (out || clean.slice(0, max)).trim();
}

/**
 * 낱말 찾기
 * @returns {Promise<null | { title: string, text: string, url: string }>}
 */
async function lookup(topic) {
  topic = String(topic || '').trim().slice(0, 60);
  if (!topic) return null;
  if (cache.has(topic)) return cache.get(topic);
  const hit = await find(topic);
  cache.set(topic, hit);
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return hit;
}

async function find(topic) {
  const q = encodeURIComponent(topic);
  const found = await getJSON(`${API}/w/api.php?action=query&list=search&srsearch=${q}&srlimit=3&format=json&origin=*`);
  const hits = (found.query && found.query.search) || [];
  for (const hit of hits) {
    const page = await getJSON(`${API}/api/rest_v1/page/summary/${encodeURIComponent(hit.title.replace(/ /g, '_'))}`);
    if (page.type === 'disambiguation' || !page.extract) continue; // "여러 뜻" 문서는 건너뛴다
    const url = (page.content_urls && (page.content_urls.mobile || page.content_urls.desktop) || {}).page || `${API}/wiki/${encodeURIComponent(hit.title)}`;
    return { title: page.title || hit.title, text: shorten(page.extract), url };
  }
  return null;
}

module.exports = { lookup, shorten };
