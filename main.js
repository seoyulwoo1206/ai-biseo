const { app, BrowserWindow, ipcMain, Menu, dialog, screen, shell, globalShortcut, powerMonitor, desktopCapturer, nativeImage } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const checkmate = require('./lib/checkmate');
const intent = require('./lib/intent');
const voice = require('./lib/voice');
const ai = require('./lib/ai');
const apps = require('./lib/apps');
const weather = require('./lib/weather');
const winwatch = require('./lib/winwatch');
const growth = require('./lib/growth');
const wiki = require('./lib/wiki');
const keys = require('./lib/keys');
const screenshot = require('./lib/screen');
const log = require('./lib/log');
const bridge = require('./lib/bridge');
const connect = require('./lib/connect');
const school = require('./lib/school');
const studylog = require('./lib/studylog');
const remote = require('./lib/remote');
const REMOTE_URL = 'https://ai-biseo-mocha.vercel.app/mcp';

// 자동 테스트(AI_SELFTEST)는 진짜 설정·키·레벨을 절대 건드리지 않게 임시 폴더를 쓴다.
// 폴더가 다르면 '하나만 켜기' 잠금도 따로라서, 켜져 있는 진짜 비서를 끄지 않고도 시험할 수 있다.
if (process.env.AI_SELFTEST) app.setPath('userData', path.join(os.tmpdir(), 'ai-assistant-selftest'));
// 속도 재기: 시험 화면이 '가려진 창'으로 여겨져 그리기를 멈추지 않게
if (process.env.AI_PERFTEST || (process.env.AI_SELFTEST && process.env.AI_SELFTEST_SHOT)) {
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
}

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
// 창 아이콘: 윈도우는 .ico, 맥·리눅스는 .png
const ICON = path.join(__dirname, 'assets', IS_WIN ? 'icon.ico' : 'icon.png');

// 알람 소리가 사용자가 누르지 않아도 나도록
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// 캐릭터 크기 (1 = 기본 210px). 창 크기는 캐릭터 크기 + 말풍선 자리로 정한다.
const BASE_STAGE = 210;
const SIZE_MIN = 0.6;
const SIZE_MAX = 1.8;
let WIN_W = 320;
let WIN_H = 550;
// 자동 테스트는 진짜 캐릭터 폴더 대신 임시 폴더를 쓴다 (지우기 시험이 진짜 그림을 지우지 않게)
const CHAR_DIR = process.env.AI_SELFTEST ? path.join(os.tmpdir(), 'ai-assistant-selftest', 'characters') : path.join(__dirname, 'characters');
const IMAGE_EXT = ['.png', '.gif', '.svg', '.webp', '.jpg', '.jpeg', '.apng'];
const DEFAULT_REMIND_MIN = 10;
const REFRESH_MS = 3 * 60 * 1000;
const CHECK_MS = 20 * 1000;
const SET_W = 300;
let SET_H = 720;

let win = null;
let loginWin = null;
let settingsWin = null;
let settingsClosedAt = 0;
let dragStart = null;
let today = null; // { date, events, todos }
let lastError = null;
const notified = new Set();

// ---------- 설정 (선택한 캐릭터 기억) ----------
const configFile = () => path.join(app.getPath('userData'), 'config.json');

// 설정 파일은 임시 파일에 다 쓴 뒤 바꿔치기하고(쓰다가 꺼져도 안 깨지게),
// 바로 전 것을 config.json.bak 으로 남겨 둔다. 본 파일이 깨졌으면 .bak 에서 읽는다.
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function loadConfig() {
  const main = readJson(configFile());
  if (main && typeof main === 'object') return main;
  if (fs.existsSync(configFile())) log('설정 파일을 못 읽어서 예비 사본을 씀');
  const bak = readJson(configFile() + '.bak');
  if (bak && typeof bak === 'object') return bak;
  return {};
}

function saveConfig(patch) {
  const file = configFile();
  const prev = loadConfig();
  const text = JSON.stringify({ ...prev, ...patch }, null, 2);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text);
  try {
    fs.renameSync(tmp, file);
  } catch {
    fs.writeFileSync(file, text);
    fs.rmSync(tmp, { force: true });
  }
  try {
    if (Object.keys(prev).length) fs.writeFileSync(file + '.bak', JSON.stringify(prev, null, 2));
  } catch {
    /* 예비 사본은 못 써도 괜찮다 */
  }
}

// ---------- 말풍선 ----------
// msg: 글자 한 줄, 또는 { title, sub, tone, sections: [{ icon, label, items: [{ time, text }] }] }
// tone: 'info'(기본) | 'alert'(일정 알림) | 'happy' | 'sad'
function say(msg, seconds = 8) {
  if (!win || win.isDestroyed()) return;
  const card = typeof msg === 'string' ? { title: msg } : msg;
  win.webContents.send('say', { card, seconds });
}

// ---------- 캐릭터 ----------
function listCharacters() {
  try {
    return fs
      .readdirSync(CHAR_DIR)
      .filter((f) => IMAGE_EXT.includes(path.extname(f).toLowerCase()))
      .sort();
  } catch {
    return [];
  }
}

// 코드로 만든 3D 캐릭터 (renderer/char3d.js 의 TYPES 와 같은 id)
const CHARACTERS_3D = [
  { id: 'cat', name: '하늘냥' },
  { id: 'bunny', name: '분홍토끼' },
  { id: 'bear', name: '곰돌이' },
  { id: 'chick', name: '삐약이' },
  { id: 'mochi', name: '찹쌀떡' },
  { id: 'penguin', name: '펭귄' },
  { id: 'frog', name: '개굴이' },
  { id: 'puppy', name: '멍멍이' },
  { id: 'panda', name: '판다' },
  { id: 'hamster', name: '햄찌' },
];

// '3d:cat' 같은 3D 캐릭터 id, 또는 characters 폴더의 이미지 파일 이름
function currentCharacter() {
  const saved = loadConfig().character;
  if (saved && saved.startsWith('3d:') && CHARACTERS_3D.some((c) => '3d:' + c.id === saved)) return saved;
  if (saved && listCharacters().includes(saved)) return saved;
  return '3d:cat';
}

function sendCharacter() {
  const name = currentCharacter();
  if (!win) return;
  if (name.startsWith('3d:')) win.webContents.send('character', { kind: '3d', type: name.slice(3), accessory: growth.view(loadConfig().growth).accessory });
  else win.webContents.send('character', { kind: 'image', url: charImageUrl(name) });
}

function chooseCharacter(name) {
  saveConfig(name.startsWith('3d:') ? { character: name, last3d: name } : { character: name });
  sendCharacter();
  pushSettings();
}

// 그림 캐릭터: 사진처럼 아주 큰 그림(예: 7760×3600)을 그대로 띄우면 투명 창이 통째로 안 그려진다.
// 그래서 긴 쪽이 CHAR_IMG_MAX 보다 크면 줄인 사본을 만들어 쓴다 (원본은 그대로 둠).
// 움직이는 그림(GIF·APNG)과 SVG 는 줄이면 움직임·선명함을 잃어서 그대로 쓴다.
const CHAR_IMG_MAX = 720;
function charImageUrl(name) {
  const file = path.join(CHAR_DIR, name);
  const original = pathToFileURL(file).href;
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(path.extname(name).toLowerCase())) return original;
  try {
    const stat = fs.statSync(file);
    const cacheDir = path.join(app.getPath('userData'), 'char-cache');
    const key = require('crypto').createHash('sha1').update(`${name}|${stat.size}|${stat.mtimeMs}`).digest('hex').slice(0, 16);
    const small = path.join(cacheDir, `${key}.png`);
    if (fs.existsSync(small)) return pathToFileURL(small).href;
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return original;
    const { width, height } = img.getSize();
    if (Math.max(width, height) <= CHAR_IMG_MAX) return original;
    const s = CHAR_IMG_MAX / Math.max(width, height);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(small, img.resize({ width: Math.round(width * s), height: Math.round(height * s), quality: 'best' }).toPNG());
    return pathToFileURL(small).href;
  } catch (e) {
    console.error('그림 줄이기 실패:', e.message);
    return original;
  }
}

// 설정 → 그림 캐릭터 ✕ : 그림을 휴지통으로 보내고(되살릴 수 있게), 쓰던 중이면 전에 쓰던 3D 캐릭터로 돌아간다
async function removeCharacterImage(name) {
  name = path.basename(String(name || ''));
  if (!listCharacters().includes(name)) return;
  const wasCurrent = currentCharacter() === name;
  try {
    await shell.trashItem(path.join(CHAR_DIR, name));
  } catch (e) {
    say({ title: '그림을 못 지웠어 😢', sub: e.message, tone: 'sad' }, 6);
    return;
  }
  if (wasCurrent) {
    const back = loadConfig().last3d;
    chooseCharacter(back && CHARACTERS_3D.some((c) => '3d:' + c.id === back) ? back : '3d:cat');
  } else pushSettings();
}

// ---------- 컴퓨터 켤 때 자동 실행 ----------
// - 윈도우: '시작프로그램' 폴더에 바로가기를 둔다. (레지스트리 Run 항목은 사라진 적이 있어서 이 방법이 더 튼튼하다)
// - 맥: ~/Library/LaunchAgents 에 로그인할 때 여는 설정(plist)을 둔다.
// - 리눅스: ~/.config/autostart 에 .desktop 파일을 둔다.
// 설치 파일 없이 개발 폴더에서 돌리는 중이라 electron 실행 파일 + 이 폴더 경로로 연다.
function startupLink() {
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.aibiseo.assistant.plist');
  if (!IS_WIN) return path.join(os.homedir(), '.config', 'autostart', 'ai-assistant.desktop');
  return path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AI 비서.lnk');
}

const xmlEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function writeStartup(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (IS_WIN) {
    shell.writeShortcutLink(file, fs.existsSync(file) ? 'replace' : 'create', linkOptions());
  } else if (IS_MAC) {
    fs.writeFileSync(
      file,
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0"><dict>',
        '  <key>Label</key><string>com.aibiseo.assistant</string>',
        '  <key>ProgramArguments</key><array>',
        `    <string>${xmlEsc(process.execPath)}</string>`,
        `    <string>${xmlEsc(app.getAppPath())}</string>`,
        '  </array>',
        '  <key>RunAtLoad</key><true/>',
        '</dict></plist>',
        '',
      ].join('\n'),
    );
  } else {
    fs.writeFileSync(
      file,
      ['[Desktop Entry]', 'Type=Application', 'Name=AI 비서', `Exec="${process.execPath}" "${app.getAppPath()}"`, `Icon=${ICON}`, 'X-GNOME-Autostart-enabled=true', ''].join('\n'),
    );
  }
}

function linkOptions() {
  return {
    target: process.execPath,
    args: `"${app.getAppPath()}"`,
    cwd: app.getAppPath(),
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    iconIndex: 0,
    description: '화면 구석에 떠 있는 캐릭터 AI 비서',
  };
}

// 예전 방식(레지스트리 Run: AI비서 / electron.app.Electron)으로 등록된 건 지운다 (두 번 켜지지 않게)
function removeLegacyAutoStart() {
  if (!IS_WIN) return;
  for (const name of ['AI비서', 'electron.app.Electron']) {
    app.setLoginItemSettings({ openAtLogin: false, path: process.execPath, args: [app.getAppPath()], name });
  }
}

function isAutoStart() {
  return fs.existsSync(startupLink());
}

function setAutoStart(on) {
  const lnk = startupLink();
  try {
    if (on) writeStartup(lnk);
    else if (fs.existsSync(lnk)) fs.unlinkSync(lnk);
  } catch (e) {
    console.error('자동 실행 설정 실패:', e.message);
  }
  saveConfig({ autoStart: on });
}

// 켤 때마다: 켜 둔 상태면 바로가기를 새로 써서 경로가 바뀌어도 맞게 한다
function ensureAutoStart() {
  removeLegacyAutoStart();
  const want = loadConfig().autoStart;
  if (want === undefined || want) setAutoStart(true);
}

function sizeScale() {
  const v = Number(loadConfig().size);
  return v >= SIZE_MIN && v <= SIZE_MAX ? v : 1;
}

function stagePx() {
  return Math.round(BASE_STAGE * sizeScale());
}

function computeWinSize() {
  const stage = stagePx();
  const area = screen.getPrimaryDisplay().workArea;
  WIN_W = Math.max(320, stage + 100);
  WIN_H = Math.min(stage + 470, area.height);
}

// 크기를 바꿀 때 캐릭터 발밑(창 아래 가운데)이 제자리에 있도록 창을 늘리고 줄인다.
let sizeSaveTimer = null;
function setSize(scale) {
  scale = Math.round(Math.min(SIZE_MAX, Math.max(SIZE_MIN, scale)) * 100) / 100;
  if (!win || scale === sizeScale()) return;
  const before = win.getBounds();
  saveConfig({ size: scale });
  computeWinSize();
  const x = Math.round(before.x + before.width / 2 - WIN_W / 2);
  const y = before.y + before.height - WIN_H;
  win.setBounds({ ...keepOnScreen(x, y), width: WIN_W, height: WIN_H });
  win.webContents.send('size', { stage: stagePx() });
  clearTimeout(sizeSaveTimer);
  sizeSaveTimer = setTimeout(() => saveConfig({ position: win.getPosition() }), 500);
  pushSettings();
}

// 창이 화면 밖으로 나가지 않게 (위쪽이 잘리면 말풍선이 안 보인다)
function keepOnScreen(x, y) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x + WIN_W / 2), y: Math.round(y + WIN_H / 2) }).workArea;
  return {
    x: Math.round(Math.min(Math.max(x, area.x - WIN_W / 3), area.x + area.width - (WIN_W * 2) / 3)),
    y: Math.round(Math.min(Math.max(y, area.y), area.y + area.height - WIN_H)),
  };
}

function remindBefore() {
  const v = loadConfig().remindBefore;
  return Number.isInteger(v) ? v : DEFAULT_REMIND_MIN;
}

async function importCharacter() {
  const result = await dialog.showOpenDialog(win, {
    title: '캐릭터 이미지 고르기',
    properties: ['openFile'],
    filters: [{ name: '이미지', extensions: IMAGE_EXT.map((e) => e.slice(1)) }],
  });
  if (result.canceled || !result.filePaths[0]) return;
  const src = result.filePaths[0];
  const name = path.basename(src);
  const dest = path.join(CHAR_DIR, name);
  if (path.resolve(src) !== path.resolve(dest)) fs.copyFileSync(src, dest);
  chooseCharacter(name);
  say({ title: '새 모습 어때?', tone: 'happy', icon: '✨' }, 4);
}

