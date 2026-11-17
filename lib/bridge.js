// 다른 AI 앱(Claude 데스크톱 등)이 비서를 "도구"로 쓰게 해 주는 작은 다리.
// - 이 컴퓨터 안(127.0.0.1)에서만 열린다. 밖(인터넷·같은 와이파이)에서는 못 들어온다.
// - 켤 때마다 새 비밀 토큰을 만들어 userData/bridge.json 에 적는다. 이 토큰이 있어야만 쓸 수 있다.
// - 웹페이지(브라우저)에서 오는 요청은 막는다(Origin 머리말이 있거나 Host 가 이상하면 거절).
// 실제 도구 연결은 mcp/aibiseo-mcp.js 가 한다 (MCP 표준 → 이 다리).
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, file);
}

/**
 * @param {{ file: string, handle: (name: string, args: object, client: string) => Promise<any>, log?: (msg: string) => void }} opts
 */
function start({ file, handle, log = () => {} }) {
  const token = crypto.randomBytes(24).toString('hex');
  const expected = Buffer.from(`Bearer ${token}`);
  let port = 0;

  const server = http.createServer((req, res) => {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(obj));
    };
    if (req.method !== 'POST' || req.url !== '/tool') return send(404, { error: 'not found' });
    // 브라우저에서 온 요청(다른 사이트가 몰래 부르는 것) 막기
    if (req.headers.origin) return send(403, { error: 'forbidden' });
    const host = String(req.headers.host || '');
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return send(403, { error: 'bad host' });
    const auth = Buffer.from(String(req.headers.authorization || ''));
    if (auth.length !== expected.length || !crypto.timingSafeEqual(auth, expected)) return send(401, { error: 'unauthorized' });

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (c) => {
      body += c;
      if (body.length > 64 * 1024) req.destroy();
    });
    req.on('end', async () => {
      let msg;
      try {
        msg = JSON.parse(body);
      } catch {
        return send(400, { error: 'bad json' });
      }
      const name = String(msg.name || '');
      const args = msg.args && typeof msg.args === 'object' && !Array.isArray(msg.args) ? msg.args : {};
      const client = String(msg.client || '다른 AI').slice(0, 40);
      try {
        const result = await handle(name, args, client);
        log(`연결 도구 ${name} (${client}) 성공`);
        send(200, { ok: true, result });
      } catch (e) {
        log(`연결 도구 ${name} (${client}) 실패: ${e.message}`);
        send(200, { ok: false, error: e.message });
      }
    });
  });

  server.on('error', (e) => log(`연결 다리 오류: ${e.message}`));
  server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    writeAtomic(file, JSON.stringify({ port, token, pid: process.pid, started: new Date().toISOString() }));
    log(`연결 다리 켜짐 port=${port}`);
  });

  return {
    close() {
      server.close();
      try {
        const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (cur.pid === process.pid) fs.unlinkSync(file);
      } catch {}
    },
  };
}

module.exports = { start };
