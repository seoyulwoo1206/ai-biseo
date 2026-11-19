// 원격 연결 로그인 (OAuth 2.1 + PKCE + 동적 등록) — ChatGPT·Claude 의 "커스텀 커넥터"가 쓰는 표준 방식
// 주소 (vercel.json 이 이쪽으로 보낸다):
//   /.well-known/oauth-protected-resource   → 이 MCP 서버가 어떤 로그인 서버를 쓰는지
//   /.well-known/oauth-authorization-server → 로그인 서버 정보
//   /register  → 앱(ChatGPT 등) 등록. DB 없이 등록 정보를 봉투에 담아 client_id 로 돌려준다
//   /authorize → 체크메이트 계정으로 로그인하는 화면
//   /token     → 로그인 코드 ↔ 토큰 바꾸기, 토큰 새로 받기
'use strict';
const crypto = require('crypto');
const L = require('./_lib');

const ACCESS_FALLBACK_SEC = 3600;
const CODE_SEC = 300;

function okRedirect(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'https:') return true;
    return x.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(x.hostname);
  } catch {
    return false;
  }
}

function asMeta(base) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
    scopes_supported: ['assistant'],
  };
}

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function page(res, { client, q, error }) {
  const hidden = ['client_id', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'scope', 'resource']
    .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k])}">`)
    .join('');
  res.statusCode = error ? 401 : 200;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
  res.end(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AI 비서 연결</title><style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f5fb;font-family:system-ui,'Malgun Gothic',sans-serif;color:#262935}
.card{width:min(360px,calc(100vw - 32px));background:#fff;border-radius:20px;padding:26px 22px;box-shadow:0 10px 30px -8px rgba(40,50,90,.3)}
h1{margin:0 0 6px;font-size:20px}p{margin:0 0 16px;color:#6b7086;font-size:14px;line-height:1.5}
b.c{color:#3f55d0}label{display:block;font-size:13px;font-weight:700;margin:12px 0 5px}
input[type=email],input[type=password]{box-sizing:border-box;width:100%;padding:11px 12px;border:1.5px solid #e1e4ee;border-radius:11px;font-size:15px}
input:focus{outline:none;border-color:#5b7cfa}button{width:100%;margin-top:18px;padding:12px;border:0;border-radius:12px;background:#5b7cfa;color:#fff;font-size:15px;font-weight:800;cursor:pointer}
.err{margin-top:12px;color:#e0506a;font-size:13px}.can{margin-top:14px;font-size:12px;color:#8a8fa3;line-height:1.5}
ul{margin:0 0 4px;padding-left:18px;color:#4a4e60;font-size:13px;line-height:1.6}
</style></head><body><form class="card" method="post" action="/authorize">
<h1>🐾 AI 비서 연결</h1>
<p><b class="c">${esc(client.n || '앱')}</b>이(가) 체크메이트 계정으로 AI 비서를 쓰려고 해요.</p>
<ul><li>오늘 일정·할 일 보기, 할 일 넣기·완료</li><li>켜져 있는 PC 비서에 집중·알림·말풍선 부탁</li></ul>
${hidden}
<label for="e">체크메이트 이메일</label><input id="e" name="email" type="email" autocomplete="username" required value="${esc(q.email)}">
<label for="p">비밀번호</label><input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">로그인하고 허락하기</button>
${error ? `<div class="err">${esc(error)}</div>` : ''}
<div class="can">내가 연결하려던 게 아니면 이 창을 닫아 주세요. 비밀번호는 체크메이트 로그인에만 쓰이고 저장하지 않아요.</div>
</form></body></html>`);
}

function redirectWith(res, uri, params) {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== '') u.searchParams.set(k, v);
  res.statusCode = 302;
  res.setHeader('Location', u.toString());
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

function issue(sb, cid) {
  const exp = sb.expires_at || Math.floor(Date.now() / 1000) + (sb.expires_in || ACCESS_FALLBACK_SEC);
  const uid = sb.user && sb.user.id;
  const client = L.open(cid, 'client');
  return {
    access_token: L.seal({ t: 'at', sa: sb.access_token, uid, exp, n: client ? client.n : null }),
    token_type: 'Bearer',
    expires_in: Math.max(60, exp - Math.floor(Date.now() / 1000) - 30),
    refresh_token: L.seal({ t: 'rt', sr: sb.refresh_token, cid }),
    scope: 'assistant',
  };
}

module.exports = async (req, res) => {
  L.cors(res);
  if (req.method === 'OPTIONS') return res.end();
  const base = L.baseUrl(req);
  const url = new URL(req.url, base);
  const step = url.searchParams.get('step');
  try {
    if (step === 'meta-pr') {
      return L.json(res, 200, { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: ['assistant'], bearer_methods_supported: ['header'], resource_name: 'AI 비서' });
    }
    if (step === 'meta-as') return L.json(res, 200, asMeta(base));

    if (step === 'register') {
      if (req.method !== 'POST') return L.json(res, 405, { error: 'invalid_request' });
      const b = await L.readBody(req);
      const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String).slice(0, 10) : [];
      if (!uris.length || !uris.every(okRedirect)) return L.json(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be https (or localhost)' });
      const name = String(b.client_name || '앱').slice(0, 60);
      const client_id = L.seal({ t: 'client', ru: uris, n: name });
      return L.json(res, 201, {
        client_id,
        client_id_issued_at: Math.floor(Date.now() / 1000),
        client_name: name,
        redirect_uris: uris,
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      });
    }

    if (step === 'authorize') {
      const q = req.method === 'POST' ? await L.readBody(req) : Object.fromEntries(url.searchParams);
      const client = L.open(q.client_id, 'client');
      if (!client) return L.json(res, 400, { error: 'invalid_client', error_description: 'unknown client_id (register first)' });
      if (!q.redirect_uri || !client.ru.includes(q.redirect_uri)) return L.json(res, 400, { error: 'invalid_request', error_description: 'redirect_uri not registered' });
      if (!q.code_challenge || (q.code_challenge_method || 'S256') !== 'S256') {
        return redirectWith(res, q.redirect_uri, { error: 'invalid_request', error_description: 'PKCE S256 required', state: q.state });
      }
      if (req.method !== 'POST') return page(res, { client, q });
      let sb;
      try {
        sb = await L.sbAuth('password', { email: String(q.email || '').trim(), password: String(q.password || '') });
      } catch {
        return page(res, { client, q: { ...q, password: '' }, error: '이메일이나 비밀번호가 맞지 않아요. 체크메이트 계정으로 다시 해 주세요.' });
      }
      const code = L.seal({ t: 'code', sa: sb.access_token, sr: sb.refresh_token, ea: sb.expires_at, uid: sb.user && sb.user.id, cc: q.code_challenge, rd: q.redirect_uri, cid: q.client_id, exp: Math.floor(Date.now() / 1000) + CODE_SEC });
      return redirectWith(res, q.redirect_uri, { code, state: q.state });
    }

    if (step === 'token') {
      if (req.method !== 'POST') return L.json(res, 405, { error: 'invalid_request' });
      const b = await L.readBody(req);
      if (b.grant_type === 'authorization_code') {
        const c = L.open(b.code, 'code');
        if (!c) return L.json(res, 400, { error: 'invalid_grant', error_description: 'code expired or invalid' });
        if (b.redirect_uri && b.redirect_uri !== c.rd) return L.json(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri mismatch' });
        if (b.client_id && b.client_id !== c.cid) return L.json(res, 400, { error: 'invalid_grant', error_description: 'client mismatch' });
        const check = crypto.createHash('sha256').update(String(b.code_verifier || '')).digest('base64url');
        if (check !== c.cc) return L.json(res, 400, { error: 'invalid_grant', error_description: 'PKCE verification failed' });
        return L.json(res, 200, issue({ access_token: c.sa, refresh_token: c.sr, expires_at: c.ea, user: { id: c.uid } }, c.cid));
      }
      if (b.grant_type === 'refresh_token') {
        const r = L.open(b.refresh_token, 'rt');
        if (!r) return L.json(res, 400, { error: 'invalid_grant', error_description: 'refresh token invalid' });
        let sb;
        try {
          sb = await L.sbAuth('refresh_token', { refresh_token: r.sr });
        } catch (e) {
          return L.json(res, 400, { error: 'invalid_grant', error_description: `please reconnect (${e.message})` });
        }
        return L.json(res, 200, issue(sb, r.cid));
      }
      return L.json(res, 400, { error: 'unsupported_grant_type' });
    }
    return L.json(res, 404, { error: 'not_found' });
  } catch (e) {
    return L.json(res, 500, { error: 'server_error', error_description: e.message });
  }
};