// ---------- 체크메이트 일정 ----------
function minutesOf(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function hhmm(date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// ---------- 캐릭터 키우기 (경험치 · 레벨 · 꾸미기) ----------
// list: [[종류, 이름표], …] — 같은 이름표로는 한 번만 받는다 (lib/growth.js)
function grow(list) {
  let state = loadConfig().growth;
  let gained = 0;
  let before = null;
  let after = null;
  const newItems = [];
  for (const [kind, key] of list) {
    const r = growth.award(state, kind, key);
    state = r.state;
    if (!r.gained) continue;
    gained += r.gained;
    before = before || r.before;
    after = r.after;
    newItems.push(...r.newItems);
  }
  if (!gained) return 0;
  if (!process.env.AI_SELFTEST) saveConfig({ growth: state }); // 자동 테스트 중엔 진짜 레벨을 건드리지 않는다
  if (win && !win.isDestroyed()) win.webContents.send('xp', { gained, level: after.level });
  if (after.level > before.level) {
    const item = newItems[newItems.length - 1];
    say(
      {
        title: `레벨 업! Lv.${after.level} 🎉`,
        sub: item ? `${item.emoji} ${item.name}을(를) 얻어서 달아 봤어! 설정 → 꾸미기에서 바꿀 수 있어` : '계속 이렇게만 하자!',
        tone: 'happy',
        icon: item ? item.emoji : '⭐',
        react: 'dance',
      },
      10,
    );
    if (item) sendCharacter();
  }
  pushSettings();
  return gained;
}

// 오늘 끝낸 할 일은 (체크메이트 앱에서 끝냈어도) 하나에 10 XP
function rewardDoneTodos() {
  if (!today) return;
  grow(today.todos.filter((t) => t.done).map((t) => ['todo', t.id]));
}

async function refresh({ announce = false } = {}) {
  try {
    today = await checkmate.fetchToday();
    lastError = null;
    rewardDoneTodos();
    if (!today && announce) say(loginHint(), 10);
  } catch (e) {
    lastError = e.message;
    if (announce) say({ title: '일정을 못 불러왔어', sub: e.message, tone: 'sad', icon: '😢' }, 8);
  }
}

function notifyOnce(key, card) {
  if (notified.has(key)) return;
  notified.add(key);
  say({ tone: 'alert', ...card }, 20);
}

function loginHint() {
  return { title: '체크메이트에 로그인해 줘!', sub: '나를 눌러서 설정 → 로그인', tone: 'info', icon: '🔑' };
}

function checkReminders() {
  grow([['daily', checkmate.dateKey()]]); // 하루 첫 출석
  if (!today || today.date !== checkmate.dateKey()) {
    // 날짜가 바뀌면 새로 불러온다.
    if (today) refresh();
    return;
  }
  const now = nowMinutes();
  for (const e of today.events) {
    if (!e.start) continue;
    const left = minutesOf(e.start) - now;
    const key = `${today.date}|ev|${e.id}|${e.start}`;
    const when = e.end ? `${e.start} ~ ${e.end}` : `${e.start} 시작`;
    if (left === 0) notifyOnce(key + '|now', { title: `지금 ${e.title} 시간이야!`, sub: when, icon: '⏰' });
    else if (left > 0 && left <= remindBefore())
      notifyOnce(key + '|soon', { title: `${left}분 뒤에 ${e.title}!`, sub: when, icon: '📅', countdown: left });
  }
  const nowMs = Date.now();
  for (const t of today.todos) {
    if (t.done || !t.remindAt) continue;
    const diff = nowMs - t.remindAt.getTime();
    // 알림 시각이 지난 지 5분 안이면 알려준다 (프로그램을 늦게 켰을 때 옛날 알림이 쏟아지지 않게).
    if (diff >= 0 && diff < 5 * 60 * 1000) {
      notifyOnce(`${today.date}|todo|${t.id}|${t.remindAt.getTime()}`, {
        title: `${t.title} 할 시간이야!`,
        sub: `${t.goal ? t.goal + ' · ' : ''}${hhmm(t.remindAt)}`,
        icon: '✅',
        color: t.color,
      });
    }
  }
}

// 오늘 카드 데이터 (renderer 의 renderToday 가 그린다)
function summary(extra = {}) {
  if (!today) {
    if (lastError) return { title: '일정을 못 불러왔어', sub: lastError, tone: 'sad', icon: '😢' };
    return loginHint();
  }
  const now = nowMinutes();

  // 일정: 지난 것 / 지금 / 다음 / 나중
  let nextFound = false;
  const events = today.events.map((e) => {
    let state = 'later';
    let inMin = null;
    if (!e.start) state = 'allday';
    else {
      const s0 = minutesOf(e.start);
      const s1 = e.end ? minutesOf(e.end) : s0 + 1;
      if (now >= s1) state = 'past';
      else if (now >= s0) state = 'now';
      else if (!nextFound) {
        state = 'next';
        nextFound = true;
        inMin = s0 - now;
      }
    }
    return { time: e.start || '종일', end: e.end, title: e.title, state, inMin };
  });

  const todos = today.todos.map((t) => ({
    id: t.id,
    title: t.title,
    time: t.remindAt ? hhmm(t.remindAt) : '',
    done: t.done,
    color: t.color,
    goal: t.goal,
  }));
  const done = todos.filter((t) => t.done).length;
  const total = todos.length;
  const ratio = total ? done / total : 1;
  const left = total - done;

  let cheer;
  if (!total && !events.some((e) => e.state !== 'past')) cheer = '오늘은 여유로운 날~ 푹 쉬어 ☁️';
  else if (ratio === 1) cheer = '오늘 할 일 다 끝냈어! 최고야 🎉';
  else if (ratio >= 0.7) cheer = `${left}개만 더 하면 끝! 거의 다 왔어 💪`;
  else if (ratio >= 0.4) cheer = '벌써 절반 가까이 했네! 이 기세로 ✨';
  else if (done > 0) cheer = '좋아, 시작이 반이야! 🌱';
  else cheer = '오늘도 하나씩 해 보자! 🔥';

  const d = new Date();
  const day = '일월화수목금토'[d.getDay()];
  return {
    kind: 'today',
    title: '오늘의 할 일',
    sub: `${d.getMonth() + 1}월 ${d.getDate()}일 ${day}요일`,
    tone: ratio === 1 && total ? 'happy' : 'info',
    progress: { done, total },
    events,
    todos,
    goals: today.goals || [],
    cheer,
    ...extra,
  };
}

// ---------- 로그인 창 ----------
function openLogin() {
  if (loginWin && !loginWin.isDestroyed()) {
    loginWin.focus();
    return;
  }
  loginWin = new BrowserWindow({
    width: 360,
    height: 330,
    resizable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    title: '체크메이트 로그인',
    autoHideMenuBar: true,
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  loginWin.loadFile(path.join(__dirname, 'renderer', 'login.html'));
}

ipcMain.handle('login', async (_e, { email, password }) => {
  try {
    await checkmate.signIn(email, password);
  } catch (err) {
    return { ok: false, message: err.message };
  }
  if (loginWin && !loginWin.isDestroyed()) loginWin.close();
  await refresh();
  pushSettings();
  say(summary({ title: '로그인 완료! 🎉', tone: 'happy' }), 14);
  startRemote();
  return { ok: true };
});

async function logout() {
  await remote.stop();
  await checkmate.signOut();
  today = null;
  pushSettings();
  say({ title: '로그아웃했어', sub: '다시 로그인하면 또 알려줄게', tone: 'info', icon: '👋' }, 5);
}

// ---------- 설정 창 (캐릭터를 한 번 누르면 열림) ----------
async function settingsState() {
  const user = await checkmate.currentUser().catch(() => null);
  return {
    characters3d: CHARACTERS_3D,
    images: listCharacters(),
    current: currentCharacter(),
    remindBefore: remindBefore(),
    size: sizeScale(),
    autoStart: isAutoStart(),
    health: healthConfig(),
    timer: timerState(),
    place: placeConfig(),
    briefing: loadConfig().briefing !== false,
    rainAlert: loadConfig().rainAlert !== false,
    focusGuard: loadConfig().focusGuard !== false,
    focusMinutes: focusMinutes(),
    focusOptions: FOCUS_OPTIONS,
    connect: connectState(),
    school: schoolState(),
    ai: ai.status(aiConfig()),
    email: user ? user.email : null,
    growth: growth.view(loadConfig().growth),
  };
}

async function pushSettings() {
  if (!settingsWin || settingsWin.isDestroyed()) return;
  settingsWin.webContents.send('settings:update', await settingsState());
}

function closeSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.close();
}

function toggleSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    closeSettings();
    return;
  }
  // 열린 설정 창 밖(캐릭터)을 눌러서 방금 닫혔으면 다시 열지 않는다.
  if (Date.now() - settingsClosedAt < 400) return;

  // 캐릭터 옆, 화면 안쪽으로 연다.
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  SET_H = Math.min(720, area.height - 16);
  let x = b.x - SET_W + 30;
  if (x < area.x) x = b.x + b.width - 30;
  x = Math.min(Math.max(x, area.x), area.x + area.width - SET_W);
  const y = Math.min(Math.max(b.y + b.height - SET_H, area.y), area.y + area.height - SET_H);

  const w = (settingsWin = takePanel('settings'));
  w.setBounds({ x, y, width: SET_W, height: SET_H });
  // 다른 곳을 누르면 닫힌다.
  w.on('blur', closeSettings);
  w.on('closed', () => {
    if (settingsWin === w) settingsWin = null;
    settingsClosedAt = Date.now();
    refillPanelSoon('settings');
  });
  whenPanelLoaded(w, async () => {
    if (w.isDestroyed()) return;
    // 미리 만들어 둔 창이면 지금 상태로 다시 그리고 처음 화면(맨 위)으로
    w.webContents.send('settings:update', await settingsState());
    w.webContents.send('panel:reveal');
    if (!w.isDestroyed() && settingsWin === w) w.show();
  });
}

// ======================================================================
// 창 미리 만들어 두기: 설정·물어보기 창을 숨긴 채 하나씩 준비해 두면 누르자마자 뜬다.
// (예전엔 누를 때마다 새로 만들어서 0.3초쯤 걸렸고, 그동안 캐릭터가 버벅였다)
// ======================================================================
const PANELS = {
  settings: { file: 'settings.html', size: () => [SET_W, SET_H], level: 'screen-saver' },
  ask: { file: 'ask.html', size: () => [ASK_W, ASK_H], level: 'floating' },
};
const spare = { settings: null, ask: null };
let appQuitting = false;

function makePanel(kind) {
  const p = PANELS[kind];
  const [width, height] = p.size();
  const w = new BrowserWindow({
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  w.setAlwaysOnTop(true, p.level);
  w.loadFile(path.join(__dirname, 'renderer', p.file));
  return w;
}

// 준비된 창을 꺼내 쓰고(없으면 새로 만들고), 다 쓰면 다음 창을 미리 만든다
function takePanel(kind) {
  let w = spare[kind];
  spare[kind] = null;
  if (!w || w.isDestroyed()) w = makePanel(kind);
  return w;
}

function refillPanelSoon(kind, ms = 900) {
  setTimeout(() => {
    if (appQuitting || (spare[kind] && !spare[kind].isDestroyed())) return;
    spare[kind] = makePanel(kind);
  }, ms);
}

// 다 읽힌 뒤에 fn (미리 만든 창이면 바로)
function whenPanelLoaded(w, fn) {
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', fn);
  else fn();
}

ipcMain.handle('settings:get', () => settingsState());
ipcMain.on('settings:character', (_e, name) => chooseCharacter(name));
ipcMain.on('settings:accessory', (_e, id) => {
  const state = growth.normalize(loadConfig().growth);
  if (!growth.canWear(state, id)) return;
  saveConfig({ growth: { ...state, accessory: id || null } });
  sendCharacter();
  pushSettings();
});
ipcMain.on('settings:remind', (_e, min) => {
  if (![0, 5, 10, 30].includes(min)) return;
  saveConfig({ remindBefore: min });
  pushSettings();
});
ipcMain.on('settings:import', () => importCharacter().then(pushSettings));
ipcMain.on('settings:folder', () => shell.openPath(CHAR_DIR));
ipcMain.on('settings:remove-image', (_e, name) => removeCharacterImage(name));
ipcMain.on('settings:today', () => {
  closeSettings();
  say(summary(), 20);
});
ipcMain.on('settings:refresh', async () => {
  closeSettings();
  await refresh({ announce: true });
  say(summary(), 20);
});
ipcMain.on('settings:login', () => {
  closeSettings();
  openLogin();
});
ipcMain.on('settings:logout', () => logout());
ipcMain.on('settings:size', (_e, v) => setSize(Number(v)));
// 캐릭터 위에서 마우스 휠: 크기 조절
ipcMain.on('resize-by', (_e, step) => setSize(sizeScale() + (step > 0 ? 0.1 : -0.1)));
ipcMain.on('settings:autostart', (_e, on) => {
  setAutoStart(!!on);
  pushSettings();
});
ipcMain.on('settings:close', closeSettings);
ipcMain.handle('settings:place-search', async (_e, name) => {
  try {
    return { ok: true, list: await weather.searchPlace(String(name || '').slice(0, 30)) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.on('settings:place', (_e, p) => {
  if (!p || typeof p.lat !== 'number' || typeof p.lon !== 'number') return;
  saveConfig({ place: { name: String(p.name).slice(0, 30), admin: String(p.admin || '').slice(0, 30), lat: p.lat, lon: p.lon } });
  pushSettings();
});
ipcMain.on('settings:toggle', (_e, { key, on }) => {
  if (!['briefing', 'rainAlert', 'focusGuard'].includes(key)) return;
  saveConfig({ [key]: !!on });
  pushSettings();
});
ipcMain.on('settings:brief', () => {
  closeSettings();
  showBrief();
});
ipcMain.on('settings:quit', () => app.quit());
ipcMain.on('settings:health', (_e, { key, on }) => {
  if (!HEALTH[key]) return;
  saveConfig({ health: { ...healthConfig(), [key]: !!on } });
  healthLast[key] = Date.now();
  pushSettings();
});
ipcMain.on('settings:focus', () => {
  closeSettings();
  if (timer) stopTimer(true);
  else startTimer('focus', focusMinutes() * 60);
});
ipcMain.on('settings:focus-minutes', (_e, m) => {
  if (setFocusMinutes(m)) pushSettings();
});
ipcMain.on('settings:ask', () => {
  closeSettings();
  openAsk();
});

// ======================================================================
// 캐릭터 반응 보내기 (renderer 의 리액션 이름)
// ======================================================================
function react(name) {
  if (win && !win.isDestroyed()) win.webContents.send('react', name);
}

// ======================================================================
// 집중 타이머 / 일반 타이머 / 예약 알림
// ======================================================================
let timer = null; // { mode: 'focus' | 'break' | 'timer', total, endsAt }
// 집중 시간: 설정 창·우클릭 메뉴에서 고르는 칸 (말로는 5~180분 아무거나)
const FOCUS_OPTIONS = [15, 25, 30, 45, 60, 90];
function focusMinutes() {
  const m = Math.round(Number(loadConfig().focusMinutes));
  return m >= 5 && m <= 180 ? m : 25;
}
function setFocusMinutes(m) {
  m = Math.round(Number(m));
  if (!(m >= 5 && m <= 180)) return false;
  saveConfig({ focusMinutes: m });
  return true;
}
// 집중한 만큼 쉬기: 45분 미만 5분, 80분 미만 10분, 그 이상 15분
const breakMinutesFor = (sec) => (sec >= 80 * 60 ? 15 : sec >= 45 * 60 ? 10 : 5);
// 알람·예약 알림 (설정 파일에 저장해서 껐다 켜도 남아 있다)
// { id, at: ms, what, kind: 'alarm' | 'remind' }
function loadAlarms() {
  const list = loadConfig().alarms;
  return Array.isArray(list) ? list : [];
}

function saveAlarms(list) {
  saveConfig({ alarms: list.sort((a, b) => a.at - b.at) });
}

function addAlarm(at, what, kind) {
  const list = loadAlarms();
  const item = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at, what: what || '', kind };
  list.push(item);
  saveAlarms(list);
  return item;
}

// "오늘 오후 3시 30분" / "내일 오전 7시"
function whenText(ms) {
  const d = new Date(ms);
  const today = new Date();
  const dayDiff = Math.round((new Date(d).setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400000);
  const day = dayDiff === 0 ? '오늘' : dayDiff === 1 ? '내일' : dayDiff === 2 ? '모레' : `${d.getMonth() + 1}월 ${d.getDate()}일`;
  const h = d.getHours();
  const time = `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}시${d.getMinutes() ? ` ${d.getMinutes()}분` : ''}`;
  return `${day} ${time}`;
}

function ringAlarm(a) {
  const title =
    a.kind === 'alarm' ? (a.what ? `${a.what}!` : '알람 시간이야!') : a.what && a.what !== '말한 시간' ? `${a.what}!` : '말한 시간 됐어!';
  say(
    {
      title,
      sub: a.kind === 'alarm' ? whenText(a.at).replace(/^오늘 /, '') + ' 알람' : '아까 알려 달라고 했던 거야',
      tone: 'alert',
      icon: a.kind === 'alarm' ? '⏰' : '🔔',
      ring: a.kind === 'alarm' ? 'loud' : 'soft',
      actions: [
        { id: `snooze:${a.what || ''}`, label: '😴 5분 뒤' },
        { id: 'dismiss', label: '끄기' },
      ],
    },
    60,
  );
}

// 켤 때: 10분 안에 지나간 알람은 지금 울리고, 더 오래된 건 버린다
function checkMissedAlarms() {
  const now = Date.now();
  const list = loadAlarms();
  const keep = [];
  for (const a of list) {
    if (a.at > now) keep.push(a);
    else if (now - a.at < 10 * 60 * 1000) setTimeout(() => ringAlarm(a), 4000);
  }
  if (keep.length !== list.length) saveAlarms(keep);
}

// 할 일 추가 (말풍선 카드 · 물어보기 공용)
// "공부에 화학 복습"처럼 앞에 목표 이름을 붙이면 그 목표로 넣는다
function splitGoal(title) {
  const goals = (today && today.goals) || [];
  const m = String(title).match(/^(.+?)\s*(?:목표)?\s*(?:에|으로|로)\s+(.+)$/);
  if (m) {
    const key = m[1].replace(/\s+/g, '');
    const g = goals.find((x) => x.name.replace(/\s+/g, '') === key);
    if (g) return { goalId: g.id, title: m[2] };
  }
  return { goalId: null, title };
}

async function addTodoAndRefresh(title, goalId, dayOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  const row = await checkmate.addTodo(title, { goalId, date: checkmate.dateKey(d) });
  await refresh();
  return row;
}

ipcMain.handle('todo:add', async (_e, { title, goalId }) => {
  try {
    const row = await addTodoAndRefresh(title, goalId, 0);
    react('happy');
    return { ok: true, message: `추가했어! ✍️`, card: summary(), added: row.title };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

// 말풍선 카드에서 할 일 고치기 → 체크메이트에 바로 저장하고 새 카드를 돌려준다
ipcMain.handle('todo:action', (_e, req) => todoActionCore(req || {}));

async function todoActionCore({ id, op, title }) {
  try {
    if (typeof id !== 'string') throw new Error('잘못된 요청이야.');
    let msg = '';
    if (op === 'done') {
      await checkmate.setTodoDone(id, true);
      msg = '완료! 잘했어 👏';
    } else if (op === 'undone') {
      await checkmate.setTodoDone(id, false);
      msg = '완료를 취소했어';
    } else if (op === 'rename') {
      await checkmate.renameTodo(id, title);
      msg = '이름 바꿨어 ✏️';
    } else if (op === 'tomorrow') {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      await checkmate.moveTodo(id, checkmate.dateKey(d));
      msg = '내일로 미뤘어 ➡️';
    } else if (op === 'delete') {
      await checkmate.deleteTodo(id);
      msg = '지웠어 🗑️';
    } else throw new Error('모르는 동작이야.');
    await refresh();
    const card = summary();
    const allDone = card.kind === 'today' && card.todos.length > 0 && card.todos.every((t) => t.done);
    if (op === 'done') react(allDone ? 'dance' : 'happy');
    return { ok: true, message: allDone ? '오늘 할 일 전부 끝! 최고야 🎉' : msg, card };
  } catch (e) {
    return { ok: false, message: e.message };
  }
}

// ======================================================================
// 다른 AI 앱 연결 (MCP): Claude 데스크톱 → mcp/aibiseo-mcp.js → lib/bridge.js → 여기
// 무엇을 하든 캐릭터 말풍선으로도 보여 줘서, 다른 AI 가 뭘 했는지 사용자가 바로 알 수 있게 한다.
// ======================================================================
const bridgeFile = () => path.join(app.getPath('userData'), 'bridge.json');
const clip = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

// 'today' | 'tomorrow' | 'YYYY-MM-DD' → 체크메이트 날짜 키
function dayKeyFrom(v) {
  const s = clip(v, 20).toLowerCase();
  const d = new Date();
  if (!s || s === 'today' || s === '오늘') return checkmate.dateKey(d);
  if (s === 'tomorrow' || s === '내일') return checkmate.dateKey(new Date(d.setDate(d.getDate() + 1)));
  if (s === 'day_after' || s === '모레') return checkmate.dateKey(new Date(d.setDate(d.getDate() + 2)));
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m && !isNaN(new Date(`${s}T00:00:00`))) return s;
  throw new Error(`date must be 'today', 'tomorrow' or YYYY-MM-DD (got "${v}")`);
}

// "HH:MM" (다음에 오는 그 시각) / "YYYY-MM-DD HH:MM" → ms
function reminderTime(args) {
  if (args.in_minutes != null) {
    const n = Math.round(Number(args.in_minutes));
    if (!(n >= 1 && n <= 7 * 24 * 60)) throw new Error('in_minutes must be 1..10080');
    return Date.now() + n * 60000;
  }
  const s = clip(args.at, 30);
  let m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const d = new Date();
    d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/);
  if (m) {
    const at = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5])).getTime();
    if (!(at > Date.now())) throw new Error('that time has already passed');
    if (at - Date.now() > 366 * 86400000) throw new Error('too far in the future');
    return at;
  }
  throw new Error('give in_minutes, or at as "HH:MM" or "YYYY-MM-DD HH:MM"');
}

async function bridgeTool(name, args, client) {
  const from = `${client}에서 부탁했어`;
  switch (name) {
    case 'get_today': {
      await refresh();
      const user = await checkmate.currentUser().catch(() => null);
      const lv = growth.view(loadConfig().growth);
      const t = timerState();
      return {
        now: new Date().toLocaleString('ko-KR', { dateStyle: 'full', timeStyle: 'short' }),
        checkmate: !user ? 'not logged in — ask the user to log in from the assistant settings' : today ? 'ok' : `error: ${lastError || 'unknown'}`,
        events: today ? today.events.map((e) => ({ title: e.title, start: e.start, end: e.end })) : [],
        todos: today ? today.todos.map((x) => ({ id: x.id, title: x.title, done: x.done, goal: x.goal || null, remind_at: x.remindAt ? hhmm(x.remindAt) : null })) : [],
        goals: today ? (today.goals || []).map((g) => g.name) : [],
        d_days: today ? (today.dDays || []).map((d) => ({ title: d.title, date: d.date, days_left: d.days })) : [],
        timer: t ? { mode: t.mode, minutes_left: Math.ceil(t.left / 60), total_minutes: Math.round(t.total / 60) } : null,
        reminders: loadAlarms()
          .filter((a) => a.at > Date.now())
          .map((a) => ({ id: a.id, kind: a.kind, what: a.what, when: whenText(a.at) })),
        default_focus_minutes: focusMinutes(),
        character: { level: lv.level, xp: lv.xp },
        school: await schoolToday().catch((e) => ({ error: e.message })),
        study_this_week: (() => {
          const wk = studylog.weekReport(loadConfig().focusLog);
          return { minutes: wk.total, last_week_minutes: wk.lastTotal, sessions: wk.sessions, by_goal: wk.byGoal.slice(0, 6), streak_days: wk.streak };
        })(),
      };
    }
    case 'add_todo': {
      const title = clip(args.title, 100);
      if (!title) throw new Error('title is empty');
      if (!(await checkmate.currentUser().catch(() => null))) throw new Error('체크메이트에 로그인되어 있지 않아요. 사용자가 비서 설정에서 로그인해야 해요.');
      const date = dayKeyFrom(args.date);
      if (!today) await refresh();
      const goals = (today && today.goals) || [];
      const key = clip(args.goal, 40).replace(/\s+/g, '');
      const goal = key ? goals.find((g) => g.name.replace(/\s+/g, '') === key) : null;
      if (key && !goal) throw new Error(`goal "${args.goal}" not found. goals: ${goals.map((g) => g.name).join(', ')}`);
      const row = await checkmate.addTodo(title, { goalId: goal ? goal.id : null, date });
      await refresh();
      react('happy');
      const day = row.date === checkmate.dateKey() ? '오늘' : row.date;
      say({ title: `할 일 추가: ${row.title}`, sub: `${day} · ${row.goal} · ${from}`, tone: 'happy', icon: '✅' }, 8);
      return { added: { id: row.id, title: row.title, date: row.date, goal: row.goal } };
    }
    case 'update_todo': {
      const op = clip(args.action, 10);
      if (!['done', 'undone', 'rename', 'tomorrow', 'delete'].includes(op)) throw new Error('unknown action');
      if (op === 'rename' && !clip(args.title, 100)) throw new Error('title is required for rename');
      const r = await todoActionCore({ id: clip(args.id, 64), op, title: clip(args.title, 100) });
      if (!r.ok) throw new Error(r.message);
      say({ title: r.message, sub: from, tone: 'happy', icon: '✅' }, 6);
      return { ok: true, message: r.message };
    }
    case 'start_focus': {
      const m = args.minutes == null ? focusMinutes() : Math.round(Number(args.minutes));
      if (!(m >= 1 && m <= 180)) throw new Error('minutes must be 1..180');
      let todo = null;
      if (args.todo_id) {
        if (!today) await refresh();
        const t = today && today.todos.find((x) => x.id === clip(args.todo_id, 64));
        if (!t) throw new Error('no to-do with that id today (call get_today)');
        todo = { id: t.id, title: t.title, goal: t.goal || null };
      }
      startTimer('focus', m * 60, { todo });
      return { started: 'focus', minutes: m, todo: todo ? todo.title : null, break_minutes_after: breakMinutesFor(m * 60) };
    }
    case 'start_timer': {
      const m = Math.round(Number(args.minutes));
      if (!(m >= 1 && m <= 600)) throw new Error('minutes must be 1..600');
      startTimer('timer', m * 60);
      return { started: 'timer', minutes: m };
    }
    case 'stop_timer':
      return { stopped: stopTimer(true) };
    case 'add_reminder': {
      const what = clip(args.what, 80);
      if (!what) throw new Error('what is empty');
      const at = reminderTime(args);
      const item = addAlarm(at, what, args.alarm ? 'alarm' : 'remind');
      react('nod');
      say({ title: `${whenText(at)}에 알려줄게 ${args.alarm ? '⏰' : '🔔'}`, sub: `"${what}" · ${from}`, tone: 'info', icon: '🔔' }, 8);
      return { id: item.id, when: whenText(at), kind: item.kind, note: 'The assistant must be running at that time to ring.' };
    }
    case 'cancel_reminder': {
      const id = clip(args.id, 40);
      const list = loadAlarms();
      const hit = list.find((a) => a.id === id);
      if (!hit) throw new Error('no reminder with that id');
      saveAlarms(list.filter((a) => a.id !== id));
      say({ title: '알림 하나 지웠어', sub: `${whenText(hit.at)} "${hit.what}" · ${from}`, tone: 'info', icon: '🗑️' }, 6);
      return { cancelled: { id, when: whenText(hit.at), what: hit.what } };
    }
    case 'show_message': {
      const title = clip(args.title, 60);
      if (!title) throw new Error('title is empty');
      const detail = clip(args.detail, 300);
      say({ title, sub: detail ? `${detail}\n— ${client}` : `— ${client}`, tone: 'info', icon: '💬' }, 15);
      return { shown: true };
    }
    default:
      throw new Error(`unknown tool: ${name}`);
  }
}

let bridgeServer = null;
function startBridge() {
  bridgeServer = bridge.start({ file: bridgeFile(), handle: bridgeTool, log: (m) => log(m) });
}

function connectState() {
  const r = { remote: remote.status().state, remoteError: remote.status().error, remoteOn: loadConfig().remote !== false, remoteUrl: REMOTE_URL };
  try {
    const s = connect.status(__dirname);
    return { ...r, claude: s.state, claudeInstalled: s.installed };
  } catch (e) {
    return { ...r, claude: 'error', claudeInstalled: true, error: e.message };
  }
}

// ======================================================================
// 원격 연결: ChatGPT·Claude 웹/폰 → Vercel 서버 → 실시간 채널 → 여기 (lib/remote.js)
// ======================================================================
function remoteHandle(name, args, client) {
  if (name === 'refresh') return refresh().then(() => ({ refreshed: true }));
  return bridgeTool(name, args, client);
}

function startRemote() {
  if (process.env.AI_SELFTEST) return; // 자동 테스트는 따로 시험한다
  if (loadConfig().remote === false) return remote.stop();
  remote.start({ handle: remoteHandle, onChange: (st) => (log(`원격 연결 ${st.state}${st.error ? ' ' + st.error : ''}`), pushSettings()) }).catch((e) => log('원격 연결 실패', e.message));
}

ipcMain.handle('remote:set', async (_e, on) => {
  saveConfig({ remote: !!on });
  if (on) startRemote();
  else await remote.stop();
  pushSettings();
  return { ok: true };
});

ipcMain.on('remote:copy', () => {
  require('electron').clipboard.writeText(REMOTE_URL);
});

ipcMain.handle('remote:reset', async () => {
  try {
    await remote.resetChannel();
    startRemote();
    return { ok: true, message: '새 채널로 바꿨어. 예전 연결은 이제 PC에 부탁할 수 없어' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.handle('connect:claude', (_e, action) => {
  try {
    if (action === 'remove') {
      connect.remove();
      pushSettings();
      return { ok: true, message: 'Claude 앱 연결을 뺐어. Claude 앱을 껐다 켜면 사라져.' };
    }
    connect.install(__dirname);
    log('Claude 앱 연결 등록');
    pushSettings();
    say({ title: 'Claude 앱에 연결했어! 🔌', sub: 'Claude 앱을 완전히 껐다 켜면(트레이에서 종료) 나한테 일을 시킬 수 있어', tone: 'happy', icon: '🔌' }, 14);
    return { ok: true, message: 'Claude 앱을 완전히 껐다 켜 줘.' };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.on('card-action', (_e, id) => {
  if (typeof id !== 'string') return;
  if (id === 'guard:back') react('happy');
  if (id === 'guard:pause') {
    guard.pausedUntil = Date.now() + 5 * 60 * 1000;
    say({ title: '딱 5분만이야! ⏳', sub: '5분 뒤에 다시 지켜볼게', tone: 'info', icon: '☕' }, 5);
  }
  if (id.startsWith('snooze:')) {
    addAlarm(Date.now() + 5 * 60 * 1000, id.slice(7), 'alarm');
    say({ title: '5분 뒤에 다시 깨울게', tone: 'info', icon: '😴' }, 4);
  }
  // 집중 시작할 때 고른 할 일
  if (id.startsWith('ftodo:') && timer && timer.mode === 'focus') {
    const t = today && today.todos.find((x) => x.id === id.slice(6));
    if (t) {
      timer.todo = { id: t.id, title: t.title, goal: t.goal || null };
      say({ title: `좋아, "${t.title}" 집중! 🔥`, sub: t.goal ? `${t.goal} 시간으로 모아 둘게` : '옆에서 응원할게', tone: 'happy', icon: '🔥' }, 4);
    } else say({ title: '좋아, 집중 시작! 🔥', tone: 'happy', icon: '🔥' }, 3);
  }
  // 집중 끝나고 "끝냈어"
  if (id.startsWith('fdone:')) {
    todoActionCore({ id: id.slice(6), op: 'done' }).then((r) =>
      say({ title: r.ok ? r.message : '체크를 못 했어 😢', sub: r.ok ? '체크메이트에도 완료로 표시했어' : r.message, tone: r.ok ? 'happy' : 'sad', icon: r.ok ? '✅' : '😢' }, 6),
    );
  }
});

// 집중 기록 남기기 (끝까지 했으면 full)
function logFocus(t, full) {
  const min = full ? t.total / 60 : (Date.now() - (t.startedAt || Date.now())) / 60000;
  if (min < studylog.MIN_MINUTES) return;
  const entry = { at: t.startedAt || Date.now() - min * 60000, min, todo: t.todo ? t.todo.title : null, goal: t.todo ? t.todo.goal : null, dz: t.distractions || 0, full };
  saveConfig({ focusLog: studylog.add(loadConfig().focusLog, entry) });
}

// 주간 리포트 카드
function studyCard(last = false) {
  const now = new Date();
  if (last) now.setDate(now.getDate() - 7);
  const r = studylog.weekReport(loadConfig().focusLog, now);
  const diff = r.total - r.lastTotal;
  return {
    kind: 'report',
    title: last ? '지난주 집중 기록' : '이번 주 집중 기록',
    total: r.total,
    totalText: studylog.hm(r.total),
    compare: r.lastTotal ? `${last ? '그 전 주' : '지난주'}보다 ${diff >= 0 ? '+' : '-'}${studylog.hm(Math.abs(diff))}` : '',
    up: diff >= 0,
    byDay: r.byDay,
    todayIndex: last ? -1 : (now.getDay() + 6) % 7,
    byGoal: r.byGoal.slice(0, 4).map((g) => ({ name: g.name, text: studylog.hm(g.min), ratio: r.total ? g.min / r.total : 0 })),
    foot: [
      `집중 ${r.sessions}번${r.full ? ` (끝까지 ${r.full}번)` : ''}`,
      r.streak > 1 ? `🔥 ${r.streak}일 연속` : '',
      r.distractions || r.lastDistractions ? `딴짓 ${r.distractions}번${r.lastDistractions ? ` (지난주 ${r.lastDistractions})` : ''}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    tone: 'happy',
    icon: '📊',
    _r: r,
  };
}

function timerState() {
  if (!timer) return null;
  return { mode: timer.mode, total: timer.total, left: Math.max(0, Math.round((timer.endsAt - Date.now()) / 1000)) };
}

function sendTimer() {
  if (win && !win.isDestroyed()) win.webContents.send('timer', timerState());
}

function startTimer(mode, seconds, opts = {}) {
  if (timer && timer.mode === 'focus') logFocus(timer, false); // 하던 집중을 바꾸면 거기까지 남긴다
  timer = { mode, total: seconds, endsAt: Date.now() + seconds * 1000, startedAt: Date.now(), todo: opts.todo || null };
  sendTimer();
  pushSettings();
  const dur = intent.formatDuration(seconds);
  if (mode === 'focus') {
    // 오늘 남은 할 일이 있으면 "뭐 할 거야?" → 고른 할 일로 집중 시간을 기록한다
    const left = today && !opts.todo ? today.todos.filter((t) => !t.done).slice(0, 3) : [];
    if (left.length) {
      say(
        {
          title: `${dur} 집중 시작! 뭐 할 거야?`,
          sub: '고르면 그 할 일로 공부 시간을 모아 둘게',
          tone: 'happy',
          icon: '🔥',
          react: 'cheer',
          actions: [...left.map((t) => ({ id: `ftodo:${t.id}`, label: t.title.length > 12 ? t.title.slice(0, 12) + '…' : t.title })), { id: 'ftodo:none', label: '그냥 집중' }],
        },
        12,
      );
    } else {
      say({ title: `${dur} 집중 시작!`, sub: opts.todo ? `"${opts.todo.title}" 하는 거지? 옆에서 응원할게` : '옆에서 조용히 응원할게', tone: 'happy', icon: '🔥', react: 'cheer' }, 5);
    }
  } else if (mode === 'timer') {
    say({ title: `${dur} 타이머 시작!`, sub: '끝나면 알려줄게', tone: 'info', icon: '⏱️' }, 4);
  }
}

function stopTimer(announce) {
  const had = !!timer;
  if (timer && timer.mode === 'focus') logFocus(timer, false); // 중간에 멈춰도 한 만큼은 남긴다
  timer = null;
  sendTimer();
  pushSettings();
  if (announce && had) say({ title: '타이머를 멈췄어', tone: 'info', icon: '⏹️' }, 4);
  return had;
}

function tickTimer() {
  const now = Date.now();
  if (timer && now >= timer.endsAt) {
    const done = timer;
    timer = null;
    if (done.mode === 'focus') {
      setTimeout(() => grow([['focus', String(done.endsAt)]]), 1500);
      logFocus(done, true);
      const breakMin = breakMinutesFor(done.total);
      const dz = done.distractions || 0;
      const week = studylog.weekReport(loadConfig().focusLog);
      say(
        {
          title: done.todo ? `집중 끝! "${done.todo.title}" 끝냈어?` : dz ? '집중 끝! 수고했어 🎉' : '집중 끝! 딴짓 없이 완벽했어 🎉',
          sub: `${dz ? `딴짓 ${dz}번 · ` : ''}${breakMin}분 쉬자 · 이번 주 ${studylog.hm(week.total)} 집중했어`,
          tone: 'happy',
          icon: '🍅',
          react: 'dance',
          actions: done.todo
            ? [
                { id: `fdone:${done.todo.id}`, label: '✅ 끝냈어' },
                { id: 'dismiss', label: '아직' },
              ]
            : undefined,
        },
        15,
      );
      timer = { mode: 'break', total: breakMin * 60, endsAt: now + breakMin * 60 * 1000 };
    } else if (done.mode === 'break') {
      say({ title: '쉬는 시간 끝!', sub: `다시 집중해 볼까? "집중 시작"이라고 하면 ${focusMinutes()}분`, tone: 'alert', icon: '🔥' }, 15);
    } else {
      say({ title: `${intent.formatDuration(done.total)} 지났어!`, sub: '타이머 끝 ⏰', tone: 'alert', icon: '⏰' }, 20);
    }
    pushSettings();
  }
  sendTimer();

  const list = loadAlarms();
  const due = list.filter((a) => now >= a.at);
  if (due.length) {
    saveAlarms(list.filter((a) => now < a.at));
    due.forEach((a, i) => setTimeout(() => ringAlarm(a), i * 1500));
  }
}

// ======================================================================
// 건강 알림 (물 · 스트레칭 · 눈 쉬기)
// ======================================================================
const HEALTH = {
  water: { every: 60, card: { title: '물 한 잔 마실 시간!', sub: '한 시간 동안 수고했어', icon: '💧', react: 'hop' } },
  stretch: { every: 50, card: { title: '기지개 쭉~ 펴자!', sub: '목이랑 어깨도 살살 돌려 줘', icon: '🙆', react: 'stretch' } },
  eyes: { every: 20, card: { title: '눈 쉬는 시간', sub: '20초 동안 멀리 있는 걸 바라봐', icon: '👀', react: 'lookAround' } },
};
const healthLast = {};

function healthConfig() {
  const h = loadConfig().health || {};
  return { water: h.water ?? true, stretch: h.stretch ?? true, eyes: h.eyes ?? false };
}

function tickHealth() {
  const now = Date.now();
  // 5분 넘게 컴퓨터를 안 쓰고 있었으면 (자리 비움) 처음부터 다시 센다
  const idle = powerMonitor.getSystemIdleTime();
  const cfg = healthConfig();
  for (const [key, h] of Object.entries(HEALTH)) {
    if (!healthLast[key] || idle > 300) healthLast[key] = now;
    if (!cfg[key]) continue;
    if (timer && timer.mode === 'focus') continue; // 집중하는 동안은 방해하지 않기
    if (now - healthLast[key] >= h.every * 60 * 1000) {
      healthLast[key] = now;
      say({ tone: 'info', ...h.card }, 15);
    }
  }
}

// ======================================================================
// 물어보기 창
// ======================================================================
let askWin = null;
let askClosedAt = 0;
// 물어보기 창 크기: 보통 / 크게 (머리의 ⤢ 버튼으로 바꾸고, 고른 크기를 기억한다)
const ASK_SIZES = { normal: [400, 560], big: [600, 820] };
const ASK_W = ASK_SIZES.normal[0];
const ASK_H = ASK_SIZES.normal[1];
const ASK_MIN = [320, 380];
// 저장된 크기: 가장자리를 끌어서 정한 크기(askSize) > 크게/보통 버튼(askBig)
function askSaved() {
  const c = loadConfig();
  const z = c.askSize;
  if (Array.isArray(z) && z.length === 2 && z.every((n) => Number.isFinite(n) && n > 0)) return z;
  return ASK_SIZES[c.askBig === true ? 'big' : 'normal'];
}
const askIsBig = () => askSaved()[0] >= 560;

function askSize(area, size = askSaved()) {
  const clamp = (v, lo, hi) => Math.round(Math.min(Math.max(v, lo), hi));
  return [clamp(size[0], ASK_MIN[0], area.width - 16), clamp(size[1], ASK_MIN[1], area.height - 16)];
}

// 열려 있는 물어보기 창 크기 바꾸기 (⤢ 버튼): 오른쪽 아래 모서리는 그대로 두고 왼쪽 위로 늘리거나 줄인다
function resizeAsk(big) {
  const preset = ASK_SIZES[big ? 'big' : 'normal'];
  saveConfig({ askBig: !!big, askSize: preset });
  if (!askWin || askWin.isDestroyed()) return;
  const b = askWin.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const [width, height] = askSize(area, preset);
  let x = b.x + b.width - width;
  let y = b.y + b.height - height;
  x = Math.min(Math.max(x, area.x), area.x + area.width - width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - height);
  askWin.setBounds({ x, y, width, height }, false);
}

// 가장자리·모서리를 끌어서 크기 바꾸기 (투명 창은 윈도우가 직접 크기 조절을 못 해서 화면 쪽 손잡이로 한다)
let askDrag = null;
function dragAskSize({ phase, edge, dx = 0, dy = 0 } = {}) {
  if (!askWin || askWin.isDestroyed()) return null;
  if (phase === 'start') {
    const b = askWin.getBounds();
    askDrag = { b, edge: String(edge || ''), area: screen.getDisplayMatching(b).workArea };
    return null;
  }
  if (!askDrag) return null;
  const { b, edge: e, area } = askDrag;
  let { x, y, width, height } = b;
  const right = b.x + b.width;
  const bottom = b.y + b.height;
  if (e.includes('l')) {
    width = Math.min(Math.max(b.width - dx, ASK_MIN[0]), right - area.x);
    x = right - width;
  }
  if (e.includes('r')) width = Math.min(Math.max(b.width + dx, ASK_MIN[0]), area.x + area.width - b.x);
  if (e.includes('t')) {
    height = Math.min(Math.max(b.height - dy, ASK_MIN[1]), bottom - area.y);
    y = bottom - height;
  }
  if (e.includes('b')) height = Math.min(Math.max(b.height + dy, ASK_MIN[1]), area.y + area.height - b.y);
  const nb = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  askWin.setBounds(nb, false);
  if (phase === 'end') {
    askDrag = null;
    saveConfig({ askSize: [nb.width, nb.height], askBig: nb.width >= 560 });
  }
  return { big: nb.width >= 560 };
}

function openAsk() {
  if (!askWin || askWin.isDestroyed() || !askWin.isFocused()) rememberForeground();
  if (askWin && !askWin.isDestroyed()) {
    askWin.show();
    askWin.focus();
    askWin.webContents.send('ask:focus');
    return;
  }
  voice.start(); // 음성 입력 준비를 미리 해 둔다
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const [aw, h] = askSize(area);
  let x = b.x - aw + 30;
  if (x < area.x) x = b.x + b.width - 30;
  x = Math.min(Math.max(x, area.x), area.x + area.width - aw);
  const y = Math.min(Math.max(b.y + b.height - h, area.y), area.y + area.height - h);
  const w = (askWin = takePanel('ask'));
  w.setBounds({ x, y, width: aw, height: h });
  whenPanelLoaded(w, () => {
    if (w.isDestroyed() || askWin !== w) return;
    w.webContents.send('panel:reveal');
    w.show();
    w.focus();
    w.webContents.send('ask:focus');
  });
  if (process.env.AI_SELFTEST) {
    askWin.on('close', () => console.log('ASKWIN close', new Error().stack.split(/\n/).slice(1, 6).join(' | ')));
    askWin.webContents.on('render-process-gone', (_e, d) => console.log('ASKWIN renderer gone', JSON.stringify(d)));
    askWin.webContents.on('console-message', (e) => { const m = e.message || ''; if (/error/i.test(m)) console.log('ASKWIN console', m); });
  }
  askWin.on('closed', () => {
    if (askWin === w) askWin = null;
    refillPanelSoon('ask');
    askClosedAt = Date.now();
    askHistory.length = 0;
    lastShot = null; // 창을 닫으면 찍은 화면도 잊는다
  });
}

// 빠른 메뉴 → 📸: 물어보기 창을 열고 화면 질문을 바로 보낸다
function askScreenFromMenu(req = {}) {
  const run = () => askWin && !askWin.isDestroyed() && askWin.webContents.send('ask:run-screen', req);
  if (askWin && !askWin.isDestroyed()) {
    openAsk();
    run();
  } else {
    openAsk();
    whenPanelLoaded(askWin, () => setTimeout(run, 200));
  }
}

function closeAsk() {
  if (askWin && !askWin.isDestroyed()) askWin.close();
}

function toggleAsk() {
  if (askWin && !askWin.isDestroyed() && askWin.isFocused()) closeAsk();
  else openAsk();
}

function timeText(d = new Date()) {
  const h = d.getHours();
  const ampm = h < 12 ? '오전' : '오후';
  const hh = h % 12 || 12;
  return `${ampm} ${hh}시 ${d.getMinutes()}분`;
}

const ENGINE_NAME = { naver: '네이버', google: '구글', youtube: '유튜브' };
const SEARCH_BUTTONS = (q) => [
  { label: '네이버', action: 'search', engine: 'naver', query: q },
  { label: '구글', action: 'search', engine: 'google', query: q },
  { label: '유튜브', action: 'search', engine: 'youtube', query: q },
];

function openSearch(engine, query) {
  shell.openExternal(intent.searchUrl(engine, query));
}

// ======================================================================
// 날씨 · 아침 브리핑 · 비 알림
// ======================================================================
function placeConfig() {
  const p = loadConfig().place;
  return p && typeof p.lat === 'number' ? p : weather.DEFAULT_PLACE;
}

async function weatherAnswer(when) {
  try {
    const w = await weather.get(placeConfig());
    if (when === 'tomorrow') {
      const d = w.tomorrow;
      return {
        text: `내일 ${w.place}은 ${d.emoji} ${d.desc}, ${d.min}° ~ ${d.max}°야.`,
        sub: d.rain >= 50 ? `비 올 확률 ${d.rain}%, 우산 챙겨 ☂️` : `비 올 확률 ${d.rain}%`,
      };
    }
    return {
      text: `지금 ${w.place}은 ${w.now.emoji} ${w.now.desc}, ${w.now.temp}°야. (체감 ${w.now.feels}°)`,
      sub: [`오늘 ${w.today.min}° ~ ${w.today.max}° · 비 ${w.today.rain}%`, w.dust ? `미세먼지 ${w.dust.label} ${w.dust.emoji}` : '', weather.advice(w)]
        .filter(Boolean)
        .join('\n'),
    };
  } catch (e) {
    return { text: '날씨를 못 불러왔어 😢', sub: e.message, buttons: SEARCH_BUTTONS(`${placeConfig().name} 날씨`) };
  }
}

function greeting(h = new Date().getHours()) {
  if (h < 5) return '아직 새벽이야… 🌙';
  if (h < 11) return '좋은 아침! ☀️';
  if (h < 14) return '점심은 먹었어? 🍚';
  if (h < 18) return '오후도 힘내자! 🌤️';
  if (h < 22) return '오늘 하루 어땠어? 🌆';
  return '늦었어, 슬슬 쉬자 🌙';
}

// 브리핑 카드 데이터 (renderer 의 renderBrief 가 그린다)
// ======================================================================
// 학교: 급식·시간표 (나이스 공개 API) — lib/school.js
// ======================================================================
const DAY_LABEL = { '-1': '어제', 0: '오늘', 1: '내일', 2: '모레' };

function schoolCfg() {
  const c = loadConfig().school;
  return c && typeof c === 'object' ? c : {};
}

function neisKey() {
  return keys.status('neis') === 'ok' ? keys.load('neis') : null;
}

function schoolState() {
  const c = schoolCfg();
  return {
    school: c.school || null,
    grade: c.grade || null,
    cls: c.cls || null,
    start: c.start || '08:40',
    classMin: c.classMin || 50,
    mealBrief: c.mealBrief !== false,
    classAlert: !!c.classAlert,
    hasKey: keys.status('neis') === 'ok',
    serverKey: school.fullTimetable(),
  };
}

function dayAfter(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
}

const MEAL_KO = { breakfast: '아침', lunch: '점심', dinner: '저녁' };

async function mealAnswer({ meal = 'all', dayOffset = 0 }) {
  const c = schoolCfg();
  if (!c.school) return { text: '학교를 먼저 알려 줘! 🏫', sub: '설정 → 학교에서 학교 이름으로 찾아서 골라 줘' };
  const day = DAY_LABEL[dayOffset] || '';
  let m;
  try {
    m = await school.meals(c.school, dayAfter(dayOffset), neisKey());
  } catch (e) {
    return { text: '급식을 못 불러왔어 😢', sub: e.message };
  }
  const has = Object.keys(m);
  if (!has.length) return { text: `${day}은 급식 정보가 없어`, sub: '주말·방학·재량휴업일일 수도 있어' };
  const line = (k) => `${m[k].dishes.join(', ')}${m[k].kcal ? ` (${Math.round(m[k].kcal)}kcal)` : ''}`;
  if (meal !== 'all') {
    if (!m[meal]) return { text: `${day} ${MEAL_KO[meal]}은 급식이 없어`, sub: `있는 급식: ${has.map((k) => MEAL_KO[k]).join(', ')}` };
    return { text: `${day} ${MEAL_KO[meal]} 🍚 ${line(meal)}`, sub: c.school.name };
  }
  const order = ['breakfast', 'lunch', 'dinner'].filter((k) => m[k]);
  return { text: `${day} 급식 🍚\n` + order.map((k) => `${MEAL_KO[k]}: ${line(k)}`).join('\n'), sub: c.school.name };
}

async function dayTimetable(offset = 0) {
  const c = schoolCfg();
  if (!c.school || !c.grade || !c.cls) return null;
  return school.timetable(c.school, c.grade, c.cls, dayAfter(offset), neisKey());
}

function bellOf() {
  const c = schoolCfg();
  return school.bellTimes({ start: c.start || '08:40', classMin: c.classMin || 50 }, 9);
}

async function timetableAnswer({ dayOffset = 0, period = null, next = false }) {
  const c = schoolCfg();
  if (!c.school) return { text: '학교를 먼저 알려 줘! 🏫', sub: '설정 → 학교에서 찾고 학년·반도 골라 줘' };
  if (!c.grade || !c.cls) return { text: '몇 학년 몇 반인지 알려 줘!', sub: '설정 → 학교에서 학년·반을 골라 줘' };
  const day = DAY_LABEL[dayOffset] || '';
  let rows;
  try {
    rows = await dayTimetable(dayOffset);
  } catch (e) {
    return { text: '시간표를 못 불러왔어 😢', sub: e.message };
  }
  if (!rows.length) return { text: `${day}은 시간표가 없어`, sub: '주말·방학·시험 기간이거나 학교가 나이스에 안 올렸을 수 있어' };
  const bell = bellOf();
  const at = (p) => {
    const b = bell.find((x) => x.period === p);
    return b ? school.hm(b.start) : '';
  };
  const last = Math.max(...rows.map((r) => r.period));
  // 과학고처럼 강의실(분반)로 올라오는 학교: 선택 과목은 그 시간에 열리는 수업을 모아서 보여 준다
  const mixNote = rows.elective ? '\n(선택 과목은 그 시간에 열리는 수업을 모아서 보여 줘)' : '';
  const cut = !neisKey() && !school.fullTimetable() && !rows.rooms && rows.length >= 5 ? '\n(6·7교시는 지금 못 받아 와서 5교시까지만 보여)' : '';
  if (period) {
    const r = rows.find((x) => x.period === period);
    if (r) return { text: `${day} ${period}교시는 ${r.subject}야 📚`, sub: at(period) ? `${at(period)} 시작` : '' };
    return { text: `${day} ${period}교시는 없어`, sub: cut.trim() };
  }
  if (next && dayOffset === 0) {
    const now = nowMinutes();
    const has = (p) => rows.some((r) => r.period === p);
    const subj = (p) => rows.find((r) => r.period === p).subject;
    const cur = bell.find((b) => b.start <= now && now < b.end && has(b.period));
    const nxt = bell.find((b) => b.start > now && has(b.period));
    if (cur && nxt) return { text: `지금은 ${cur.period}교시 ${subj(cur.period)}, 다음은 ${nxt.period}교시 ${subj(nxt.period)}야 📚`, sub: `${school.hm(nxt.start)} 시작` };
    if (nxt) return { text: `다음 수업은 ${nxt.period}교시 ${subj(nxt.period)}야 📚`, sub: `${school.hm(nxt.start)} 시작 · ${nxt.start - now}분 남았어` };
    if (cur) return { text: `지금 ${cur.period}교시 ${subj(cur.period)}가 마지막이야!`, sub: `${school.hm(cur.end)}에 끝나` };
    return { text: '오늘 수업은 다 끝났어! 🎉', sub: `오늘 ${last}교시까지 있었어` };
  }
  return {
    text: `${day} 시간표 📚 (${last}교시까지)\n` + rows.map((r) => `${r.period}교시 ${r.subject}`).join('\n') + cut + mixNote,
    sub: `${c.school.name} ${c.grade}학년 ${c.cls}반${rows.rooms ? ' (분반 기준)' : ''}`,
  };
}

// 브리핑용: 점심 메뉴 + 오늘 수업 (학교 정보가 있을 때만)
// 다른 AI 앱(MCP)용: 오늘 급식·시간표 그대로
async function schoolToday() {
  const c = schoolCfg();
  if (!c.school) return null;
  const [m, rows] = await Promise.all([school.meals(c.school, new Date(), neisKey()), dayTimetable(0)]);
  const bell = bellOf();
  return {
    name: c.school.name,
    grade: c.grade || null,
    class: c.cls || null,
    meals: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.dishes])),
    timetable: (rows || []).map((r) => {
      const b = bell.find((x) => x.period === r.period);
      return { period: r.period, subject: r.subject, start: b ? school.hm(b.start) : null };
    }),
    timetable_note: !neisKey() && !school.fullTimetable() && rows && rows.length >= 5 ? 'Only periods 1-5 could be loaded.' : undefined,
  };
}

async function schoolBrief() {
  const c = schoolCfg();
  if (!c.school) return null;
  const [m, rows] = await Promise.all([school.meals(c.school, new Date(), neisKey()).catch(() => ({})), dayTimetable(0).catch(() => null)]);
  const meal = m.lunch || m.dinner || m.breakfast;
  const which = m.lunch ? '점심' : m.dinner ? '저녁' : '아침';
  if (!meal && !(rows && rows.length)) return null;
  return {
    meal: meal ? { which, dishes: meal.dishes.slice(0, 5) } : null,
    classes: rows && rows.length ? rows.map((r) => r.subject) : null,
    // 같은 과목이 연달아 있으면 한 번만 (블록 수업·시험날)
    classesShort: rows && rows.length ? rows.map((r) => r.subject).filter((x, i, arr) => x !== arr[i - 1]) : null,
  };
}

// 수업 5분 전 알림 + 점심시간 메뉴 (평일, 켜 둔 경우만)
async function tickSchool() {
  const c = schoolCfg();
  if (!c.classAlert || !c.school || !c.grade || !c.cls || !win) return;
  const d = new Date();
  if (d.getDay() === 0 || d.getDay() === 6) return;
  if (timer && timer.mode === 'focus') return; // 집중하는 동안은 조용히
  let rows;
  try {
    rows = await dayTimetable(0);
  } catch {
    return;
  }
  if (!rows || !rows.length) return;
  const now = nowMinutes();
  const date = checkmate.dateKey(d);
  const bell = bellOf();
  for (const b of bell) {
    const r = rows.find((x) => x.period === b.period);
    if (!r) continue;
    if (b.start - now === 5) {
      notifyOnce(`${date}|class|${b.period}`, { title: `5분 뒤 ${b.period}교시 ${r.subject}!`, sub: `${school.hm(b.start)} 시작 · 준비물 챙겨`, icon: '📚', countdown: 5 });
    }
  }
  // 점심시간 시작(4교시 끝) 에 메뉴
  const fourth = bell.find((b) => b.period === 4);
  if (fourth && now === fourth.end && rows.length > 4) {
    const m = await school.meals(c.school, d, neisKey()).catch(() => ({}));
    if (m.lunch) notifyOnce(`${date}|lunch`, { title: '점심시간! 🍚', sub: m.lunch.dishes.slice(0, 5).join(', '), icon: '🍚', tone: 'happy' });
  }
}

ipcMain.handle('school:search', async (_e, name) => {
  try {
    return { ok: true, list: await school.search(String(name || '').slice(0, 30), neisKey()) };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});

ipcMain.on('school:set', (_e, patch) => {
  if (!patch || typeof patch !== 'object') return;
  const c = { ...schoolCfg() };
  if (patch.school !== undefined) {
    const s = patch.school;
    c.school =
      s && s.code && s.office
        ? { name: String(s.name).slice(0, 40), office: String(s.office).slice(0, 5), code: String(s.code).slice(0, 10), kind: String(s.kind || '').slice(0, 10) }
        : null;
  }
  if (patch.grade !== undefined) c.grade = Math.min(6, Math.max(1, parseInt(patch.grade, 10) || 1));
  if (patch.cls !== undefined) c.cls = Math.min(30, Math.max(1, parseInt(patch.cls, 10) || 1));
  if (patch.start !== undefined && /^\d{1,2}:\d{2}$/.test(patch.start)) c.start = patch.start;
  if (patch.classMin !== undefined && [40, 45, 50].includes(Number(patch.classMin))) c.classMin = Number(patch.classMin);
  if (patch.mealBrief !== undefined) c.mealBrief = !!patch.mealBrief;
  if (patch.classAlert !== undefined) c.classAlert = !!patch.classAlert;
  saveConfig({ school: c });
  pushSettings();
});

ipcMain.handle('school:key', async (_e, key) => {
  key = String(key || '').trim();
  if (!key) {
    keys.clear('neis');
    school._cache.clear();
    pushSettings();
    return { ok: true, message: '나이스 키를 지웠어' };
  }
  if (!/^[0-9a-z]{20,64}$/i.test(key)) return { ok: false, message: '나이스 키는 영어·숫자로 된 긴 글자야. 다시 확인해 줘' };
  try {
    await school.search('서울', key); // 진짜 되는 키인지 한 번 불러 본다
    keys.save('neis', key);
    school._cache.clear();
    pushSettings();
    return { ok: true, message: '저장했어! 이제 7교시까지 다 보여 📚' };
  } catch (e) {
    return { ok: false, message: `키가 안 맞는 것 같아: ${e.message}` };
  }
});

async function briefCard() {
  const d = new Date();
  const card = {
    kind: 'brief',
    title: greeting(d.getHours()),
    sub: `${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일`,
    tone: 'happy',
    icon: '☀️',
  };
  try {
    const w = await weather.get(placeConfig());
    card.weather = { ...w, advice: weather.advice(w) };
  } catch {
    card.weather = null;
  }
  if (!today) await refresh().catch(() => {});
  if (today) {
    const s0 = summary();
    card.events = s0.events.filter((e) => e.state !== 'past');
    card.todosLeft = s0.todos.filter((t) => !t.done).length;
    card.todosTotal = s0.todos.length;
    card.dDays = today.dDays || [];
  } else card.login = true;
  const end = new Date(d);
  end.setHours(23, 59, 59, 999);
  if (schoolCfg().mealBrief !== false) card.school = await schoolBrief().catch(() => null);
  {
    const wk = studylog.weekReport(loadConfig().focusLog);
    // 월요일 아침엔 지난주 기록, 그 밖엔 이번 주
    if (d.getDay() === 1 && wk.lastTotal) card.study = { text: `지난주 ${studylog.hm(wk.lastTotal)} 집중했어`, sub: '"주간 리포트"라고 하면 자세히 보여줄게' };
    else if (wk.total) card.study = { text: `이번 주 ${studylog.hm(wk.total)} 집중 중`, sub: wk.streak > 1 ? `🔥 ${wk.streak}일 연속` : '' };
  }
  card.alarms = loadAlarms()
    .filter((a) => a.at <= end.getTime())
    .map((a) => ({ when: whenText(a.at).replace(/^오늘 /, ''), what: a.what && a.what !== '말한 시간' ? a.what : '' }));
  return card;
}

async function showBrief() {
  say(await briefCard(), 30);
}

// 아침(5시~12시)에 처음 컴퓨터를 쓸 때 한 번
async function tickBrief() {
  const cfg = loadConfig();
  if (cfg.briefing === false || !win) return;
  const d = new Date();
  const key = checkmate.dateKey(d);
  if (cfg.lastBrief === key || d.getHours() < 5 || d.getHours() >= 12) return;
  if (powerMonitor.getSystemIdleTime() > 60) return; // 자리에 있을 때만
  saveConfig({ lastBrief: key });
  await showBrief();
}

// 두 시간 안에 비가 오면 하루 한 번 알려 준다
async function tickRain() {
  const cfg = loadConfig();
  if (cfg.rainAlert === false) return;
  const key = checkmate.dateKey();
  if (cfg.lastRainAlert === key) return;
  const h = new Date().getHours();
  if (h < 6 || h >= 22) return;
  try {
    const w = await weather.get(placeConfig());
    if (w.rainSoon && w.rainSoon.inHours <= 2) {
      saveConfig({ lastRainAlert: key });
      say(
        {
          title: w.rainSoon.inHours <= 0 ? '지금 비 올 것 같아!' : `${w.rainSoon.hour}시쯤 비 올 것 같아!`,
          sub: `비 올 확률 ${w.rainSoon.prob}% · 나갈 때 우산 챙겨`,
          tone: 'alert',
          icon: '☔',
          react: 'hop',
        },
        20,
      );
    }
  } catch {
    /* 날씨를 못 불러오면 조용히 넘어간다 */
  }
}

// ======================================================================
// 집중 지킴이: 집중 타이머 중에 딴짓 창을 열면 말린다
// ======================================================================
let guard = { since: 0, label: '', nagAt: 0, pausedUntil: 0 };

async function tickGuard() {
  if (!timer || timer.mode !== 'focus' || loadConfig().focusGuard === false) {
    guard.since = 0;
    return;
  }
  const now = Date.now();
  if (now < guard.pausedUntil) return;
  const d = winwatch.distraction(await winwatch.foreground());
  if (!d) {
    guard.since = 0;
    return;
  }
  if (!guard.since || guard.label !== d) {
    guard.since = now;
    guard.label = d;
    return;
  }
  // 6초 넘게 딴짓 중이고, 1분 반 안에 말린 적이 없으면
  if (now - guard.since < 6000 || now - guard.nagAt < 90 * 1000) return;
  guard.nagAt = now;
  timer.distractions = (timer.distractions || 0) + 1;
  const left = Math.ceil((timer.endsAt - now) / 60000);
  const lines = [`지금 집중 시간이야! ${d}는 이따가 🍅`, `${d} 보는 거 다 보여… 👀 ${left}분만 참자!`, `앗, ${d}! 조금만 더 집중해 보자 💪`];
  say(
    {
      react: 'glare',
      title: lines[(timer.distractions - 1) % lines.length],
      sub: `집중 ${left}분 남았어`,
      tone: 'alert',
      icon: '🙅',
      actions: [
        { id: 'guard:back', label: '돌아갈게!' },
        { id: 'guard:pause', label: '5분만 쉴래' },
      ],
    },
    15,
  );
}

// ---------- AI (제미나이 / Claude) ----------
function aiConfig() {
  const c = loadConfig().ai || {};
  return { provider: c.provider === 'claude' ? 'claude' : 'gemini', claudeModel: c.claudeModel };
}

function charName() {
  const cur = currentCharacter();
  const c = CHARACTERS_3D.find((x) => '3d:' + x.id === cur);
  return c ? c.name : '비서';
}

const askHistory = []; // { role: 'user' | 'model', text }

async function askAI(question) {
  const st = ai.status(aiConfig());
  if (!st.ready) return null;
  if (recentShot()) {
    const modeId = screenshot.detectMode(question);
    return askAboutShot(question, screenshot.MODES[modeId === 'auto' ? 'auto' : modeId], true, st);
  }
  try {
    react('nod');
    const r = await ai.ask(aiConfig(), question, askHistory, charName());
    askHistory.push({ role: 'user', text: question }, { role: 'model', text: r.text });
    if (askHistory.length > 16) askHistory.splice(0, askHistory.length - 16);
    react('happy');
    const who = st.provider === 'claude' ? 'Claude' : '제미나이';
    return {
      text: r.text,
      sub: `${who}가 도와줬어`,
      buttons: (r.sources || []).map((src) => ({ label: src.title, action: 'link', url: src.url })),
      ai: true,
    };
  } catch (e) {
    return { text: e.message === 'NO_KEY' ? 'AI 키가 없어. 설정 → AI 연결에서 넣어 줘.' : e.message, buttons: SEARCH_BUTTONS(question) };
  }
}

// ---------- 화면 봐 주기 ----------
// 물어볼 때만 찍는다 (전체 화면 · 지금 창 · 직접 고른 영역). 찍는 동안 비서 창은 숨긴다.
// 사진은 파일로 저장하지 않고 고른 AI 에게만 보낸다. 이어지는 질문을 위해 3분 동안만 메모리에 둔다.
const SHOT_KEEP_MS = 3 * 60 * 1000;
let lastShot = null; // { native, sent, info, at }
let lastForeground = null; // 물어보기 창을 열기 직전의 맨 앞 창 (지금 창 찍기용)

function rememberForeground() {
  const ours = new Set(BrowserWindow.getAllWindows().map((w) => w.getTitle()));
  winwatch
    .foregroundSoon()
    .then((fg) => {
      if (fg && fg.title && !ours.has(fg.title)) lastForeground = fg;
    })
    .catch(() => {});
}

// req: 글자(질문) 또는 { text, mode, kind }
async function screenAnswer(req) {
  if (typeof req === 'string') req = { text: req };
  const text = String((req && req.text) || '').trim().slice(0, 300);
  const modeId = screenshot.MODES[req && req.mode] ? req.mode : text ? screenshot.detectMode(text) : 'auto';
  const kind = ['full', 'window', 'region'].includes(req && req.kind) ? req.kind : text ? screenshot.detectKind(text) : 'full';
  const mode = screenshot.MODES[modeId];
  const question = text || mode.ask;
  const st = ai.status(aiConfig());
  if (!st.ready) {
    return {
      text: '화면 봐 주기는 AI 연결이 있어야 해 🙈',
      sub: '설정 → AI 연결에서 Claude 나 제미나이 키를 넣으면 화면을 보고 대답할 수 있어',
    };
  }
  let shot;
  try {
    react('lookAround');
    shot = await screenshot.capture(kind, { preload: path.join(__dirname, 'preload.js'), lastForeground });
  } catch (e) {
    return { text: '화면을 못 찍었어 😢', sub: IS_MAC ? '맥은 시스템 설정 → 개인정보 보호 → 화면 기록에서 허락해 줘' : e.message };
  }
  if (!shot) return { text: '영역 고르기를 취소했어.', sub: '다시 하려면 📸 → ✂️ 영역' };
  const sent = screenshot.fitForAI(shot.native);
  const info = screenshot.describeShot(shot, sent);
  lastShot = { native: shot.native, sent, info, at: Date.now() };
  return askAboutShot(question, mode, false, st);
}

async function askAboutShot(question, mode, followUp, st = ai.status(aiConfig())) {
  const s = lastShot;
  try {
    react('nod');
    const isTodo = mode === screenshot.MODES.todo;
    // 📌 할 일로: json 블록을 질문 바로 뒤에서 한 번 더 부탁한다 (기본 안내의 '마크다운 쓰지 마'보다 앞서게)
    const JSON_ASK = '(이번 대답은 예외로, 맨 끝에 ```json 코드 블록 {"items":[{"title","due","time","note"}]} 을 꼭 붙여 줘)';
    const asked = isTodo ? `${question}\n\n${JSON_ASK}` : question;
    const r = await ai.ask(aiConfig(), asked, askHistory, charName(), {
      image: s.sent,
      zoom: screenshot.zoomer(s.native, s.sent),
      mode,
      info: s.info,
      followUp,
    });
    s.at = Date.now();
    askHistory.push({ role: 'user', text: `(화면 사진을 보여 주며 · ${mode.label}) ${question}` }, { role: 'model', text: r.text });
    if (askHistory.length > 16) askHistory.splice(0, askHistory.length - 16);
    react('happy');
    const who = st.provider === 'claude' ? 'Claude' : '제미나이';
    const how = { '전체 화면': '🖥️', '맨 앞 창만': '🪟', '사용자가 직접 고른 영역': '✂️' };
    const icon = Object.entries(how).find(([k]) => s.info.includes(k));
    const zoomNote = r.zooms ? ` · 🔎 ${r.zooms}번 확대해서 봤어` : '';
    // 📌 할 일로: 대답 끝의 json 에서 할 일 목록을 꺼내 확인 칸으로 보여 준다
    let todos;
    if (isTodo) {
      let ex = screenshot.extractTodos(r.text);
      if (!ex.items) {
        // 그래도 json 이 없으면 대답 글을 짧게 한 번 더 바꿔 달라고 한다 (사진 없이, 글만)
        const today = checkmate.dateKey();
        const convAsk = [
          `오늘은 ${today}야. 아래 글에 나온 할 일을 json 하나로만 바꿔 줘. 다른 말은 쓰지 마.`,
          '모양: {"items":[{"title":"25자 이내, 과목명을 앞에","due":"YYYY-MM-DD 또는 null","time":"HH:MM 또는 null","note":"아주 짧게"}]}',
          '',
          '글:',
          r.text,
        ].join('\n');
        const conv = await ai.ask(aiConfig(), convAsk, [], charName(), null).catch(() => null);
        const ex2 = conv ? screenshot.extractTodos(conv.text) : { items: null };
        if (ex2.items) ex = { text: ex.text, items: ex2.items };
      }
      r.text = ex.text || (ex.items && ex.items.length ? '이렇게 찾았어!' : '해야 할 일을 못 찾았어.');
      todos = ex.items || [];
    }
    return {
      todos,
      text: r.text,
      sub: `${icon ? icon[1] : '📸'} ${followUp ? '같은 화면으로 이어서' : '화면을 보고'} ${who}가 대답했어 · ${mode.emoji} ${mode.label}${zoomNote}`,
      buttons: (r.sources || []).map((src) => ({ label: src.title, action: 'link', url: src.url })),
      ai: true,
    };
  } catch (e) {
    return { text: e.message === 'NO_KEY' ? 'AI 키가 없어. 설정 → AI 연결에서 넣어 줘.' : e.message };
  }
}

// 화면을 보고 대답한 뒤 3분 안에 이어서 물어보면 같은 화면을 다시 보여 주며 묻는다
function recentShot() {
  return lastShot && Date.now() - lastShot.at < SHOT_KEEP_MS ? lastShot : null;
}

// 켤 때: 저장해 둔 AI 키를 못 읽게 됐으면 조용히 넘어가지 말고 알려 준다
function checkSavedKeys() {
  const cfg = aiConfig();
  for (const [id, P] of Object.entries(ai.PROVIDERS)) {
    if (keys.status(id) !== 'broken') continue;
    if (id !== cfg.provider && keys.status(cfg.provider) === 'ok') continue;
    say(
      {
        title: `저장해 둔 ${P.name} 키를 못 읽었어 😢`,
        sub: '나를 눌러서 설정 → AI 연결에서 키를 한 번만 다시 넣어 줘. 이번엔 예비 사본까지 만들어 둘게',
        tone: 'sad',
        icon: '🔑',
      },
      20,
    );
    return;
  }
}

// 물어본 말 처리 → 대답 { text, sub, buttons }
async function answer(input) {
  const r = intent.parse(input);
  switch (r.type) {
    case 'empty':
      return { text: '궁금한 걸 말하거나 적어 줘!' };
    case 'time':
      react('nod');
      return { text: `지금은 ${timeText()}이야!` };
    case 'date': {
      const d = new Date();
      return { text: `오늘은 ${d.getMonth() + 1}월 ${d.getDate()}일 ${'일월화수목금토'[d.getDay()]}요일이야.` };
    }
    case 'today': {
      if (!today) await refresh();
      const card = summary();
      say(card, 20);
      if (card.kind !== 'today') return { text: card.title, sub: card.sub };
      const left = card.todos.filter((t) => !t.done).length;
      const next = card.events.find((e) => e.state === 'next' || e.state === 'now');
      let text = left ? `남은 할 일이 ${left}개 있어.` : '할 일은 다 끝냈어! 🎉';
      if (next) text += ` ${next.state === 'now' ? '지금' : next.time + '에'} "${next.title}" 일정이 있어.`;
      return { text, sub: '자세한 건 캐릭터 말풍선에 띄웠어' };
    }
    case 'focus': {
      const sec = r.seconds || focusMinutes() * 60;
      startTimer('focus', sec);
      return { text: `${intent.formatDuration(sec)} 집중 시작! 🔥`, sub: `끝나면 ${breakMinutesFor(sec)}분 쉬는 시간도 알려줄게` };
    }
    case 'focus-set': {
      const m = Math.round(r.seconds / 60);
      if (!setFocusMinutes(m)) return { text: '집중 시간은 5분에서 3시간 사이로 정할 수 있어 🙂' };
      pushSettings();
      return { text: `앞으로 집중은 ${intent.formatDuration(m * 60)}으로 할게! 🍅`, sub: '"집중 시작"이라고 하면 바로 시작해' };
    }
    case 'timer':
      startTimer('timer', r.seconds);
      return { text: `${intent.formatDuration(r.seconds)} 타이머 시작! ⏱️` };
    case 'timer-stop':
      return { text: stopTimer(false) ? '타이머 멈췄어.' : '지금 켜진 타이머는 없어.' };
    case 'remind':
      addAlarm(Date.now() + r.seconds * 1000, r.what, 'remind');
      react('nod');
      return { text: `${intent.formatDuration(r.seconds)} 뒤에 알려줄게! 🔔`, sub: r.what !== '말한 시간' ? `"${r.what}"` : '' };
    case 'alarm': {
      const at = intent.alarmDate(r.clock).getTime();
      addAlarm(at, r.what, 'alarm');
      react('nod');
      const left = Math.round((at - Date.now()) / 60000);
      return {
        text: `${whenText(at)}에 알람 맞췄어! ⏰`,
        sub: `${r.what ? `"${r.what}" · ` : ''}${intent.formatDuration(left * 60)} 뒤 · 비서를 켜 둬야 울려`,
      };
    }
    case 'alarm-list': {
      const list = loadAlarms();
      if (!list.length) return { text: '맞춰 둔 알람이 없어.' };
      return {
        text: `알람 ${list.length}개 있어.`,
        sub: list.map((a) => `• ${whenText(a.at)}${a.what && a.what !== '말한 시간' ? ` — ${a.what}` : ''}`).join('\n'),
      };
    }
    case 'alarm-clear': {
      const n = loadAlarms().length;
      saveAlarms([]);
      return { text: n ? `알람 ${n}개 다 껐어.` : '꺼 둘 알람이 없어.' };
    }
    case 'weather':
      react('lookAround');
      return weatherAnswer(r.when);
    case 'study-report': {
      const card = studyCard(r.last);
      const rr = card._r;
      delete card._r;
      say(card, 20);
      react(rr.total ? 'happy' : 'nod');
      if (!rr.total) return { text: `${r.last ? '지난주' : '이번 주'}엔 아직 집중 기록이 없어!`, sub: '"집중 시작"이라고 하면 바로 시작해 🍅' };
      const top = rr.byGoal[0];
      return {
        text: `${r.last ? '지난주' : '이번 주'} ${studylog.hm(rr.total)} 집중했어 📊${card.compare ? ` (${card.compare})` : ''}`,
        sub: `${top ? `제일 많이: ${top.name} ${studylog.hm(top.min)} · ` : ''}자세한 건 캐릭터 말풍선에 띄웠어`,
      };
    }
    case 'meal':
      react('nod');
      return mealAnswer(r);
    case 'timetable':
      react('nod');
      return timetableAnswer(r);
    case 'brief':
      await showBrief();
      return { text: '브리핑을 캐릭터 말풍선에 띄웠어! ☀️' };
    case 'todo-add': {
      if (!(await checkmate.currentUser().catch(() => null))) return { text: '체크메이트에 로그인해야 할 일을 넣을 수 있어.', sub: '나를 눌러서 설정 → 체크메이트 로그인' };
      if (!r.title) return { text: '뭘 추가할까? ✍️', sub: '예: "수학 숙제 추가해줘", "내일 영어 단어 할 일 추가"' };
      if (!today) await refresh();
      const g = splitGoal(r.title);
      try {
        const row = await addTodoAndRefresh(g.title, g.goalId, r.dayOffset);
        react('happy');
        const when = ['오늘', '내일', '모레'][r.dayOffset] || '';
        if (r.dayOffset === 0 && win) say(summary(), 12);
        return { text: `"${row.title}" 추가했어! ✅`, sub: `${when} · ${row.goal} 목표에 넣었어` };
      } catch (e) {
        return { text: '할 일을 못 넣었어 😢', sub: e.message };
      }
    }
    case 'screen':
      return screenAnswer({ text: r.query });
    case 'me': {
      const g = growth.view(loadConfig().growth);
      react('wave');
      return { text: `나는 ${charName()}! 네 옆에서 일정이랑 할 일 챙겨 주는 비서야 🐾`, sub: `지금 Lv.${g.level} · 다음 레벨까지 ${g.need - g.cur} XP` };
    }
    case 'wiki': {
      // AI 가 연결돼 있으면 AI 가 더 잘 대답한다
      const viaAI = await askAI(r.query);
      if (viaAI) return viaAI;
      try {
        react('nod');
        let hit = null;
        for (const t of r.topics || [r.topic]) {
          hit = await wiki.lookup(t);
          if (hit) break;
        }
        if (hit) {
          react('happy');
          return {
            text: hit.text,
            sub: `위키백과 「${hit.title}」에서 찾았어`,
            buttons: [{ label: '위키백과에서 더 보기', action: 'link', url: hit.url }, ...SEARCH_BUTTONS(r.topic).slice(0, 1)],
          };
        }
        return { text: `"${r.topic}"은(는) 위키백과에 없네 😅`, sub: '검색해 볼까?', buttons: SEARCH_BUTTONS(r.topic) };
      } catch (e) {
        return { text: '찾아보다가 막혔어 😢', sub: e.message, buttons: SEARCH_BUTTONS(r.topic) };
      }
    }
    case 'need-time':
      return { text: `몇 분짜리 ${r.what === '알람' ? '알람' : '타이머'}? ⏱️`, sub: '예: "10분 타이머", "25분 집중", "7시에 알람"' };
    case 'open': {
      const url = apps.site(r.name);
      if (url) {
        shell.openExternal(url);
        react('nod');
        return { text: `${r.name} 열었어! 🌐` };
      }
      await apps.load();
      const hit = apps.find(r.name);
      if (hit) {
        apps.launch(hit);
        react('hop');
        return { text: `${hit.name} 열었어! 🚀` };
      }
      return { text: `"${r.name}"(이)라는 앱을 못 찾았어 😅`, sub: '시작 메뉴에 있는 이름으로 말해 줘. 아니면 검색해 볼까?', buttons: SEARCH_BUTTONS(r.name) };
    }
    case 'search':
      openSearch(r.engine, r.query);
      return { text: `${ENGINE_NAME[r.engine]}에서 "${r.query}" 찾아봤어! 🔍`, buttons: SEARCH_BUTTONS(r.query).filter((b) => b.engine !== r.engine) };
    case 'calc':
      return { text: `${r.expr} = ${r.value.toLocaleString('ko-KR')}` };
    case 'hello':
      react('wave');
      return { text: '안녕! 오늘도 반가워 👋' };
    case 'love':
      react('love');
      return { text: '나도 좋아해! 💕' };
    case 'dance':
      react('dance');
      return { text: '그럼 같이 춤추자~ ♪' };
    case 'thanks':
      react('happy');
      return { text: '천만에! 언제든 불러 줘 😊' };
    case 'tired':
      react('love');
      return { text: '오늘 많이 힘들었구나… 잠깐 쉬어도 괜찮아. 물 한 잔 어때? 💧' };
    case 'help':
      return {
        text: '이런 걸 할 수 있어!',
        sub: [
          '• 지금 몇 시야 / 오늘 며칠이야',
          '• 오늘 할 일 알려줘',
          '• 집중 시작 / 50분 집중 / 집중 시간 45분으로 바꿔줘 / 이번 주 공부 얼마나 했어',
          '• 10분 타이머 / 타이머 그만',
          '• 30분 뒤에 빨래 알려줘 / 내일 아침 7시에 깨워줘',
          '• 알람 뭐 있어 / 알람 다 꺼',
          '• 카톡 열어줘 / 크롬 켜 / 유튜브 틀어줘',
          '• 날씨 어때 / 내일 날씨 / 우산 필요해? / 브리핑 해줘',
          '• 오늘 점심 뭐야 / 내일 급식 / 시간표 / 다음 수업 뭐야',
          '• 수학 숙제 추가해줘 / 내일 영어 단어 할 일 추가',
          '• 블랙홀이 뭐야 / 세종대왕 누구야 (위키백과)',
          '• 이 화면 봐줘 / 이 문제 풀어줘 / 이 오류 뭐야 / 화면 번역해줘 (AI 연결 필요)',
          '• 📸 버튼: 전체 · 지금 창 · ✂️ 영역 고르기 + 설명 · 풀이 · 번역 · 오류 · 요약',
          '• ○○ 검색해줘 / 유튜브에서 ○○',
          '• 12*34 계산',
        ].join('\n'),
      };
    default: {
      const viaAI = await askAI(r.query);
      if (viaAI) return viaAI;
      return {
        text: '그건 아직 내가 직접 대답하기 어려워 😅',
        sub: `"${r.query}" 검색해 볼까? (설정 → AI 연결에서 제미나이를 켜면 내가 직접 대답할 수 있어)`,
        buttons: SEARCH_BUTTONS(r.query),
      };
    }
  }
}

ipcMain.handle('ask:submit', (_e, text) => answer(String(text || '').slice(0, 300)));
ipcMain.handle('ask:screen', (_e, req) => screenAnswer(typeof req === 'string' ? { text: req } : req || {}));
ipcMain.handle('ask:screen-modes', () =>
  Object.entries(screenshot.MODES).map(([id, m]) => ({ id, label: m.label, emoji: m.emoji })),
);
ipcMain.on('ask:search', (_e, { engine, query }) => {
  if (ENGINE_NAME[engine] && query) openSearch(engine, String(query).slice(0, 300));
});
ipcMain.on('ask:voice', () => voice.openVoiceTyping());
ipcMain.on('ask:link', (_e, url) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) shell.openExternal(url);
});

// 설정 → AI 연결
ipcMain.handle('ai:save-key', async (_e, { provider, key }) => {
  const P = ai.PROVIDERS[provider];
  if (!P) return { ok: false, message: '알 수 없는 AI야.' };
  try {
    const r = await P.mod.verifyAndSave(key);
    saveConfig({ ai: { ...aiConfig(), provider } });
    pushSettings();
    say({ title: `${P.name} 연결 완료!`, sub: '이제 물어보기에서 뭐든 대답해 줄게', tone: 'happy', icon: '🧠', react: 'cheer' }, 6);
    return { ok: true, model: r.model };
  } catch (e) {
    return { ok: false, message: e.message };
  }
});
ipcMain.on('ai:clear-key', (_e, provider) => {
  const P = ai.PROVIDERS[provider];
  if (P) P.mod.clearKey();
  pushSettings();
});
ipcMain.on('ai:set', (_e, patch) => {
  const next = { ...aiConfig() };
  if (patch.provider && ai.PROVIDERS[patch.provider]) next.provider = patch.provider;
  if (patch.claudeModel) next.claudeModel = String(patch.claudeModel);
  saveConfig({ ai: next });
  pushSettings();
});
// 화면에서 찾은 할 일을 체크메이트에 넣기 (사용자가 고른 것만)
// 마감일이 있으면 그날 할 일로 넣고, 하루 전 저녁 8시에 미리 알림 (마감이 오늘이면 시각 1시간 전, 없으면 알림 없음)
ipcMain.handle('ask:add-todos', async (_e, items) => {
  if (!Array.isArray(items) || !items.length) return { ok: false, message: '넣을 할 일이 없어.' };
  if (!(await checkmate.currentUser().catch(() => null))) return { ok: false, message: '체크메이트에 로그인해야 넣을 수 있어. 설정 → 체크메이트' };
  const todayKey = checkmate.dateKey();
  const added = [];
  const failed = [];
  for (const raw of items.slice(0, 12)) {
    const title = clip(raw && raw.title, 100);
    if (!title) continue;
    const due = raw.due && /^\d{4}-\d{2}-\d{2}$/.test(raw.due) && raw.due >= todayKey ? raw.due : todayKey;
    let remindAt = null;
    const [y, mo, d] = due.split('-').map(Number);
    if (due > todayKey) remindAt = new Date(y, mo - 1, d - 1, 20, 0);
    else if (raw.time && /^\d{2}:\d{2}$/.test(raw.time)) {
      const [h, mi] = raw.time.split(':').map(Number);
      const at = new Date(y, mo - 1, d, h - 1, mi);
      if (at > new Date()) remindAt = at;
    }
    try {
      const row = await checkmate.addTodo(title, { date: due, remindAt });
      added.push({ title: row.title, date: row.date, remind: remindAt ? whenText(remindAt.getTime()) : null });
    } catch (e) {
      failed.push(`${title}: ${e.message}`);
    }
  }
  await refresh();
  if (added.length) {
    react('happy');
    say({ title: `할 일 ${added.length}개 넣었어 📌`, sub: added.map((a) => a.title).slice(0, 3).join(', '), tone: 'happy', icon: '📌' }, 8);
  }
  return {
    ok: added.length > 0,
    added,
    message: added.length ? `체크메이트에 ${added.length}개 넣었어 ✅${failed.length ? ` (못 넣은 것 ${failed.length}개)` : ''}` : failed[0] || '못 넣었어',
  };
});

ipcMain.on('ai:key-page', (_e, provider) => {
  if (provider === 'neis') return shell.openExternal('https://open.neis.go.kr/portal/guide/actKeyPage.do'); // 나이스 인증키 신청 페이지로 바로
  const P = ai.PROVIDERS[provider];
  if (P) shell.openExternal(P.keyUrl);
});
ipcMain.on('ask:close', closeAsk);
ipcMain.handle('ask:size', (_e, big) => {
  if (typeof big === 'boolean') resizeAsk(big);
  return { big: askIsBig() };
});
ipcMain.handle('ask:drag-size', (_e, req) => dragAskSize(req || {}));

// ---------- 창 ----------
function createWindow() {
  computeWinSize();
  const area = screen.getPrimaryDisplay().workArea;
  const saved = loadConfig().position;
  win = new BrowserWindow({
    width: WIN_W,
    height: WIN_H,
    // 자동 테스트 중엔 화면 밖에 띄워서 실제 마우스·클릭과 섞이지 않게
    ...(process.env.AI_SELFTEST
      ? { x: -4000, y: 0 }
      : saved
        ? keepOnScreen(saved[0], saved[1])
        : { x: area.x + area.width - WIN_W - 20, y: area.y + area.height - WIN_H - 10 }),
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    icon: ICON,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  // 창을 캐릭터·말풍선 모양으로만 잘라서, 나머지 투명한 곳은 클릭·터치가 뒤쪽 창으로 통과되게 한다.
  // (정확한 모양은 화면이 뜬 뒤 renderer 가 계산해서 보내 준다)
  applyShape([{ x: 80, y: WIN_H - 190, width: WIN_W - 160, height: 180 }]);
  if (IS_MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // 말풍선을 만진 뒤 다른 곳을 누르면 비서 창이 초점을 잃는다 → 말풍선 닫기
  win.on('blur', () => win && !win.isDestroyed() && win.webContents.send('outside-click'));
  win.webContents.on('did-finish-load', async () => {
    win.webContents.send('size', { stage: stagePx() });
    sendCharacter();
    say({ title: '안녕!', sub: '나를 누르면 설정, 꾹 누르면 애교!', tone: 'happy', icon: '👋' }, 6);
    if (process.env.AI_SELFTEST) selfTest();
    await refresh({ announce: true });
    checkReminders();
  });
}

// 개발용: AI_SELFTEST=1 로 켜면 캐릭터를 눌러 보고 설정 창이 열리는지 확인한 뒤 종료한다.
// 속도 재기: 프로세스별 CPU(가만히 있을 때·커서 움직일 때), 캐릭터 화면 초당 그림 수, 창 여는 시간
async function perfReport(wait) {
  const cpu = () => {
    const by = {};
    for (const m of app.getAppMetrics()) by[m.type] = Math.round(((by[m.type] || 0) + m.cpu.percentCPUUsage) * 10) / 10;
    return by;
  };
  const fps = () =>
    Promise.race([
      win.webContents.executeJavaScript('new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(Math.round(n / 2)); }; requestAnimationFrame(f); })'),
      wait(4000).then(() => 'rAF stopped'),
    ]);
  const draws = async (ms) => {
    const a = await win.webContents.executeJavaScript('window.__draws || 0');
    await wait(ms);
    const b = await win.webContents.executeJavaScript('window.__draws || 0');
    return Math.round(((b - a) * 1000) / ms);
  };
  const measure = async (label, setup) => {
    await win.webContents.executeJavaScript(setup);
    await wait(1500);
    cpu();
    const d = await draws(6000);
    console.log(`PERF ${label}: draws/s ${d} | cpu %`, JSON.stringify(cpu()));
  };
  await wait(4000);
  await measure('idle, no cap (old)', 'window.__noFpsCap = true; true');
  await measure('idle, capped (new)', 'window.__noFpsCap = false; true');
  // 커서가 움직이는 동안
  const moveFor = async (ms) => {
    const t0 = Date.now();
    let i = 0;
    while (Date.now() - t0 < ms) {
      win.webContents.send('cursor', { x: 60 + (i % 40) * 4, y: 80 + Math.sin(i / 5) * 40 });
      i++;
      await wait(30);
    }
  };
  cpu();
  const mv = draws(4000);
  await moveFor(4000);
  console.log('PERF moving cursor (new): draws/s', await mv, '| cpu %', JSON.stringify(cpu()));
  // 창 여는 시간 (누른 순간 → 화면에 보일 때까지)
  const untilVisible = async (get) => {
    for (let i = 0; i < 250; i++) {
      const w = get();
      if (w && !w.isDestroyed() && w.isVisible()) return;
      await wait(20);
    }
  };
  await wait(4000); // 미리 만들어 두기를 기다린다
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    toggleSettings();
    await untilVisible(() => settingsWin);
    console.log(`PERF settings open #${i + 1}: ${Date.now() - t0}ms`);
    closeSettings();
    await wait(2500);
  }
  for (let i = 0; i < 2; i++) {
    const t0 = Date.now();
    openAsk();
    await untilVisible(() => askWin);
    console.log(`PERF ask open #${i + 1}: ${Date.now() - t0}ms`);
    closeAsk();
    await wait(2500);
  }
  // 잠든 상태
  await measure('sleeping (new)', 'window.__perfSleep && window.__perfSleep(); true');
}

// 물어보기 창 시험: 대답, 가장자리 끌어서 크기 바꾸기, ⤢ 버튼
async function askSelfTest(wait, shotDir) {
  // 물어보기 창 (소리 읽기는 시험 중에 끈다)
  openAsk();
  await wait(1800);
  const ask = askWin.webContents;
  await ask.executeJavaScript('speechSynthesis.speak = () => {}; true');
  await ask.executeJavaScript("document.querySelector('#chips button').click()");
  await wait(1200);
  await ask.executeJavaScript("document.getElementById('input').value = '12*34는'; document.getElementById('form').requestSubmit()");
  await wait(1200);
  await ask.executeJavaScript("document.getElementById('input').value = '광합성이 뭐야'; document.getElementById('form').requestSubmit()");
  await wait(1200);
  const msgs = await ask.executeJavaScript("[...document.querySelectorAll('.msg.bot .b-text')].map((e) => e.textContent)");
  console.log('SELFTEST ask answers:', JSON.stringify(msgs));
  if (shotDir) fs.writeFileSync(path.join(shotDir, 'selftest-ask.png'), (await ask.capturePage()).toPNG());

  // 물어보기 창 크기: 왼쪽 가장자리를 진짜 마우스처럼 끌기 → 줄어들고 기억, ⤢ 버튼 → 크게, 다시 → 보통
  {
    const b0 = askWin.getBounds();
    // 진짜 마우스처럼 화면 좌표(globalX/Y)와 누른 채 움직이기를 같이 보낸다
    const mouse = (type, x, y, held) =>
      ask.sendInputEvent({ type, x, y, globalX: b0.x + x, globalY: b0.y + y, button: 'left', clickCount: 1, modifiers: held ? ['leftButtonDown'] : [] });
    mouse('mouseMove', 4, 200);
    mouse('mouseDown', 4, 200);
    for (let i = 1; i <= 6; i++) {
      mouse('mouseMove', 4 + i * 10, 200, true);
      await wait(40);
    }
    mouse('mouseUp', 64, 200);
    await wait(400);
    const b1 = askWin.getBounds();
    console.log('SELFTEST ask drag left edge:', b0.width, '->', b1.width, '| right edge kept', b0.x + b0.width === b1.x + b1.width, '| saved', JSON.stringify(loadConfig().askSize));
    await ask.executeJavaScript("document.getElementById('grow').click(); true");
    await wait(500);
    const b2 = askWin.getBounds();
    const icon2 = await ask.executeJavaScript("document.getElementById('grow').textContent");
    await ask.executeJavaScript("document.getElementById('grow').click(); true");
    await wait(500);
    const b3 = askWin.getBounds();
    console.log('SELFTEST ask grow button:', `${b2.width}x${b2.height}`, icon2, '-> back', `${b3.width}x${b3.height}`, '| bottom-right kept', b2.x + b2.width === b3.x + b3.width && b2.y + b2.height === b3.y + b3.height);
    dragAskSize({ phase: 'start', edge: 'tl' });
    const r = dragAskSize({ phase: 'end', edge: 'tl', dx: -5000, dy: 5000 });
    const b4 = askWin.getBounds();
    console.log('SELFTEST ask drag limits:', `${b4.width}x${b4.height}`, '(min height 380, width up to screen)', JSON.stringify(r));
    resizeAsk(false);
  }
  closeAsk();
}

// 원격 연결 시험 (PC 쪽): 로그인 없이 무작위 채널을 듣게 하고, 원격 서버와 같은 코드(mobile/www/api/_lib.js)로 부탁해 본다
async function remoteSelfTest(wait) {
  const libPath = path.join(__dirname, 'mobile', 'www', 'api', '_lib.js');
  if (!fs.existsSync(libPath)) return console.log('SELFTEST remote: skipped (run node mobile/build.mjs first)');
  const L = require(libPath);
  const channel = require('crypto').randomBytes(16).toString('hex');
  const states = [];
  await remote.start({ handle: remoteHandle, channel, onChange: (st) => states.push(st.state) });
  for (let i = 0; i < 50 && remote.status().state !== 'on'; i++) await wait(100);
  console.log('SELFTEST remote listening:', remote.status().state, '| states', states.join('>'));
  const msg = await L.askPc(channel, 'show_message', { title: '원격 시험이야', detail: '폰에서 보냈어' }, 'ChatGPT');
  await wait(500);
  const bubble = await win.webContents.executeJavaScript("(document.querySelector('#bubble') || document.body).innerText.slice(0, 200)");
  console.log('SELFTEST remote show_message:', JSON.stringify(msg), '| bubble', /원격 시험이야/.test(bubble), '| names app', /ChatGPT/.test(bubble));
  const f = await L.askPc(channel, 'start_focus', { minutes: 20 }, 'ChatGPT');
  console.log('SELFTEST remote start_focus:', JSON.stringify(f), '| timer', JSON.stringify(timerState()));
  const g = await L.askPc(channel, 'get_today', {}, 'ChatGPT');
  console.log('SELFTEST remote get_today:', g.ok, '| has timer', !!(g.result && g.result.timer), '| keys', Object.keys(g.result || {}).length);
  const st = await L.askPc(channel, 'stop_timer', {}, 'ChatGPT');
  const bad = await L.askPc(channel, 'add_todo', { title: 'x' }, 'ChatGPT');
  console.log('SELFTEST remote stop + not allowed:', JSON.stringify(st.result), '|', JSON.stringify(bad));
  const wrong = await L.askPc('0'.repeat(32), 'show_message', { title: 'x' }, 'evil', 2500);
  console.log('SELFTEST remote wrong channel:', JSON.stringify(wrong));
  // 연결이 끊겨도(절전·인터넷 끊김) 저절로 다시 붙는지: 실시간 연결을 억지로 끊어 본다
  {
    const seen = [];
    const t0 = Date.now();
    const sb = checkmate.client();
    // 인터넷이 갑자기 끊긴 것처럼: 속에 있는 연결만 닫는다 (정상 종료 신호 없이)
    const conn = sb.realtime.conn;
    if (conn && conn.close) conn.close(3000, 'test drop');
    else sb.realtime.disconnect();
    for (let i = 0; i < 300 && !(seen.includes('error') && remote.status().state === 'on'); i++) {
      const st = remote.status().state;
      if (seen[seen.length - 1] !== st) seen.push(st);
      await wait(100);
    }
    const back = await L.askPc(channel, 'show_message', { title: '다시 붙었어' }, 'ChatGPT');
    console.log('SELFTEST remote reconnect:', seen.join('>'), '→', remote.status().state, `in ${((Date.now() - t0) / 1000).toFixed(1)}s`, '| works', !!back.ok);
  }
  await remote.stop();
  const off = await L.askPc(channel, 'show_message', { title: 'x' }, 'ChatGPT', 2500);
  console.log('SELFTEST remote after stop:', JSON.stringify(off), '| state', remote.status().state);
}

// 집중 기록 시험: 가짜 할 일·가짜 기록으로 (임시 설정에서만)
async function studySelfTest(wait) {
  const shotDir = process.env.AI_SELFTEST_SHOT;
  const savedToday = today;
  const savedLog = loadConfig().focusLog;
  const js = (c) => win.webContents.executeJavaScript(c);
  // 1) 집중 시작 → 할 일 고르기 버튼
  today = { date: checkmate.dateKey(), events: [], dDays: [], goals: [{ id: 'g1', name: '수학' }], todos: [{ id: 't1', title: '수학 문제집 3쪽', done: false, goal: '수학' }, { id: 't2', title: '영어 단어 50개', done: false, goal: '영어' }] };
  saveConfig({ focusLog: [] });
  startTimer('focus', 25 * 60);
  await wait(700);
  const btns = await js("[...document.querySelectorAll('.s-act')].map((b) => b.textContent)");
  await js("document.querySelector('.s-act').click(); true");
  await wait(500);
  console.log('SELFTEST study pick buttons:', JSON.stringify(btns), '| chosen todo:', timer && timer.todo && timer.todo.title);
  // 2) 끝까지 → 기록 + "끝냈어?" 버튼
  timer.startedAt = Date.now() - 25 * 60000;
  timer.endsAt = Date.now() - 1;
  tickTimer();
  await wait(700);
  const endBtns = await js("[...document.querySelectorAll('.s-act')].map((b) => b.textContent)");
  const log1 = loadConfig().focusLog || [];
  console.log('SELFTEST study end card:', JSON.stringify(endBtns), '| log', JSON.stringify(log1.map((e) => [e.min, e.todo, e.goal, e.full])));
  stopTimer(false); // 쉬는 시간 끄기
  // 3) 중간에 멈추면 한 만큼만
  startTimer('focus', 50 * 60, { todo: { id: 't2', title: '영어 단어 50개', goal: '영어' } });
  timer.startedAt = Date.now() - 12 * 60000;
  stopTimer(false);
  startTimer('focus', 25 * 60);
  timer.startedAt = Date.now() - 60000; // 1분만: 안 남겨야 한다
  stopTimer(false);
  const log2 = loadConfig().focusLog || [];
  console.log('SELFTEST study partial:', JSON.stringify(log2.map((e) => [e.min, e.goal, e.full])));
  // 4) 지난주 기록도 조금 넣고 리포트
  const lw = Date.now() - 7 * 86400000;
  saveConfig({ focusLog: [...log2, { at: lw, min: 20, todo: null, goal: '국어', dz: 1, full: true }] });
  const a = await answer('이번 주 공부 얼마나 했어');
  await wait(800);
  const rp = await js("({ title: (document.querySelector('.rp-title') || {}).textContent, total: (document.querySelector('.rp-total b') || {}).textContent, cmp: (document.querySelector('.rp-cmp') || {}).textContent, bars: document.querySelectorAll('.rp-col').length, goals: [...document.querySelectorAll('.rp-goal-name')].map((x) => x.textContent) })");
  console.log('SELFTEST study report answer:', a.text, '|', a.sub);
  console.log('SELFTEST study report card:', JSON.stringify(rp));
  if (shotDir) fs.writeFileSync(path.join(shotDir, 'selftest-report.png'), (await win.webContents.capturePage()).toPNG());
  const empty = await answer('지난주 집중 얼마나 했어');
  console.log('SELFTEST study last week:', empty.text);
  const card = await briefCard();
  console.log('SELFTEST study brief row:', JSON.stringify(card.study));
  const gt = await bridgeTool('get_today', {}, 'selftest');
  console.log('SELFTEST study in get_today:', JSON.stringify(gt.study_this_week));
  // 되돌리기
  today = savedToday;
  saveConfig({ focusLog: savedLog || [] });
  await js("document.querySelector('.b-close') && document.querySelector('.b-close').click(); true");
  await wait(500);
}

// 학교 시험: 공개된 학교(서울 가락고 1학년 1반)로 진짜 나이스를 불러 본다 (임시 설정에서만)
async function schoolSelfTest(wait) {
  const before = loadConfig().school;
  saveConfig({ school: {} });
  console.log('SELFTEST school none:', (await answer('오늘 점심 뭐야')).text);
  const found = await school.search('가락고등학교');
  const g = found.find((x) => x.name === '가락고등학교');
  saveConfig({ school: { school: g, grade: 1, cls: 1, start: '08:40', classMin: 50, mealBrief: true, classAlert: true } });
  const q = async (t) => {
    const r = await answer(t);
    return (r.text || '').split('\n').join(' / ').slice(0, 140);
  };
  console.log('SELFTEST school meal:', await q('오늘 급식 뭐야'));
  console.log('SELFTEST school lunch tomorrow:', await q('내일 점심 뭐야'));
  console.log('SELFTEST school timetable:', await q('시간표 알려줘'));
  console.log('SELFTEST school 3rd period:', await q('3교시 뭐야'));
  console.log('SELFTEST school next class:', await q('다음 수업 뭐야'));
  const card = await briefCard();
  console.log('SELFTEST school brief:', JSON.stringify(card.school));
  const st = await bridgeTool('get_today', {}, 'selftest');
  console.log('SELFTEST school in get_today:', JSON.stringify(st.school).slice(0, 200));
  // 설정 창에 학교 카드
  for (let i = 0; i < 3 && (!settingsWin || settingsWin.isDestroyed()); i++) {
    toggleSettings();
    await wait(1200);
  }
  const ui = await settingsWin.webContents.executeJavaScript(
    "({ name: document.getElementById('schoolName').textContent, grades: document.querySelectorAll('#schoolGrade button').length, on: (document.querySelector('#schoolGrade .on') || {}).textContent, cls: document.getElementById('schoolCls').value, alert: document.getElementById('schoolAlert').checked, hidden: document.getElementById('schoolSection').classList.contains('off') })",
  );
  console.log('SELFTEST school settings card:', JSON.stringify(ui));
  // 반 번호 없이 강의실(분반)로 올라오는 학교 (과학고 모양을 흉내 낸 줄들)
  const roomRows = [
    { PERIO: '1', ITRT_CNTNT: '수학Ⅱ', CLRM_NM: ' M301(1)', CLASS_NM: null },
    { PERIO: '1', ITRT_CNTNT: '국어Ⅱ', CLRM_NM: 'M202(2)', CLASS_NM: null },
    { PERIO: '2', ITRT_CNTNT: '일반물리학', CLRM_NM: 'M406(1)', CLASS_NM: null },
    { PERIO: '2', ITRT_CNTNT: '인공지능', CLRM_NM: 'S726(1)', CLASS_NM: null },
    { PERIO: '5', ITRT_CNTNT: '자율연구Ⅱ1', CLRM_NM: 'AAaa1-1', CLASS_NM: null },
    { PERIO: '5', ITRT_CNTNT: '자율연구Ⅱ2', CLRM_NM: 'AAaa1-2', CLASS_NM: null },
  ];
  const rr = school.fromRooms(roomRows, 1);
  console.log('SELFTEST school rooms:', rr.map((x) => `${x.period}:${x.subject}`).join(' | '), '| elective', rr.elective, '| expect 1:수학Ⅱ | 2:일반물리학 / 인공지능 | 5:자율연구Ⅱ');
  closeSettings();
  saveConfig({ school: before || {} });
  await wait(700);
}

// 다른 AI 앱 연결 시험: Claude 앱이 하듯이 MCP 서버를 따로 띄워서 JSON-RPC 로 도구를 불러 본다.
// (임시 userData 라서 진짜 설정·알림은 안 건드린다. Claude 설정 파일도 임시 폴더에서만 고쳐 본다.)
async function mcpSelfTest(wait) {
  const { spawn } = require('child_process');
  const http = require('http');
  for (let i = 0; i < 30 && !fs.existsSync(bridgeFile()); i++) await wait(100);
  const info = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
  // 보안: 토큰 없이 / 웹페이지에서(Origin) 부르면 막혀야 한다
  const raw = (headers) =>
    new Promise((res) => {
      const r = http.request({ host: '127.0.0.1', port: info.port, path: '/tool', method: 'POST', headers }, (x) => res(x.statusCode));
      r.on('error', () => res('error'));
      r.end(JSON.stringify({ name: 'get_today', args: {} }));
    });
  const noToken = await raw({ 'content-type': 'application/json' });
  const fromWeb = await raw({ 'content-type': 'application/json', authorization: `Bearer ${info.token}`, origin: 'https://evil.example' });
  const badHost = await raw({ 'content-type': 'application/json', authorization: `Bearer ${info.token}`, host: 'evil.example' });
  console.log('SELFTEST mcp security: no token', noToken, '| from web page', fromWeb, '| bad host', badHost);

  // Claude 앱과 똑같이: Electron 을 node 모드로 MCP 서버 실행
  const ent = connect.entry(__dirname);
  const child = spawn(ent.command, ent.args, { env: { ...process.env, ...ent.env, AIBISEO_BRIDGE: bridgeFile() }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const waiting = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      try {
        const m = JSON.parse(line);
        if (waiting.has(m.id)) waiting.get(m.id)(m);
      } catch {
        console.log('SELFTEST mcp bad stdout line:', line.slice(0, 120));
      }
    }
  });
  let errText = '';
  child.stderr.on('data', (d) => (errText += d));
  let nextId = 1;
  const rpc = (method, params) =>
    new Promise((res) => {
      const id = nextId++;
      waiting.set(id, res);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      setTimeout(() => res({ timeout: true }), 15000);
    });
  const call = async (name, args = {}) => {
    const r = await rpc('tools/call', { name, arguments: args });
    if (r.timeout) return { err: 'timeout' };
    if (r.error) return { err: r.error.message };
    const text = r.result.content[0].text;
    let data = text;
    try {
      data = JSON.parse(text);
    } catch {}
    return r.result.isError ? { err: text } : { data };
  };
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'Claude 시험', version: '0' } });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  console.log('SELFTEST mcp init:', init.timeout ? 'timeout ' + errText.slice(0, 200) : `${init.result.serverInfo.name} v${init.result.serverInfo.version} proto ${init.result.protocolVersion}`);
  const list = await rpc('tools/list', {});
  console.log('SELFTEST mcp tools:', list.result ? list.result.tools.map((t) => t.name).join(',') : JSON.stringify(list));

  const t0 = await call('get_today');
  console.log('SELFTEST mcp get_today:', JSON.stringify({ checkmate: t0.data && t0.data.checkmate, focus: t0.data && t0.data.default_focus_minutes, level: t0.data && t0.data.character, err: t0.err }));
  const f = await call('start_focus', { minutes: 30 });
  console.log('SELFTEST mcp start_focus:', JSON.stringify(f.data || f.err), '| timer now', JSON.stringify(timerState()));
  const rem = await call('add_reminder', { what: '연결 시험 알림', in_minutes: 90 });
  const remAt = await call('add_reminder', { what: '시각 알림', at: '23:59', alarm: true });
  const t1 = await call('get_today');
  const ids = (t1.data.reminders || []).map((r) => r.id);
  console.log('SELFTEST mcp reminders:', JSON.stringify(rem.data), '|', JSON.stringify(remAt.data && remAt.data.when), '| listed both', ids.includes(rem.data.id) && ids.includes(remAt.data.id));
  const c1 = await call('cancel_reminder', { id: rem.data.id });
  await call('cancel_reminder', { id: remAt.data.id });
  console.log('SELFTEST mcp cancel:', !!(c1.data && c1.data.cancelled), '| left', loadAlarms().filter((a) => a.what.includes('알림')).length);
  const msg = await call('show_message', { title: '계획 다 짰어!', detail: '수학 → 영어 → 휴식 순서야' });
  await wait(400);
  const bubble = await win.webContents.executeJavaScript("(document.querySelector('#bubble') || document.body).innerText.slice(0, 200)");
  console.log('SELFTEST mcp show_message:', JSON.stringify(msg.data), '| bubble has it', /계획 다 짰어/.test(bubble), '| names client', /Claude 시험/.test(bubble));
  const stop = await call('stop_timer');
  console.log('SELFTEST mcp stop_timer:', JSON.stringify(stop.data), '| timer', JSON.stringify(timerState()));
  const todo = await call('add_todo', { title: '연결 시험 할 일' });
  const bad = await call('add_reminder', { what: 'x', at: '내일쯤' });
  const unknown = await rpc('tools/call', { name: 'rm_rf', arguments: {} });
  console.log('SELFTEST mcp errors: add_todo(no login)', JSON.stringify(todo.err), '| bad time', JSON.stringify(bad.err), '| unknown tool', unknown.error && unknown.error.code);
  child.stdin.end();
  await wait(300);
  console.log('SELFTEST mcp child exited:', child.exitCode !== null || child.killed, '| stderr', JSON.stringify(errText.slice(0, 100)));

  // 비서가 꺼져 있을 때: 친절한 안내가 나와야 한다
  const off = spawn(ent.command, ent.args, { env: { ...process.env, ...ent.env, AIBISEO_BRIDGE: path.join(os.tmpdir(), 'no-such-bridge.json') }, stdio: ['pipe', 'pipe', 'pipe'] });
  const offText = await new Promise((res) => {
    let o = '';
    off.stdout.on('data', (d) => {
      o += d;
      if (o.includes('"id":2')) res(o);
    });
    off.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x' } } }) + '\n');
    off.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_today', arguments: {} } }) + '\n');
    setTimeout(() => res(o), 8000);
  });
  off.kill();
  console.log('SELFTEST mcp when assistant off:', /꺼져 있어서/.test(offText) && /"isError":true/.test(offText));

  // Claude 앱 설정 파일: 다른 연결은 그대로 두고 ai-biseo 만 넣고 뺀다 (임시 폴더)
  const fake = path.join(os.tmpdir(), 'ai-assistant-selftest', 'fake-claude');
  fs.rmSync(fake, { recursive: true, force: true });
  fs.mkdirSync(fake, { recursive: true });
  const cfgFile = path.join(fake, 'claude_desktop_config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ mcpServers: { other: { command: 'x', args: ['y'] } }, globalShortcut: 'Ctrl+Q' }));
  const before = connect.status(__dirname, { dirs: [fake] }).state;
  connect.install(__dirname, { dirs: [fake] });
  const afterCfg = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  const mid = connect.status(__dirname, { dirs: [fake] }).state;
  connect.remove({ dirs: [fake] });
  const end = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
  fs.writeFileSync(cfgFile, '{ broken');
  let brokenSafe = false;
  try {
    connect.install(__dirname, { dirs: [fake] });
  } catch {
    brokenSafe = fs.readFileSync(cfgFile, 'utf8') === '{ broken';
  }
  console.log(
    'SELFTEST connect claude config:',
    `${before} → ${mid} → removed`,
    '| kept other',
    !!(afterCfg.mcpServers.other && end.mcpServers.other && end.globalShortcut === 'Ctrl+Q'),
    '| entry',
    JSON.stringify(afterCfg.mcpServers['ai-biseo'] && afterCfg.mcpServers['ai-biseo'].env),
    '| gone after remove',
    !end.mcpServers['ai-biseo'],
    '| backup',
    fs.existsSync(cfgFile + '.bak'),
    '| broken file untouched',
    brokenSafe,
  );
}

function selfTest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    await wait(2500);
    // AI_PERFTEST=1 : 가만히 둘 때 CPU·초당 그림 수, 창 여는 시간만 재고 끝낸다
    if (process.env.AI_PERFTEST) {
      await perfReport(wait);
      app.quit();
      return;
    }
    // AI_REMOTETEST=1 : 원격 연결(PC 쪽)만 시험하고 끝낸다
    if (process.env.AI_REMOTETEST) {
      await remoteSelfTest(wait).catch((e) => console.log('SELFTEST remote crashed:', e.stack));
      app.quit();
      return;
    }
    // AI_ASKTEST=1 : 물어보기 창만 시험하고 끝낸다
    if (process.env.AI_ASKTEST) {
      await wait(5500); // 미리 만들어 두는 창이 준비될 때까지
      await askSelfTest(wait, process.env.AI_SELFTEST_SHOT).catch((e) => console.log('SELFTEST ask crashed:', e.stack));
      app.quit();
      return;
    }
    // AI_STUDYTEST=1 : 집중 기록·주간 리포트만 시험하고 끝낸다
    if (process.env.AI_STUDYTEST) {
      await studySelfTest(wait).catch((e) => console.log('SELFTEST study crashed:', e.stack));
      app.quit();
      return;
    }
    // AI_SCHOOLTEST=1 : 학교(급식·시간표)만 시험하고 끝낸다
    if (process.env.AI_SCHOOLTEST) {
      await schoolSelfTest(wait).catch((e) => console.log('SELFTEST school crashed:', e.stack));
      app.quit();
      return;
    }
    // AI_MCPTEST=1 : 다른 AI 앱 연결(MCP)만 시험하고 끝낸다
    if (process.env.AI_MCPTEST) {
      await mcpSelfTest(wait).catch((e) => console.log('SELFTEST mcp crashed:', e.stack));
      app.quit();
      return;
    }
    // AI_ASKSHOT=1 : 물어보기 창에 예시 대답들을 그려 놓고 사진만 찍고 끝낸다 (AI 는 안 부름)
    if (process.env.AI_ASKSHOT) {
      const dir = process.env.AI_SELFTEST_SHOT;
      openAsk();
      await wait(1500);
      const samples = [
        { me: '광합성이 뭐야' },
        {
          text: '광합성은 식물이 햇빛 에너지를 이용해서 이산화탄소와 물로 포도당 같은 양분을 만드는 과정이야. 이 과정에서 산소도 같이 나와서 우리가 숨 쉬는 공기를 만들어 줘. 잎 속 엽록체에 있는 엽록소가 빛을 잡아서 이 일을 해.\n\n과정은 크게 두 단계야:\n• 명반응: 빛을 받아 물을 쪼개고 에너지(ATP, NADPH)를 만들어\n• 암반응(캘빈 회로): 그 에너지로 이산화탄소를 포도당으로 바꿔\n\n시험에 자주 나오는 건 "산소는 물에서 나온다"는 거야!',
          sub: 'Claude가 도와줬어',
          ai: true,
          buttons: [{ label: '광합성 - 위키백과', action: 'link', url: 'https://ko.wikipedia.org/wiki/광합성' }, { label: 'EBS 광합성 정리', action: 'link', url: 'https://www.ebs.co.kr' }],
        },
        { me: '오늘 할 일 알려줘' },
        { text: '남은 할 일이 3개 있어. 18:30에 "수학 학원" 일정이 있어.', sub: '자세한 건 캐릭터 말풍선에 띄웠어' },
        { me: '블랙홀이 뭐야' },
        { text: '블랙홀은 중력이 너무 강해서 빛조차 빠져나올 수 없는 천체야.', sub: '위키백과 「블랙홀」에서 찾았어', buttons: [{ label: '위키백과에서 더 보기', action: 'link', url: 'https://ko.wikipedia.org' }, { label: '네이버', action: 'search', engine: 'naver', query: '블랙홀' }] },
      ];
      await askWin.webContents.executeJavaScript(`(() => { document.getElementById('chips')?.remove(); for (const s of ${JSON.stringify(samples)}) s.me ? addMe(s.me) : addBot(s); return true; })()`);
      await wait(800);
      const h = await askWin.webContents.executeJavaScript('document.getElementById("log").scrollHeight');
      askWin.setSize(ASK_W, Math.min(1400, h + 140));
      await wait(800);
      if (dir) fs.writeFileSync(path.join(dir, 'ask-look.png'), (await askWin.webContents.capturePage()).toPNG());
      app.quit();
      return;
    }
    // AI_IMGTEST=파일이름 : 그림 캐릭터로 바꿨다가 3D 로 돌아오는 걸 찍어 보고 끝낸다
    if (process.env.AI_IMGTEST) {
      const dir = process.env.AI_SELFTEST_SHOT;
      win.webContents.on('console-message', (e) => console.log('IMGTEST console:', e.message || e));
      win.webContents.on('render-process-gone', (_e, d) => console.log('IMGTEST renderer gone:', JSON.stringify(d)));
      const snap = async (name) => {
        for (let i = 0; i < 3; i++) await win.webContents.capturePage();
        if (dir) fs.writeFileSync(path.join(dir, name), (await win.webContents.capturePage()).toPNG());
      };
      const look = () => win.webContents.executeJavaScript("JSON.stringify({img: document.getElementById('charImg').className, src: document.getElementById('charImg').src.slice(-30), w: document.getElementById('charImg').naturalWidth, canvas: document.getElementById('char3d').className})");
      win.webContents.send('character', { kind: 'image', url: charImageUrl(process.env.AI_IMGTEST) });
      await wait(2500);
      console.log('IMGTEST image:', await look());
      await snap('img-1-image.png');
      win.webContents.send('character', { kind: '3d', type: 'bunny', accessory: null });
      await wait(2000);
      console.log('IMGTEST back:', await look());
      await snap('img-2-back.png');
      app.quit();
      return;
    }
    // AI_ACCSHOT=frog,cat : 그 캐릭터들에 꾸미기를 하나씩 달아 사진만 찍고 끝낸다
    if (process.env.AI_ACCSHOT) {
      const dir = process.env.AI_SELFTEST_SHOT;
      for (const type of process.env.AI_ACCSHOT.split(',')) {
        for (const acc of ['none', ...growth.ITEMS.map((i) => i.id)]) {
          win.webContents.send('character', { kind: '3d', type, accessory: acc === 'none' ? null : acc });
          await wait(1600);
          for (let i = 0; i < 3; i++) await win.webContents.capturePage();
          await wait(300);
          for (let i = 0; i < 2; i++) await win.webContents.capturePage();
          if (dir) fs.writeFileSync(path.join(dir, `acc-${type}-${acc}.png`), (await win.webContents.capturePage()).toPNG());
        }
      }
      app.quit();
      return;
    }
    const x = Math.round(WIN_W / 2);
    const y = Math.round(WIN_H - stagePx() * 0.5);
    const click = async () => {
      win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
      await wait(60);
      win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
      await wait(1500);
    };
    await click();
    console.log('SELFTEST open after 1st click:', !!settingsWin);
    await click();
    console.log('SELFTEST open after 2nd click:', !!settingsWin);

    // 꾹 누르기 → 애교 (설정 창은 열리면 안 됨)
    const shotDir = process.env.AI_SELFTEST_SHOT;
    const shot = async (name) => {
      if (!shotDir) return;
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(shotDir, name), img.toPNG());
    };
    await wait(800);
    win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await wait(1000);
    await shot('selftest-aegyo.png');
    await wait(400);
    win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
    await wait(600);
    console.log('SELFTEST settings open after long press (should be false):', !!settingsWin);

    // 말풍선 더보기
    say(
      {
        kind: 'today',
        title: '오늘의 할 일',
        sub: '테스트',
        progress: { done: 1, total: 8 },
        cheer: '좋아, 시작이 반이야! 🌱',
        events: [{ time: '18:30', end: '20:00', title: '수학 학원', state: 'next', inMin: 40 }],
        todos: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
          id: `fake-${n}`,
          title: `할 일 ${n}`,
          time: n === 1 ? '08:00' : '',
          done: n === 8,
          color: ['#FF3B5C', '#3B82F6', '#22C55E'][n % 3],
          goal: '공부',
        })),
        goals: [
          { id: 'g1', name: '공부', color: '#3B82F6' },
          { id: 'g2', name: '건강', color: '#FF3B5C' },
          { id: 'g3', name: '연구', color: 'linear-gradient(135deg, #F78CA0, #A18CD1)' },
        ],
      },
      20,
    );
    await wait(1200);
    const before = await win.webContents.executeJavaScript("document.querySelectorAll('.t-todo').length");
    await win.webContents.executeJavaScript("document.querySelector('.t-more').click()");
    await wait(500);
    const after = await win.webContents.executeJavaScript("document.querySelectorAll('.t-todo').length");
    const visible = await win.webContents.executeJavaScript("!document.getElementById('bubble').classList.contains('hidden')");
    console.log(`SELFTEST items before/after more: ${before}/${after}, bubble still open: ${visible}`);

    // 할 일 누르면 메뉴 (가짜 할 일로 화면만 시험 — 체크메이트는 건드리지 않음)
    await win.webContents.executeJavaScript("document.querySelector('.t-todo.tappable').click()");
    await wait(400);
    const menuBtns = await win.webContents.executeJavaScript("[...document.querySelectorAll('.t-menu .t-mbtn')].map((b) => b.textContent)");
    await win.webContents.executeJavaScript("document.querySelectorAll('.t-menu .t-mbtn')[1].click()");
    await wait(300);
    const editing = await win.webContents.executeJavaScript("!!document.querySelector('.t-medit') && document.querySelector('.t-medit').value");
    console.log('SELFTEST todo menu:', JSON.stringify(menuBtns), '| edit box:', editing);
    await shot('selftest-todomenu.png');
    // 할 일 추가 칸 (저장은 안 누름)
    await win.webContents.executeJavaScript("document.querySelector('.t-add').click()");
    await wait(400);
    await win.webContents.executeJavaScript("document.querySelectorAll('.t-goal')[1].click(); document.querySelector('.t-addform .t-medit').value = '수학 숙제'; true");
    await wait(200);
    const addForm = await win.webContents.executeJavaScript(
      "({ form: !!document.querySelector('.t-addform'), goals: document.querySelectorAll('.t-goal').length, picked: (document.querySelector('.t-goal.on') || {}).textContent })",
    );
    console.log('SELFTEST add form:', JSON.stringify(addForm));
    await shot('selftest-addform.png');
    // 닫기 버튼
    const closeBtn = await win.webContents.executeJavaScript('!!document.querySelector("#bubble .b-close")');
    await win.webContents.executeJavaScript('document.querySelector("#bubble .b-close").click(); true');
    await wait(400);
    const closed = await win.webContents.executeJavaScript('document.getElementById("bubble").classList.contains("hidden")');
    console.log('SELFTEST close button:', closeBtn, '| closed:', closed);
    // 바깥 누르기(창이 초점을 잃음) → 닫힘, 짧은 말은 20초를 달라고 해도 몇 초 만에 닫힘
    const isHidden = () => win.webContents.executeJavaScript('document.getElementById("bubble").classList.contains("hidden")');
    say({ title: '바깥 누르기 시험', sub: '닫혀야 해' }, 20);
    await wait(500);
    win.emit('blur');
    await wait(400);
    console.log('SELFTEST outside click closes:', await isHidden());
    say({ title: '짧은 말', sub: '금방 닫혀야 해' }, 20);
    await wait(4500);
    const openAt45 = !(await isHidden());
    await wait(3500);
    console.log('SELFTEST short card: still open at 4.5s', openAt45, '| closed by 8s', await isHidden());
    say({ title: '알람!', ring: 'soft', actions: [{ id: 'dismiss', label: '끄기' }] }, 20);
    await wait(500);
    win.emit('blur');
    await wait(400);
    console.log('SELFTEST ringing alarm stays after outside click:', !(await isHidden()));
    await win.webContents.executeJavaScript('document.querySelector("#bubble .b-close").click(); true');
    await wait(300);
    // 손가락으로 만질 때 고개가 손가락 쪽을 보는지 (왼쪽·오른쪽 터치 후 캐릭터 그림 비교)
    const touchAt = (side) =>
      win.webContents.executeJavaScript(
        `(() => { const r = document.getElementById('stage').getBoundingClientRect();
          window.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'touch', isPrimary: true, pointerId: 9,
            clientX: ${side < 0 ? 'r.left + 12' : 'r.right - 12'}, clientY: r.top + r.height * 0.45 })); return true; })()`,
      );
    const stageShot = async () => {
      const r = await win.webContents.executeJavaScript('(() => { const b = document.getElementById("stage").getBoundingClientRect(); return { x: Math.round(b.left), y: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height) }; })()');
      return (await win.webContents.capturePage(r)).toBitmap();
    };
    await touchAt(-1);
    await wait(900);
    const leftImg = await stageShot();
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'selftest-touch-left.png'), (await win.webContents.capturePage()).toPNG());
    await touchAt(1);
    await wait(900);
    const rightImg = await stageShot();
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'selftest-touch-right.png'), (await win.webContents.capturePage()).toPNG());
    let diff = 0;
    for (let i = 0; i < Math.min(leftImg.length, rightImg.length); i += 4) if (Math.abs(leftImg[i] - rightImg[i]) > 30) diff++;
    console.log('SELFTEST touch look: changed pixels', diff);
    // 위키백과 대답 · 자기소개 · 경험치 · 꾸미기
    const wikiAns = await answer('블랙홀이 뭐야');
    console.log('SELFTEST wiki:', String(wikiAns.text).slice(0, 40), '|', wikiAns.sub, '| buttons', (wikiAns.buttons || []).length);
    console.log('SELFTEST me:', (await answer('너 누구야')).text);
    const gained = grow([['todo', 'selftest-1'], ['todo', 'selftest-2'], ['focus', 'selftest-3'], ['todo', 'selftest-4'], ['todo', 'selftest-5']]);
    console.log('SELFTEST grow gained:', gained);
    for (const [type, acc] of [['cat', 'ribbon'], ['bunny', 'flower'], ['bear', 'glasses'], ['cat', 'crown'], ['puppy', 'star'], ['penguin', 'scarf'], ['bunny', 'halo'], ['cat', 'halo2']]) {
      win.webContents.send('character', { kind: '3d', type, accessory: acc.replace(/\d$/, '') });
      await wait(1600); // 깡총 뛰는 동작이 끝난 뒤에 찍는다
      // 화면 밖 창은 캡처가 두 장씩 늦게 나와서, 버리는 캡처를 두 번 먼저 한다
      await win.webContents.capturePage();
      await win.webContents.capturePage();
      await shot(`selftest-acc-${acc}.png`);
    }
    sendCharacter();
    await wait(500);
    const askAdd = await answer('추가해줘');
    console.log('SELFTEST ask add without title:', askAdd.text);
    try {
      await checkmate.addTodo('   ');
      console.log('SELFTEST empty todo: ACCEPTED (bad)');
    } catch (e) {
      console.log('SELFTEST empty todo rejected:', e.message);
    }
    try {
      await checkmate.setTodoDone('00000000-0000-0000-0000-000000000000', true);
      console.log('SELFTEST fake todo id: ACCEPTED (bad)');
    } catch (e) {
      console.log('SELFTEST fake todo id rejected:', e.message);
    }
    await shot('selftest-more.png');

    await askSelfTest(wait, shotDir).catch((e) => console.log('SELFTEST ask crashed:', e.stack));

    // 집중 타이머 알약
    startTimer('focus', 25 * 60);
    await wait(2500);
    console.log('SELFTEST timer:', JSON.stringify(timerState()));
    await shot('selftest-timer.png');

    // 설정 창
    toggleSettings();
    await wait(1500);
    if (shotDir && settingsWin) fs.writeFileSync(path.join(shotDir, 'selftest-settings.png'), (await settingsWin.webContents.capturePage()).toPNG());

    // 집중 시간 고르기: 설정 칸 → 저장·버튼 글자, 말로 바꾸기, 기본 시간으로 시작
    stopTimer(false);
    await wait(600);
    if (!settingsWin || settingsWin.isDestroyed()) {
      toggleSettings();
      await wait(1500);
    }
    const fsw = settingsWin.webContents;
    await fsw.executeJavaScript("[...document.querySelectorAll('#focusLen button')].find((b) => b.textContent === '45').click(); true");
    await wait(700);
    const fUi = await fsw.executeJavaScript(
      "({ btns: [...document.querySelectorAll('#focusLen button')].map((b) => b.textContent + (b.className === 'on' ? '*' : '')).join(' '), label: document.getElementById('focus').textContent, fits: document.getElementById('focusLen').scrollWidth <= document.getElementById('focusLen').clientWidth + 1 })",
    );
    console.log('SELFTEST focus pick:', JSON.stringify(fUi), '| saved', loadConfig().focusMinutes);
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'selftest-focuslen.png'), (await fsw.capturePage()).toPNG());
    const fa1 = await answer('집중 시간 40분으로 바꿔줘');
    await wait(500);
    const fBtns = await fsw.executeJavaScript("[...document.querySelectorAll('#focusLen button')].map((b) => b.textContent + (b.className === 'on' ? '*' : '')).join(' ')");
    const fa2 = await answer('집중 시작');
    console.log('SELFTEST focus voice:', fa1.text, '|', fBtns, '|', fa2.text, fa2.sub, '| timer', timerState().total, '| break for 90m', breakMinutesFor(90 * 60));
    closeSettings();
    stopTimer(false);

    // 그림 캐릭터 지우기: ✕ → 칸 안에서 '지우기' → 파일이 사라지고 목록에서도 빠져야 한다 (임시 폴더에서만)
    fs.mkdirSync(CHAR_DIR, { recursive: true });
    const testImg = '지우기 시험.png';
    fs.copyFileSync(path.join(__dirname, 'mobile', 'web', 'icons', 'icon-192.png'), path.join(CHAR_DIR, testImg));
    chooseCharacter(testImg);
    await wait(600); // 방금 닫힌 설정 창은 0.4초 안에 다시 안 열린다
    for (let i = 0; i < 3 && (!settingsWin || settingsWin.isDestroyed()); i++) {
      toggleSettings();
      await wait(1500);
    }
    const sw = settingsWin.webContents;
    await sw.executeJavaScript("document.querySelector('#charsImg .chip-x').click(); true");
    await wait(300);
    const asked = await sw.executeJavaScript("!!document.querySelector('#charsImg .chip-confirm')");
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'selftest-remove-ask.png'), (await sw.capturePage()).toPNG());
    await sw.executeJavaScript("document.querySelector('#charsImg .chip-confirm .yes').click(); true");
    await wait(1500);
    const chipsLeft = settingsWin && !settingsWin.isDestroyed() ? await sw.executeJavaScript("document.querySelectorAll('#charsImg .chip').length") : 'settings closed';
    console.log('SELFTEST remove image: asked', asked, '| file gone', !fs.existsSync(path.join(CHAR_DIR, testImg)), '| chips left', chipsLeft, '| back to', currentCharacter());
    closeSettings();

    // AI 연결: 가짜 키는 거절돼야 하고, 키가 없으면 검색 버튼으로 대답해야 한다
    try {
      await ai.PROVIDERS.gemini.mod.verifyAndSave('AIzaSyFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00');
      console.log('SELFTEST fake gemini key: ACCEPTED (bad)');
    } catch (e) {
      console.log('SELFTEST fake gemini key rejected:', e.message);
    }
    console.log('SELFTEST ai status:', JSON.stringify({ ...ai.status(aiConfig()), claudeModels: undefined }));
    const noAi = await answer('광합성이 뭐야');
    console.log('SELFTEST unknown without ai:', noAi.text, '| buttons', (noAi.buttons || []).length);

    // 알람 (소리는 끄고 시험, 원래 알람은 끝나고 되돌린다)
    win.webContents.setAudioMuted(true);
    const savedAlarms = loadAlarms();
    const a1 = await answer('7시에 알람 맞춰줘');
    const a2 = await answer('알람 뭐 있어');
    console.log('SELFTEST alarm set:', a1.text, '| list:', a2.text, JSON.stringify(a2.sub));
    addAlarm(Date.now() + 1500, '테스트 알람', 'alarm');
    await wait(3500);
    const ringing = await win.webContents.executeJavaScript("document.querySelectorAll('.s-act').length");
    console.log('SELFTEST alarm card buttons:', ringing);
    await shot('selftest-alarm.png');
    await win.webContents.executeJavaScript("document.querySelector('.s-act.primary').click()");
    await wait(600);
    const snoozed = loadAlarms().filter((a) => a.what === '테스트 알람');
    console.log('SELFTEST snoozed:', snoozed.length, snoozed[0] ? Math.round((snoozed[0].at - Date.now()) / 1000) + 's' : '');
    saveAlarms(savedAlarms);
    win.webContents.setAudioMuted(false);

    // 앱 찾기 (실제로 열지는 않음)
    await apps.load();
    console.log('SELFTEST apps:', ['카톡', '크롬', '계산기', '없는앱'].map((q) => `${q}→${(apps.find(q) || {}).name || '없음'}`).join(', '));

    // 날씨 · 브리핑
    const wa = await answer('날씨 어때');
    console.log('SELFTEST weather:', wa.text, JSON.stringify(wa.sub));
    const wt = await answer('내일 날씨');
    console.log('SELFTEST weather tomorrow:', wt.text);
    await showBrief();
    await wait(1500);
    await shot('selftest-brief.png');

    // 집중 지킴이 (가짜로 유튜브 창이 떠 있다고 치고 시험)
    win.webContents.setAudioMuted(true);
    const realFg = winwatch.foreground;
    winwatch.foreground = async () => ({ title: '고양이 영상 - YouTube - Chrome', proc: 'chrome' });
    startTimer('focus', 25 * 60);
    await wait(500);
    await tickGuard();
    guard.since = Date.now() - 7000;
    guard.nagAt = 0;
    await tickGuard();
    await wait(1200);
    console.log('SELFTEST guard nags:', timer && timer.distractions, '| card buttons:', await win.webContents.executeJavaScript("document.querySelectorAll('.s-act').length"));
    await shot('selftest-guard.png');
    winwatch.foreground = realFg;
    stopTimer(false);
    win.webContents.setAudioMuted(false);

    // 설정 창 아래쪽 (브리핑·AI·기타)
    toggleSettings();
    await wait(1500);
    if (shotDir && settingsWin) {
      await settingsWin.webContents.executeJavaScript("document.querySelector('.panel').scrollTop = 99999; true");
      await wait(300);
      fs.writeFileSync(path.join(shotDir, 'selftest-settings2.png'), (await settingsWin.webContents.capturePage()).toPNG());
    }
    closeSettings();

    // 화면 봐 주기 (AI 에는 안 보내고, 찍은 화면도 파일로 남기지 않는다)
    openAsk();
    await wait(1500);
    const qs = ['이 화면 봐줘', '이 문제 풀어줘', '이 오류 뭐야', '화면 번역해줘', '이 부분만 요약해줘', '지금 창 설명해줘'];
    console.log('SELFTEST screen intent:', qs.map((q) => `${intent.parse(q).type}/${screenshot.detectMode(q)}/${screenshot.detectKind(q)}`).join(', '));
    const aw = askWin.webContents;
    await aw.executeJavaScript("document.getElementById('shot').click(); true");
    await wait(500);
    const panelInfo = await aw.executeJavaScript(
      "({ open: !document.getElementById('shotPanel').classList.contains('off'), kinds: document.querySelectorAll('#spKinds button').length, modes: [...document.querySelectorAll('#spModes button')].map((b) => b.textContent) })",
    );
    console.log('SELFTEST screen panel:', JSON.stringify(panelInfo));
    if (shotDir) fs.writeFileSync(path.join(shotDir, 'selftest-shotpanel.png'), (await aw.capturePage()).toPNG());
    await aw.executeJavaScript("document.getElementById('shot').click(); true");
    // 전체 화면: 원본 해상도로 찍고, AI 에게는 2576px · 3.75MP 안으로
    const full = await screenshot.capture('full', { preload: path.join(__dirname, 'preload.js') });
    const sentFull = screenshot.fitForAI(full.native);
    console.log('SELFTEST screen full:', JSON.stringify(full.native.getSize()), '→ sent', `${sentFull.width}x${sentFull.height}`, Math.round(sentFull.data.length / 1024) + 'KB', '| visible after:', win.isVisible(), askWin.isVisible());
    const z = screenshot.zoomer(full.native, sentFull)({ x: 10, y: 10, width: 200, height: 120 });
    console.log('SELFTEST screen zoom:', z.note);
    const winShot = await screenshot.capture('window', { preload: path.join(__dirname, 'preload.js'), lastForeground });
    console.log('SELFTEST screen window:', winShot.kind, JSON.stringify(winShot.native.getSize()), '| title?', !!winShot.title);
    // 영역 고르기: 끌기 → 확인 버튼이 떠야 하고(아직 안 끝남), ✅ 를 눌러야 잘려 나온다
    const PRE = { preload: path.join(__dirname, 'preload.js') };
    const openSnip = async () => {
      let w = null;
      for (let i = 0; i < 60; i++) {
        w = screenshot._snipWindow();
        if (w && !w.isDestroyed() && w.isVisible()) break;
        await wait(100);
      }
      await wait(500);
      return w;
    };
    const toolsInfo = (sc) =>
      sc.executeJavaScript(
        "(() => { const t = document.getElementById('tools'); const r = t.getBoundingClientRect(); return { shown: !t.classList.contains('off'), inView: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, ok: getComputedStyle(document.getElementById('ok')).minHeight, touchAction: getComputedStyle(document.body).touchAction, cancelBtn: !!document.getElementById('cancel').offsetWidth }; })()",
      );
    const disp = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const regionP = screenshot.capture('region', PRE);
    let regionDone = false;
    regionP.then(() => (regionDone = true));
    let snipWin = await openSnip();
    let sc = snipWin.webContents;
    sc.sendInputEvent({ type: 'mouseDown', x: 100, y: 120, button: 'left', clickCount: 1 });
    for (let i = 1; i <= 5; i++) {
      sc.sendInputEvent({ type: 'mouseMove', x: 100 + i * 60, y: 120 + i * 30, button: 'left' });
      await wait(30);
    }
    sc.sendInputEvent({ type: 'mouseUp', x: 400, y: 270, button: 'left', clickCount: 1 });
    await wait(400);
    console.log('SELFTEST snip mouse: tools', JSON.stringify(await toolsInfo(sc)), '| finished before ✅ (should be false):', regionDone);
    await sc.executeJavaScript("document.getElementById('ok').click(); true");
    const region = await regionP;
    console.log('SELFTEST screen region:', region && region.kind, region && JSON.stringify(region.native.getSize()), '| expected about', `${Math.round(300 * disp.scaleFactor)}x${Math.round(150 * disp.scaleFactor)}`);

    // 손가락으로 끌기 (태블릿 모드): 진짜 터치 이벤트를 넣는다
    const touchP = screenshot.capture('region', PRE);
    snipWin = await openSnip();
    sc = snipWin.webContents;
    sc.debugger.attach('1.3');
    const touch = (type, x, y) => sc.debugger.sendCommand('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }] });
    await touch('touchStart', 200, 200);
    for (let i = 1; i <= 8; i++) {
      await touch('touchMove', 200 + i * 50, 200 + i * 25);
      await wait(25);
    }
    await touch('touchEnd', 600, 400);
    await wait(400);
    console.log('SELFTEST snip touch: tools', JSON.stringify(await toolsInfo(sc)));
    // 확인 버튼도 손가락으로 누른다
    const okR = await sc.executeJavaScript("(() => { const r = document.getElementById('ok').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()");
    // 확인을 누르자마자 창이 닫힐 수 있어서, 닫힌 뒤의 손 떼기 실패는 괜찮다
    await touch('touchStart', okR.x, okR.y).catch(() => {});
    await touch('touchEnd', okR.x, okR.y).catch(() => {});
    const tRegion = await Promise.race([touchP, wait(3000).then(() => 'timeout')]);
    console.log('SELFTEST snip touch region:', tRegion === 'timeout' ? 'timeout' : tRegion && JSON.stringify(tRegion.native.getSize()), '| expected about', `${Math.round(400 * disp.scaleFactor)}x${Math.round(200 * disp.scaleFactor)}`);
    if (tRegion === 'timeout' && !snipWin.isDestroyed()) snipWin.close();

    // ✕ 취소 버튼 (Esc 없이)
    const cancelBtnP = screenshot.capture('region', PRE);
    snipWin = await openSnip();
    await snipWin.webContents.executeJavaScript("document.getElementById('cancel').click(); true");
    console.log('SELFTEST snip cancel button:', (await cancelBtnP) === null);
    // 🖥️ 화면 전체 버튼
    const wholeP = screenshot.capture('region', PRE);
    snipWin = await openSnip();
    await snipWin.webContents.executeJavaScript("document.getElementById('whole').click(); true");
    const whole = await wholeP;
    console.log('SELFTEST snip whole:', whole && JSON.stringify(whole.native.getSize()));
    // 영역 고르기 취소 (Esc)
    const cancelP = screenshot.capture('region', PRE);
    const sw2 = await openSnip();
    sw2.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
    console.log('SELFTEST screen region cancel:', (await cancelP) === null);
    // AI 키가 없으면 친절히 안내
    console.log('SELFTEST screen no-ai:', (await screenAnswer({ mode: 'solve', kind: 'full' })).text);
    closeAsk();

    await mcpSelfTest(wait).catch((e) => console.log('SELFTEST mcp crashed:', e.stack));
    await schoolSelfTest(wait).catch((e) => console.log('SELFTEST school crashed:', e.stack));
    await studySelfTest(wait).catch((e) => console.log('SELFTEST study crashed:', e.stack));
    await remoteSelfTest(wait).catch((e) => console.log('SELFTEST remote crashed:', e.stack));

    // 크기 바꾸기 (끝나면 원래대로)
    const oldSize = sizeScale();
    setSize(1.5);
    await wait(1200);
    console.log('SELFTEST size 1.5 window:', JSON.stringify(win.getBounds()));
    await shot('selftest-big.png');
    setSize(oldSize);
    await wait(300);
    app.quit();
  })();
}

