// AI 키 보관함: 키마다 파일로 저장하고, 비서를 껐다 켜도 꼭 다시 읽히게 이중으로 지킨다.
//  1) <name>-key.bin   : Electron safeStorage(크롬과 같은 방식)로 암호화
//  2) <name>-key.dpapi : (윈도우) 윈도우 계정 잠금(DPAPI)으로 직접 암호화한 예비 사본
//     safeStorage 의 열쇠가 바뀌어서 1)을 못 풀면 2)로 되살리고 1)을 새로 쓴다.
// 파일은 임시 파일에 다 쓴 뒤 바꿔치기해서, 쓰다가 꺼져도 깨진 파일이 남지 않게 한다.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { app, safeStorage } = require('electron');
const log = require('./log');

const IS_WIN = process.platform === 'win32';
const file = (name, ext = 'bin') => path.join(app.getPath('userData'), `${name}-key.${ext}`);
const cache = new Map(); // name → 읽은 키 (읽는 데 성공한 것만 기억)
const failedAt = new Map(); // name → 마지막으로 못 읽은 시각. 잠깐 뒤에 다시 해 본다 (절전에서 막 깼을 때 등)
const RETRY_MS = 15 * 1000;
const broken = new Set(); // 파일은 있는데 못 읽은 키

function writeAtomic(target, data) {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, data);
  try {
    fs.renameSync(tmp, target);
  } catch {
    fs.writeFileSync(target, data); // 백신 등이 잡고 있어서 바꿔치기가 안 되면 그냥 쓴다
    fs.rmSync(tmp, { force: true });
  }
}

// ---------- 윈도우 DPAPI (PowerShell). 키는 명령 줄이 아니라 입력(stdin)으로만 넘긴다 ----------
const DPAPI = (op) =>
  'Add-Type -AssemblyName System.Security;' +
  '$i=[Console]::In.ReadToEnd().Trim();' +
  `$b=[Security.Cryptography.ProtectedData]::${op}([Convert]::FromBase64String($i),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);` +
  '[Convert]::ToBase64String($b)';

function dpapi(op, base64) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI(op)], {
    input: base64,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 20000,
  });
  return out.trim();
}

function saveBackup(name, key) {
  if (!IS_WIN) return;
  try {
    writeAtomic(file(name, 'dpapi'), dpapi('Protect', Buffer.from(key, 'utf8').toString('base64')));
  } catch (e) {
    console.error('키 예비 사본 저장 실패:', e.message);
  }
}

function loadBackup(name) {
  if (!IS_WIN) return null;
  try {
    const key = Buffer.from(dpapi('Unprotect', fs.readFileSync(file(name, 'dpapi'), 'utf8')), 'base64').toString('utf8');
    return key || null;
  } catch (e) {
    log('keys: 예비 사본 못 읽음', name, String(e.message || e).slice(0, 120));
    return null;
  }
}

// ---------- 기본 저장 (safeStorage) ----------
const canEncrypt = () => safeStorage.isEncryptionAvailable();

function writeMain(name, key) {
  const data = canEncrypt() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8');
  writeAtomic(file(name), data);
}

function readMain(name) {
  const raw = fs.readFileSync(file(name));
  if (canEncrypt()) return safeStorage.decryptString(raw);
  // 암호화 기능이 아직 준비 안 됐는데 암호화된 파일이면, 글자로 읽지 말고 실패로 친다 (엉터리 키가 되지 않게)
  if (raw.subarray(0, 3).toString() === 'v10') throw new Error('암호화 기능이 아직 준비 안 됨');
  return raw.toString('utf8');
}

function load(name) {
  if (cache.has(name)) return cache.get(name);
  if (failedAt.has(name) && Date.now() - failedAt.get(name) < RETRY_MS) return null;
  let key = null;
  const hasMain = fs.existsSync(file(name));
  const hasBackup = fs.existsSync(file(name, 'dpapi'));
  if (hasMain) {
    try {
      key = readMain(name) || null;
    } catch (e) {
      log('keys: 기본 파일 못 읽음', name, `ready=${app.isReady()} enc=${canEncrypt()}`, String(e.message || e).slice(0, 120));
      key = null;
    }
  }
  if (key) {
    if (!hasBackup) saveBackup(name, key); // 예전에 저장한 키도 예비 사본을 만들어 둔다
  } else if (hasBackup) {
    key = loadBackup(name);
    // 기본 파일은 다시 쓰지 않는다: 지금 이 실행의 암호 열쇠가 이상한 거라면, 다시 써도 다음에 또 못 읽는다
    if (key) log('keys: 예비 사본에서 되살림', name);
  }
  if (!key && (hasMain || hasBackup)) broken.add(name);
  else broken.delete(name);
  if (key) {
    cache.set(name, key);
    failedAt.delete(name);
  } else if (hasMain || hasBackup) failedAt.set(name, Date.now());
  return key;
}

function save(name, key) {
  writeMain(name, key);
  // 바로 다시 읽어서 확인
  let back = null;
  try {
    back = readMain(name);
  } catch {
    back = null;
  }
  if (back !== key) throw new Error('키를 저장하지 못했어. 한 번 더 넣어 줘.');
  saveBackup(name, key);
  broken.delete(name);
  failedAt.delete(name);
  cache.set(name, key);
  log('keys: 저장함', name, `예비 사본=${fs.existsSync(file(name, 'dpapi'))}`);
}

function clear(name) {
  for (const ext of ['bin', 'dpapi']) fs.rmSync(file(name, ext), { force: true });
  broken.delete(name);
  failedAt.delete(name);
  cache.delete(name);
  log('keys: 지움', name);
}

// 'ok' | 'none' | 'broken'(파일은 있는데 못 읽음)
function status(name) {
  const key = load(name);
  if (key) return 'ok';
  return broken.has(name) ? 'broken' : 'none';
}

module.exports = { load, save, clear, status };
