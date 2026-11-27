// 학교 급식·시간표 (나이스 교육정보 개방 포털 open.neis.go.kr 공개 API)
// - 인증키 없이도 되지만 한 번에 5줄까지만 와서, 시간표는 5교시까지만 보인다.
//   그래서 보통은 우리 서버(/api/neis)를 거쳐 묻는다: 서버에 키가 하나 있으면 모두 7교시까지 본다.
//   서버가 안 되면 나이스에 바로 (키 없이) 묻는다. 내 키를 넣었으면 내 키로 바로 묻는다.
// - 같은 날 같은 질문은 기억해 두었다가(캐시) 다시 부르지 않는다.
const BASE = 'https://open.neis.go.kr/hub/';
const TIMEOUT_MS = 8000;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

const PROXY = (typeof process !== 'undefined' && process.env && process.env.AIBISEO_NEIS_PROXY) || 'https://ai-biseo-mocha.vercel.app/api/neis';
let serverFull = false; // 서버에 키가 있어서 7교시까지 받아 오는지 (마지막으로 물어봤을 때)

async function call(endpoint, params, key) {
  if (!key) {
    try {
      return await request(PROXY + '?' + new URLSearchParams({ ep: endpoint, ...params }), endpoint, (res) => {
        serverFull = res.headers.get('x-aibiseo-neis') === 'key';
      });
    } catch {
      /* 서버가 안 되면 아래에서 나이스에 바로 */
    }
  }
  const q = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: key ? '100' : '5', ...params });
  if (key) q.set('KEY', key);
  return request(BASE + endpoint + '?' + q, endpoint);
}

async function request(url, endpoint, onRes) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`나이스 응답 ${res.status}`);
    if (onRes) onRes(res);
    const data = await res.json();
    if (data.RESULT) {
      if (data.RESULT.CODE === 'INFO-200') return []; // 데이터 없음
      throw new Error(data.RESULT.MESSAGE || '나이스 오류');
    }
    const block = data[endpoint];
    const head = block[0].head;
    const result = head.find((h) => h.RESULT);
    if (result && result.RESULT.CODE !== 'INFO-000') throw new Error(result.RESULT.MESSAGE);
    const rows = block[1].row || [];
    const total = head.find((h) => h.list_total_count != null);
    rows.total = total ? Number(total.list_total_count) : rows.length;
    return rows;
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
    .replace(/([가-힣)])(?:\d{1,2}k*|k+)-?(?=\s|$|\/)/g, '$1') // "찌개1k", "밥k", "우유1k-", "보리밥1", "샐러드kk"
    .replace(/\/\s*$/, '')
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

// 여러 쪽으로 나뉜 결과를 다 받기 (키가 있을 때만 쪽 넘기기가 된다)
async function callAll(endpoint, params, key, maxPages = 8) {
  const first = await call(endpoint, { ...params, pIndex: '1' }, key);
  const out = [...first];
  for (let page = 2; out.length < first.total && first.length >= 100 && page <= maxPages; page++) {
    const more = await call(endpoint, { ...params, pIndex: String(page) }, key);
    if (!more.length) break;
    out.push(...more);
  }
  return out;
}

const subjectOf = (r) => String(r.ITRT_CNTNT || '').replace(/^-/, '').trim();
const sectionOf = (r) => {
  const m = String(r.CLRM_NM || '').match(/\((\d+)\)\s*$/);
  return m ? Number(m[1]) : null;
};
const sharedName = (s) => s.replace(/([^\d\s])\d{1,2}$/, '$1'); // "자율연구Ⅱ1" → "자율연구Ⅱ"
const FREE = '공강';

// 첫 수업과 마지막 수업 사이에 비는 교시 → 공강 (영재고·과학고는 공강이 흔하다)
function withFree(list) {
  if (!list.length) return list;
  const last = Math.max(...list.map((x) => x.period));
  const first = Math.min(...list.map((x) => x.period));
  const out = [];
  for (let p = first; p <= last; p++) out.push(list.find((x) => x.period === p) || { period: p, subject: FREE, free: true });
  for (const k of Object.keys(list)) if (Number.isNaN(Number(k))) out[k] = list[k]; // elective, rooms 같은 표시도 옮긴다
  return out;
}

/**
 * 반 번호가 없는 학교(과학고·영재고 등): 시간표가 "강의실(분반)" 로 올라온다. 예) CLRM_NM "M301(1)", "AAaa1-1"
 * - 내 수업을 골라 뒀으면(mine: ["과목|분반"]) 그 수업만, 나머지 시간은 공강
 * - 아니면 괄호 숫자(분반) = 고른 반 번호인 수업을 그 반 시간표로 본다
 * - 괄호가 없는 줄(자율연구처럼 학년 전체가 같은 시간에 하는 것)은 모든 반에 넣는다
 * - 한 교시에 과목이 여럿이면(선택 과목) 모아서 "A / B" 로
 */