async function showMenu() {
  const user = await checkmate.currentUser().catch(() => null);
  const current = currentCharacter();
  const menu = Menu.buildFromTemplate([
    { label: '💬 물어보기  (Ctrl+Shift+Space)', click: openAsk },
    { label: '📸 화면 봐 줘', click: () => askScreenFromMenu({ kind: 'full', mode: 'auto' }) },
    { label: '✂️ 영역 골라서 물어보기', click: () => askScreenFromMenu({ kind: 'region', mode: 'auto' }) },
    timer
      ? { label: '⏹ 타이머 멈추기', click: () => stopTimer(true) }
      : {
          label: `🍅 집중하기 (${focusMinutes()}분)`,
          submenu: [
            { label: `▶ ${focusMinutes()}분 시작`, click: () => startTimer('focus', focusMinutes() * 60) },
            { type: 'separator' },
            ...[...new Set([...FOCUS_OPTIONS, focusMinutes()])].sort((a, b) => a - b).map((m) => ({
              label: `${m}분`,
              type: 'radio',
              checked: m === focusMinutes(),
              click: () => {
                setFocusMinutes(m);
                startTimer('focus', m * 60);
              },
            })),
          ],
        },
    { type: 'separator' },
    { label: '☀️ 브리핑 보기', click: showBrief },
    { label: '오늘 일정 보기', click: () => say(summary(), 20) },
    { label: '일정 새로고침', click: async () => { await refresh({ announce: true }); say(summary(), 20); } },
    { type: 'separator' },
    {
      label: '캐릭터 선택',
      submenu: [
        ...CHARACTERS_3D.map((c) => ({
          label: c.name,
          type: 'radio',
          checked: current === '3d:' + c.id,
          click: () => chooseCharacter('3d:' + c.id),
        })),
        { type: 'separator' },
        ...listCharacters().map((name) => ({
          label: name,
          type: 'radio',
          checked: name === current,
          click: () => chooseCharacter(name),
        })),
        { type: 'separator' },
        { label: '이미지 파일 불러오기…', click: importCharacter },
        { label: '캐릭터 폴더 열기', click: () => shell.openPath(CHAR_DIR) },
      ],
    },
    { type: 'separator' },
    user
      ? { label: `체크메이트 로그아웃 (${user.email})`, click: logout }
      : { label: '체크메이트 로그인…', click: openLogin },
    { label: '종료', click: () => app.quit() },
  ]);
  menu.popup({ window: win });
}

