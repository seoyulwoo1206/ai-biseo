// 나이스(학교 급식·시간표) 대신 물어봐 주기: GET /api/neis?ep=hisTimetable&...
// - 나이스는 인증키가 없으면 5줄까지만 줘서 시간표가 5교시에서 잘린다.
//   서버에 키 하나(Vercel 환경 변수 NEIS_KEY)를 넣어 두면 쓰는 사람 모두 키 없이 7교시까지 본다.
// - 정해 둔 나이스 기능·항목만 넘기고, 같은 질문은 Vercel 이 3시간 기억해서(캐시) 나이스에 다시 안 묻는다.
// - 키는 응답에 절대 넣지 않는다.
'use strict';

const BASE = 'https://open.neis.go.kr/hub/';
const ENDPOINTS = new Set(['schoolInfo', 'mealServiceDietInfo', 'hisTimetable', 'misTimetable', 'elsTimetable', 'spsTimetable']);
const PARAMS = new Set([
  'SCHUL_NM',
  'ATPT_OFCDC_SC_CODE',
  'SD_SCHUL_CODE',
  'MMEAL_SC_CODE',
  'MLSV_YMD',
  'MLSV_FROM_YMD',
  'MLSV_TO_YMD',
  'ALL_TI_YMD',
  'TI_FROM_YMD',
  'TI_TO_YMD',
  'AY',
  'SEM',
  'GRADE',
  'CLASS_NM',
]);
const VALUE = /^[0-9A-Za-z가-힣 ._-]{1,40}$/;

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, '', { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET' });
  if (req.method !== 'GET') return send(res, 405, { error: 'GET only' });
  const u = new URL(req.url, 'http://x');
  const ep = u.searchParams.get('ep');
  if (!ENDPOINTS.has(ep)) return send(res, 400, { error: 'unknown ep' });
  const key = (process.env.NEIS_KEY || '').trim();
  const q = new URLSearchParams({ Type: 'json', pIndex: '1', pSize: key ? '100' : '5' });
  for (const [k, v] of u.searchParams) {
    if (k === 'ep') continue;
    if (!PARAMS.has(k) || !VALUE.test(v)) return send(res, 400, { error: `bad param ${k}` });
    q.set(k, v);
  }
  if (key) q.set('KEY', key);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(BASE + ep + '?' + q, { signal: ctrl.signal });
    const text = await r.text();
    if (!r.ok) return send(res, 502, { error: `neis ${r.status}` }, { 'x-aibiseo-neis': key ? 'key' : 'nokey' });
    // 키가 틀렸으면(INFO-300 등) 키 없이 한 번 더: 그래도 5교시까지는 보이게
    if (key && /"CODE"\s*:\s*"(?:ERROR-290|INFO-300)"/.test(text)) {
      q.delete('KEY');
      q.set('pSize', '5');
      const r2 = await fetch(BASE + ep + '?' + q, { signal: ctrl.signal });
      return send(res, 200, await r2.text(), { 'x-aibiseo-neis': 'badkey', 'cache-control': 'public, s-maxage=600' });
    }
    return send(res, 200, text, {
      'x-aibiseo-neis': key ? 'key' : 'nokey',
      'cache-control': 'public, s-maxage=10800, stale-while-revalidate=3600',
      'access-control-allow-origin': '*',
    });
  } catch (e) {
    return send(res, 504, { error: e.name === 'AbortError' ? 'neis timeout' : 'neis unreachable' });
  } finally {
    clearTimeout(t);
  }
};
