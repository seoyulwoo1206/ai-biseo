// 학교 급식·시간표 (나이스 교육정보 개방 포털 open.neis.go.kr 공개 API)
// - 인증키 없이도 되지만 한 번에 5줄까지만 와서, 시간표는 5교시까지만 보인다.
//   무료 인증키를 넣으면 6·7교시까지 다 보인다.
// - 같은 날 같은 질문은 기억해 두었다가(캐시) 다시 부르지 않는다.
const BASE = 'https://open.neis.go.kr/hub/';
const TIMEOUT_MS = 8000;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

async function call(endpoint, params, key) {
  const q = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: key ? '100' : '5', ...params });
  if (key) q.set('KEY', key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(BASE + endpoint + '?' + q, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`나이스 응답 ${res.status}`);
    const data = await res.json();
    if (data.RESULT) {
      if (data.RESULT.CODE === 'INFO-200') return []; // 데이터 없음
      throw new Error(data.RESULT.MESSAGE || '나이스 오류');
    }
    const block = data[endpoint];
    const head = block[0].head;
    const result = head.find((h) => h.RESULT);
    if (result && result.RESULT.CODE !== 'INFO-000') throw new Error(result.RESULT.MESSAGE);
    return block[1].row || [];
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('나이스 서버가 응답하지 않아');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

// 학교 찾기: 이름 일부로 (인증키 없으면 5개까지)
async function search(name, key) {
  name = String(name || '').trim();
  if (name.length < 2) return [];
  const rows = await call('schoolInfo', { SCHUL_NM: name }, key);
  return rows
    .filter((r) => r.SD_SCHUL_CODE && r.SD_SCHUL_CODE.trim())
    .map((r) => ({
      name: r.SCHUL_NM,
      office: r.ATPT_OFCDC_SC_CODE,
      code: r.SD_SCHUL_CODE.trim(),
      kind: r.SCHUL_KND_SC_NM, // 초등학교 / 중학교 / 고등학교 / 특수학교 …
      area: (r.ORG_RDNMA || r.LCTN_SC_NM || '').split(' ').slice(0, 2).join(' '),
    }));
}

// 반찬 이름 다듬기: "된장찌개 (5.6)" → "된장찌개", "[철판이벤트] 철판삼겹살구이" → "철판삼겹살구이"
function cleanDish(s) {
  return String(s)
    .replace(/\([0-9.,\s]+\)/g, '')
    .replace(/([가-힣A-Za-z)])\d{1,2}(?:[.,]\d{1,2})+(?=\s|$|[&/])/g, '$1') // "돈강정2,5,6" 처럼 붙은 알레르기 번호
    .replace(/\[[^\]]*\]/g, '')
    .replace(/[*#]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const MEAL_NAME = { 조식: 'breakfast', 중식: 'lunch', 석식: 'dinner' };
const cache = new Map(); // key → { at, value }
const CACHE_MS = 3 * 60 * 60 * 1000;

async function cached(key, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return value;
}

/** 하루 급식 → { breakfast?: {dishes, kcal}, lunch?, dinner? } (없는 날은 {}) */
function meals(school, date = new Date(), key) {
  return cached(`meal|${school.code}|${ymd(date)}`, async () => {
    const rows = await call('mealServiceDietInfo', { ATPT_OFCDC_SC_CODE: school.office, SD_SCHUL_CODE: school.code, MLSV_YMD: ymd(date) }, key);
    const out = {};
    for (const r of rows) {
      const which = MEAL_NAME[r.MMEAL_SC_NM];
      if (!which) continue;
      const dishes = String(r.DDISH_NM || '')
        .split(/<br\s*\/?>/i)
        .map(cleanDish)
        .filter(Boolean);
      out[which] = { dishes, kcal: parseFloat(r.CAL_INFO) || null };
    }
    return out;
  });
}

const TIMETABLE_EP = { 초등학교: 'elsTimetable', 중학교: 'misTimetable', 고등학교: 'hisTimetable', 특수학교: 'spsTimetable' };

/** 하루 시간표 → [{ period: 1, subject: '국어' }] (주말·방학이면 []) */
function timetable(school, grade, classNm, date = new Date(), key) {
  const ep = TIMETABLE_EP[school.kind] || 'hisTimetable';
  return cached(`tt|${school.code}|${grade}|${classNm}|${ymd(date)}|${key ? 'k' : ''}`, async () => {
    const rows = await call(ep, { ATPT_OFCDC_SC_CODE: school.office, SD_SCHUL_CODE: school.code, ALL_TI_YMD: ymd(date), GRADE: String(grade), CLASS_NM: String(classNm) }, key);
    const byPeriod = new Map();
    for (const r of rows) {
      const p = parseInt(r.PERIO, 10);
      if (!p || byPeriod.has(p)) continue;
      byPeriod.set(p, String(r.ITRT_CNTNT || '').replace(/^-/, '').trim());
    }
    return [...byPeriod.entries()].sort((a, b) => a[0] - b[0]).map(([period, subject]) => ({ period, subject }));
  });
}

// 종 시간: 1교시 시작, 수업 길이, 쉬는 시간, 점심(몇 교시 뒤, 몇 분) → 교시별 [시작, 끝] (분 단위)
function bellTimes({ start = '08:40', classMin = 50, breakMin = 10, lunchAfter = 4, lunchMin = 50 } = {}, periods = 7) {
  const [h, m] = String(start).split(':').map(Number);
  let t = (h || 8) * 60 + (m || 0);
  const out = [];
  for (let p = 1; p <= periods; p++) {
    out.push({ period: p, start: t, end: t + classMin });
    t += classMin + (p === lunchAfter ? lunchMin : breakMin);
  }
  return out;
}

const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

module.exports = { search, meals, timetable, bellTimes, hm, cleanDish, _cache: cache };
