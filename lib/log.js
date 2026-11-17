// 문제를 찾으려고 남기는 짧은 기록: <userData>/aibiseo.log (키·비밀번호 같은 값은 절대 적지 않는다)
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const KEEP = 400; // 줄 수
let trimmed = false;

function file() {
  return path.join(app.getPath('userData'), 'aibiseo.log');
}

function log(...args) {
  const line = `${new Date().toISOString()} [${process.pid}] ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`;
  try {
    if (!trimmed) {
      trimmed = true;
      const old = fs.existsSync(file()) ? fs.readFileSync(file(), 'utf8').split('\n') : [];
      if (old.length > KEEP) fs.writeFileSync(file(), old.slice(-KEEP).join('\n'));
    }
    fs.appendFileSync(file(), line);
  } catch {
    /* 기록을 못 남겨도 비서는 계속 돈다 */
  }
}

module.exports = log;
