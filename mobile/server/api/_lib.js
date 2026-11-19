// 원격 연결 서버 공용 도구 (Vercel 함수에서 씀, 외부 패키지 없음)
// - 봉투(seal/open): 서버 비밀값(AIBISEO_SECRET)으로 AES-256-GCM 암호화한 작은 토큰. DB 없이 로그인 상태를 들고 다닌다.
// - 체크메이트(Supabase) 로그인·REST 호출
// - PC 비서에게 실시간 채널로 부탁하고 대답 기다리기
'use strict';
const crypto = require('crypto');
const SB = require('./_sb.json'); // { url, key } 체크메이트 공개용 주소·키 (폰 웹에도 들어 있는 것)

// ---------- 봉투 ----------
function secretKey() {
  const s = process.env.AIBISEO_SECRET;
  if (!s || s.length < 32) throw new Error('server secret missing');
  return crypto.createHash('sha256').update(s).digest();
}
const b64u = (buf) => Buffer.from(buf).toString('base64url');

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const body = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return b64u(Buffer.concat([iv, c.getAuthTag(), body]));
}

function open(token, type) {
  try {
    const raw = Buffer.from(String(token || ''), 'base64url');
    if (raw.length < 29) return null;
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const obj = JSON.parse(Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8'));
    if (type && obj.t !== type) return null;
    if (obj.exp && obj.exp < Date.now() / 1000) return null;
    return obj;
  } catch {
    return null;
  }
}

// ---------- 요청 도우미 ----------
function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}

async function readBody(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body !== 'string' && !Buffer.isBuffer(req.body)) return req.body;
  let text = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body) ? req.body.toString('utf8') : '';
  if (!text) {
    text = await new Promise((resolve, reject) => {
      let s = '';
      req.setEncoding('utf8');
      req.on('data', (c) => {
        s += c;
        if (s.length > 256 * 1024) reject(new Error('too large'));
      });
      req.on('end', () => resolve(s));
      req.on('error', reject);
    });
  }
  const type = String(req.headers['content-type'] || '');
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return {};
  }
}

function json(res, code, obj, headers = {}) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(obj));
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type, mcp-protocol-version, mcp-session-id');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
}

// ---------- 체크메이트 (Supabase) ----------
async function sbAuth(grant, body) {
  const r = await fetch(`${SB.url}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST',
    headers: { apikey: SB.key, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.access_token) throw new Error(data.error_description || data.msg || data.error || `login failed (${r.status})`);
  return data; // { access_token, refresh_token, expires_at, user }
}

async function sbUser(access) {
  const r = await fetch(`${SB.url}/auth/v1/user`, { headers: { apikey: SB.key, authorization: `Bearer ${access}` } });
  if (!r.ok) return null;
  return r.json();
}

// PostgREST: 그 사람 토큰으로 → 체크메이트 보안 규칙(RLS) 그대로 자기 것만
async function sbRest(access, method, pathAndQuery, body, prefer) {
  const headers = { apikey: SB.key, authorization: `Bearer ${access}`, 'content-type': 'application/json' };
  if (prefer) headers.prefer = prefer;
  const r = await fetch(`${SB.url}/rest/v1/${pathAndQuery}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) throw new Error((data && (data.message || data.hint)) || `checkmate ${r.status}`);
  return data;
}

// ---------- 한국 시간 ----------
function kstDate(offsetDays = 0) {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000);
  return d.toISOString().slice(0, 10);
}
function kstNowText() {
  return new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'full', timeStyle: 'short' });
}

// ---------- PC 비서에게 부탁 (실시간 채널) ----------
// PC 는 체크메이트 계정 정보(user_metadata.aibiseo_channel)에 적어 둔 무작위 채널을 듣고 있다.
function askPc(channel, name, args, client, timeoutMs = 7000) {
  return new Promise((resolve) => {
    if (!channel || typeof WebSocket === 'undefined') return resolve({ offline: true });
    const topic = `realtime:aibiseo-${channel}`;
    const id = crypto.randomBytes(8).toString('hex');
    const ws = new WebSocket(`${SB.url.replace(/^https:/, 'wss:')}/realtime/v1/websocket?apikey=${SB.key}&vsn=1.0.0`);
    let ref = 0;
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {}
      resolve(v);
    };
    const send = (event, payload) => ws.send(JSON.stringify({ topic, event, payload, ref: String(++ref) }));
    const timer = setTimeout(() => finish({ offline: true }), timeoutMs);
    ws.onopen = () => send('phx_join', { config: { broadcast: { self: false, ack: false }, presence: { key: '' }, private: false }, access_token: SB.key });
    ws.onmessage = (ev) => {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m.event === 'phx_reply' && m.ref === '1') {
        if (!m.payload || m.payload.status !== 'ok') return finish({ offline: true, error: 'channel join failed' });
        send('broadcast', { type: 'broadcast', event: 'cmd', payload: { id, name, args, client } });
      } else if (m.event === 'broadcast' && m.payload && m.payload.event === 'ack' && m.payload.payload && m.payload.payload.id === id) {
        finish(m.payload.payload);
      }
    };
    ws.onerror = () => finish({ offline: true });
  });
}

module.exports = { SB, seal, open, baseUrl, readBody, json, cors, sbAuth, sbUser, sbRest, kstDate, kstNowText, askPc };
