// Claude 데스크톱 앱에 "AI 비서" 도구(MCP 서버)를 등록·해제한다.
// Claude 앱 설정 파일(claude_desktop_config.json)의 mcpServers 에 ai-biseo 한 줄만 넣고 빼며,
// 다른 연결은 건드리지 않는다. 고치기 전에 .bak 으로 한 벌 남긴다.
const fs = require('fs');
const os = require('os');
const path = require('path');

const NAME = 'ai-biseo';
const FILE = 'claude_desktop_config.json';

// Claude 앱 설정 폴더 후보 (일반 설치 / 마이크로소프트 스토어(MSIX) 설치 / 맥)
function claudeDirs() {
  const home = os.homedir();
  if (process.platform === 'darwin') return [path.join(home, 'Library', 'Application Support', 'Claude')];
  if (process.platform !== 'win32') return [path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Claude')];
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const dirs = [path.join(roaming, 'Claude')];
  try {
    for (const p of fs.readdirSync(path.join(local, 'Packages'))) {
      if (/^(Claude|AnthropicClaude|Anthropic\.Claude)_/i.test(p)) dirs.push(path.join(local, 'Packages', p, 'LocalCache', 'Roaming', 'Claude'));
    }
  } catch {}
  return dirs;
}

function isInstalled(dirs = claudeDirs()) {
  if (dirs.some((d) => fs.existsSync(d))) return true;
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return fs.existsSync(path.join(local, 'AnthropicClaude'));
  }
  return process.platform === 'darwin' && fs.existsSync('/Applications/Claude.app');
}

// 고칠 파일들: 이미 있는 설정 파일 전부 → 없으면 이미 있는 설정 폴더 전부
// (스토어판 Claude 는 LocalCache 쪽 폴더만 있다) → 그것도 없으면 기본 위치 하나
function targets(dirs = claudeDirs()) {
  const files = dirs.map((d) => path.join(d, FILE));
  const existing = files.filter((f) => fs.existsSync(f));
  if (existing.length) return existing;
  const inDirs = dirs.filter((d) => fs.existsSync(d)).map((d) => path.join(d, FILE));
  return inDirs.length ? inDirs : [files[0]];
}

// Claude 앱이 실행할 명령: 비서와 같은 Electron 을 node 모드로 쓴다 (node 를 따로 안 깔아도 됨)
function entry(projectDir, execPath = process.execPath) {
  return {
    command: execPath,
    args: [path.join(projectDir, 'mcp', 'aibiseo-mcp.js')],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  };
}

function readConfig(file) {
  if (!fs.existsSync(file)) return {};
  const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  if (!text.trim()) return {};
  try {
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('not an object');
    return obj;
  } catch {
    // 망가진 파일은 덮어쓰지 않는다 (사용자가 직접 고친 내용이 날아가면 안 되니까)
    throw new Error(`Claude 설정 파일을 읽을 수 없어서 건드리지 않았어: ${file}`);
  }
}

function writeConfig(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, file);
}

/** @returns {{ installed: boolean, state: 'connected'|'outdated'|'none', files: string[] }} */
function status(projectDir, { dirs = claudeDirs(), execPath } = {}) {
  const want = entry(projectDir, execPath);
  let state = 'none';
  for (const f of targets(dirs)) {
    let cur;
    try {
      cur = ((readConfig(f).mcpServers || {})[NAME]) || null;
    } catch {
      continue;
    }
    if (!cur) continue;
    const same = cur.command === want.command && JSON.stringify(cur.args) === JSON.stringify(want.args);
    state = same ? 'connected' : 'outdated';
    if (same) break;
  }
  return { installed: isInstalled(dirs), state, files: targets(dirs) };
}

function install(projectDir, { dirs = claudeDirs(), execPath } = {}) {
  const files = targets(dirs);
  for (const f of files) {
    const cfg = readConfig(f);
    const servers = cfg.mcpServers && typeof cfg.mcpServers === 'object' ? cfg.mcpServers : {};
    cfg.mcpServers = { ...servers, [NAME]: entry(projectDir, execPath) };
    writeConfig(f, cfg);
  }
  return files;
}

function remove({ dirs = claudeDirs() } = {}) {
  const files = targets(dirs).filter((f) => fs.existsSync(f));
  for (const f of files) {
    const cfg = readConfig(f);
    if (!cfg.mcpServers || !cfg.mcpServers[NAME]) continue;
    delete cfg.mcpServers[NAME];
    writeConfig(f, cfg);
  }
  return files;
}

module.exports = { NAME, claudeDirs, status, install, remove, entry };