ipcMain.on('set-shape', (_e, rects) => {
  if (!win || !Array.isArray(rects) || rects.length === 0) return;
  const clean = rects
    .map((r) => ({
      x: Math.max(0, Math.round(r.x)),
      y: Math.max(0, Math.round(r.y)),
      width: Math.round(r.width),
      height: Math.round(r.height),
    }))
    .filter((r) => r.width > 0 && r.height > 0);
  if (clean.length) applyShape(clean);
});

// 맥에는 setShape 가 없어서: 커서가 캐릭터·말풍선 위에 있을 때만 클릭을 받고,
// 나머지는 뒤쪽 창으로 통과시킨다 (커서 위치는 눈 따라가기용으로 어차피 계속 읽는다).
const HAS_SHAPE = !IS_MAC;
let shapeRects = [];
let passThrough = null;

function applyShape(rects) {
  if (HAS_SHAPE) return win.setShape(rects);
  shapeRects = rects;
  updatePassThrough();
}

function updatePassThrough(p) {
  if (HAS_SHAPE || !win || win.isDestroyed()) return;
  p = p || screen.getCursorScreenPoint();
  const b = win.getBounds();
  const x = p.x - b.x;
  const y = p.y - b.y;
  const inside = dragTimer != null || shapeRects.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
  if (passThrough === !inside) return;
  passThrough = !inside;
  win.setIgnoreMouseEvents(passThrough, { forward: true });
}
// 끌기: 창이 움직이는 동안 창 기준 좌표가 계속 바뀌어서 떨리지 않도록,
// 실제 커서(손가락·펜도 커서를 움직인다) 위치를 메인에서 직접 읽어 창을 옮긴다.
let dragTimer = null;
let dragByCursor = false;