function fromRooms(rows, classNm, mine = null) {
  const want = Number(classNm);
  const picked = mine && mine.length ? new Set(mine) : null;
  const my = new Map(); // 교시 → Set(과목)
  const shared = new Map();
  for (const r of rows) {
    const p = parseInt(r.PERIO, 10);
    const subj = subjectOf(r);
    if (!p || !subj) continue;
    const sec = sectionOf(r);
    if (sec != null) {
      if (picked ? !picked.has(`${subj}|${sec}`) : sec !== want) continue;
      if (!my.has(p)) my.set(p, new Set());
      my.get(p).add(subj);
    } else {
      if (!shared.has(p)) shared.set(p, new Set());
      shared.get(p).add(sharedName(subj));
    }
  }
  const periods = [...new Set([...my.keys(), ...shared.keys()])].sort((a, b) => a - b);
  let elective = false;
  const list = periods.map((period) => {
    const names = [...(my.get(period) || shared.get(period))];
    if (names.length > 1) elective = true;
    const subject = names.length > 3 ? `${names.slice(0, 3).join(' / ')} 외 ${names.length - 3}` : names.join(' / ');
    return { period, subject };
  });
  list.elective = elective;
  list.rooms = true;
  list.picked = !!picked;
  return withFree(list);
}

/** 하루 시간표 → [{ period: 1, subject: '국어' }, { period: 4, subject: '공강', free: true }] (주말·방학이면 []) */
function timetable(school, grade, classNm, date = new Date(), key, mine = null) {
  const ep = TIMETABLE_EP[school.kind] || 'hisTimetable';
  const mineKey = mine && mine.length ? mine.slice().sort().join(',') : '';
  return cached(`tt|${school.code}|${grade}|${classNm}|${ymd(date)}|${key ? 'k' : ''}|${mineKey}`, async () => {
    const base = { ATPT_OFCDC_SC_CODE: school.office, SD_SCHUL_CODE: school.code, ALL_TI_YMD: ymd(date), GRADE: String(grade) };
    const rows = mineKey ? [] : await call(ep, { ...base, CLASS_NM: String(classNm) }, key);
    if (!rows.length) {
      // 반 번호로 안 나오면(또는 내 수업을 골라 뒀으면): 학년 전체를 받아서 강의실(분반)로 맞춰 본다
      const all = await callAll(ep, base, key);
      if (all.length && all.every((r) => !r.CLASS_NM)) return fromRooms(all, classNm, mine);
      return [];
    }
    const byPeriod = new Map();
    for (const r of rows) {
      const p = parseInt(r.PERIO, 10);
      if (!p || byPeriod.has(p)) continue;
      byPeriod.set(p, subjectOf(r));
    }
    return withFree([...byPeriod.entries()].sort((a, b) => a[0] - b[0]).map(([period, subject]) => ({ period, subject })));
  });
}

const monday = (d) => {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};

/**
 * 내 수업 고르기용: 그 주(월~금)에 그 학년에서 열리는 수업 목록 → [{ subject, sections: [1, 2, …] }]
 * 반 번호로 올라오는 보통 학교면 null (고를 필요 없음)
 */
function courses(school, grade, date = new Date(), key) {
  const mon = monday(date);
  const fri = new Date(mon);
  fri.setDate(fri.getDate() + 4);
  const ep = TIMETABLE_EP[school.kind] || 'hisTimetable';
  return cached(`courses|${school.code}|${grade}|${ymd(mon)}|${key ? 'k' : ''}`, async () => {
    const rows = await callAll(ep, { ATPT_OFCDC_SC_CODE: school.office, SD_SCHUL_CODE: school.code, TI_FROM_YMD: ymd(mon), TI_TO_YMD: ymd(fri), GRADE: String(grade) }, key, 20);
    if (!rows.length || rows.some((r) => r.CLASS_NM)) return null;
    const map = new Map();
    for (const r of rows) {
      const subj = subjectOf(r);
      const sec = sectionOf(r);
      if (!subj || sec == null) continue;
      if (!map.has(subj)) map.set(subj, new Set());
      map.get(subj).add(sec);
    }
    return [...map.entries()]
      .map(([subject, secs]) => ({ subject, sections: [...secs].sort((a, b) => a - b) }))
      .sort((a, b) => a.subject.localeCompare(b.subject, 'ko'));
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

module.exports = {
  fullTimetable: () => serverFull,
  fromRooms,
  courses,
  FREE,
  search,
  meals,
  timetable, bellTimes, hm, cleanDish, _cache: cache };