function moveWindowTo(x, y) {
  const [cx, cy] = win.getPosition();
  x = Math.round(x);
  y = Math.round(y);
  if (x === cx && y === cy) return;
  win.setBounds({ x, y, width: WIN_W, height: WIN_H });
}

ipcMain.on('drag-start', () => {
  if (!win) return;
  dragStart = { win: win.getPosition(), cursor: screen.getCursorScreenPoint() };
  dragByCursor = false;
  clearInterval(dragTimer);
  if (process.env.AI_SELFTEST) return; // 자동 테스트 중엔 실제 커서를 따라가지 않는다
  dragTimer = setInterval(() => {
    if (!dragStart) return;
    const c = screen.getCursorScreenPoint();
    const dx = c.x - dragStart.cursor.x;
    const dy = c.y - dragStart.cursor.y;
    if (!dragByCursor && Math.abs(dx) + Math.abs(dy) < 3) return;
    dragByCursor = true;
    moveWindowTo(dragStart.win[0] + dx, dragStart.win[1] + dy);
  }, 8);
});
// 커서가 안 움직이는 입력 장치일 때만 화면에서 보낸 이동량을 쓴다.
ipcMain.on('drag-move', (_e, { dx, dy }) => {
  if (!win || !dragStart || dragByCursor) return;
  moveWindowTo(dragStart.win[0] + dx, dragStart.win[1] + dy);
});
// 손가락·펜: "잡은 자리에서 손가락이 얼마나 벗어났나"만큼 창을 옮긴다.
// 화면은 이 응답을 받은 뒤에 생긴 터치만 다음 이동에 쓰므로, 창 위치가 늦게 반영돼도 튀지 않는다.
ipcMain.handle('drag-by', (_e, { dx, dy }) => {
  if (!win || !dragStart || dragByCursor) return false;
  const [x, y] = win.getPosition();
  moveWindowTo(x + dx, y + dy);
  return true;
});
ipcMain.on('drag-end', () => {
  dragStart = null;
  clearInterval(dragTimer);
  dragTimer = null;
  if (win) saveConfig({ position: win.getPosition() });
});
ipcMain.on('show-menu', showMenu);
ipcMain.on('character-clicked', toggleSettings);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // 이미 켜져 있는데 바로가기를 또 누르면: 화면 안으로 데려오고 "나 여기 있어!"
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    const [x, y] = win.getPosition();
    const p = keepOnScreen(x, y);
    if (p.x !== x || p.y !== y) win.setPosition(p.x, p.y);
    win.showInactive();
    win.setAlwaysOnTop(true, 'screen-saver');
    say({ title: '나 여기 있어!', sub: '누르면 설정, 꾹 누르면 애교', tone: 'happy', icon: '🙋', react: 'wave' }, 5);
  });

  app.whenReady().then(() => {
    const cfg0 = loadConfig();
    log(
      '켜짐',
      `selftest=${!!process.env.AI_SELFTEST}`,
      `enc=${require('electron').safeStorage.isEncryptionAvailable()}`,
      `config=${Object.keys(cfg0).join(',')}`,
      `ai=${(cfg0.ai || {}).provider}`,
      `xp=${(cfg0.growth || {}).xp}`,
      `claude=${keys.status('claude')}`,
      `gemini=${keys.status('gemini')}`,
    );
    powerMonitor.on('suspend', () => log('절전 들어감'));
    powerMonitor.on('resume', () => {
      log('절전에서 깸', `claude=${keys.status('claude')}`);
      setTimeout(() => remote.nudge(), 4000); // 인터넷이 다시 붙을 시간을 주고 원격 연결 다시
    });
    app.on('before-quit', () => log('꺼짐'));
    if (IS_MAC && app.dock) app.dock.setIcon(ICON);
    // 처음 켰을 때는 자동 실행을 켜 두고, 켜 둔 상태면 경로가 바뀌었을 수도 있으니 다시 등록한다.
    if (!process.env.AI_SELFTEST) ensureAutoStart();
    createWindow();
    // 캐릭터가 커서를 눈으로 따라가도록 화면 전체의 커서 위치를 보낸다.
    let lastCursor = '';
    setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      const p = screen.getCursorScreenPoint();
      updatePassThrough(p);
      const b = win.getBounds();
      const key = `${p.x - b.x},${p.y - b.y}`;
      if (key === lastCursor) return;
      lastCursor = key;
      win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y });
    }, 33);
    setInterval(checkReminders, CHECK_MS);
    setInterval(tickSchool, CHECK_MS);
    setInterval(() => refresh(), REFRESH_MS);
    setInterval(tickTimer, 1000);
    checkMissedAlarms();
    apps.load(); // 앱 목록 미리 읽어 두기
    setInterval(tickGuard, 3000);
    setInterval(tickBrief, 30 * 1000);
    setTimeout(tickBrief, 8000);
    setInterval(tickRain, 20 * 60 * 1000);
    setTimeout(tickRain, 60 * 1000);
    setInterval(tickHealth, 30 * 1000);
    // 어디서든 Ctrl+Shift+Space 로 물어보기 창
    globalShortcut.register('Control+Shift+Space', toggleAsk);
    setTimeout(checkSavedKeys, 6000);
    startBridge(); // 다른 AI 앱(Claude 등) 연결 다리
    setTimeout(startRemote, 3000); // ChatGPT·폰에서 오는 원격 부탁 듣기
    refillPanelSoon('settings', 4000); // 설정·물어보기 창 미리 준비
    refillPanelSoon('ask', 5000);
  });
  app.on('before-quit', () => (appQuitting = true));
  app.on('will-quit', () => {
    if (bridgeServer) bridgeServer.close();
    remote.stop(true);
    globalShortcut.unregisterAll();
    voice.stop();
    winwatch.stop();
  });
  app.on('window-all-closed', () => {});
}
